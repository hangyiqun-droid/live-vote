-- fix9: lobby counter ("scanned N people") + on-screen greetings. Additive only: new tables, one
-- column with a default, new functions, and CREATE OR REPLACE of event_state() with the same
-- signature as 0003 (it only gains `greetings_on`). Nothing here touches ballots, tallies or awards.
--
-- Privacy (SPEC 2.2): scanned_devices holds an HMAC that is domain-separated from
-- ballots.device_hash (the server hashes "scan:<device id>"), so the two tables have no equality
-- key to join on. No nominee, no IP, no message. The greeting text never touches Postgres — it
-- goes phone → server → Ably → stage. last_greet_at only paces senders; greeting_requests holds an
-- HMAC of a random request id for 60 s (retry dedupe + the per-second ceiling), never the text.
--
-- Lock order for everything below (never the other way, and never events/awards after it, so it
-- cannot deadlock with the 0004 order events → awards): lobby_stats → scanned_devices → greeting_requests.
CREATE TABLE "scanned_devices" (
	"device_hash" "bytea" PRIMARY KEY NOT NULL,
	"last_greet_at" timestamp with time zone
);
--> statement-breakpoint
-- One row. `scan_rev` moves in the same transaction as every change to scanned_devices, with this
-- row locked first: a revision names exactly one committed count, in commit order.
CREATE TABLE "lobby_stats" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"scan_rev" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "lobby_stats_singleton" CHECK ("lobby_stats"."id" = 1)
);
--> statement-breakpoint
INSERT INTO "lobby_stats" ("id") VALUES (1);
--> statement-breakpoint
CREATE TABLE "greeting_requests" (
	"request_hash" "bytea" PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "greeting_requests_at" ON "greeting_requests" ("at");
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "greetings_on" boolean DEFAULT true NOT NULL;
--> statement-breakpoint

-- Phones see the greetings switch through the event state (no counts, safe for phones)
CREATE OR REPLACE FUNCTION event_state() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'version', e.version,
    'title', e.title,
    'current_award_id', e.current_award_id,
    'hide_counts', e.hide_counts,
    'show_hall', e.show_hall,
    'qr_fallback', e.qr_fallback,
    'greetings_on', e.greetings_on,
    'server_now', now(),
    'awards', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'slug', a.slug, 'title', a.title, 'subtitle', a.subtitle,
        'status', a.status, 'auto_close_at', a.auto_close_at, 'round', a.round
      ) ORDER BY a.sort_order) FROM awards a), '[]'::jsonb)
  )
  FROM events e WHERE e.id = 1
$$;
--> statement-breakpoint

-- A phone opened the vote page. A device already counted is answered without any lock. A new one
-- takes the lobby_stats row, inserts, bumps the revision and counts — all in this one transaction,
-- so `count` is the number of devices at exactly `rev`, whatever other phones are doing meanwhile.
-- The stage keeps the highest rev it has seen (never a clock).
CREATE OR REPLACE FUNCTION register_scan(p_hash bytea) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_rows integer;
  v_rev bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM scanned_devices WHERE device_hash = p_hash) THEN
    RETURN jsonb_build_object('new', false,
      'count', (SELECT count(*) FROM scanned_devices),
      'rev', (SELECT scan_rev FROM lobby_stats WHERE id = 1));
  END IF;

  PERFORM 1 FROM lobby_stats WHERE id = 1 FOR UPDATE;
  INSERT INTO scanned_devices (device_hash) VALUES (p_hash) ON CONFLICT (device_hash) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 THEN
    UPDATE lobby_stats SET scan_rev = scan_rev + 1 WHERE id = 1 RETURNING scan_rev INTO v_rev;
  ELSE
    SELECT scan_rev INTO v_rev FROM lobby_stats WHERE id = 1;
  END IF;
  RETURN jsonb_build_object('new', v_rows > 0, 'count', (SELECT count(*) FROM scanned_devices), 'rev', v_rev);
END
$$;
--> statement-breakpoint

-- One statement = one snapshot: the count and the revision always belong together
CREATE OR REPLACE FUNCTION scan_count() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'count', (SELECT count(*) FROM scanned_devices),
    'rev', (SELECT scan_rev FROM lobby_stats WHERE id = 1)
  )
$$;
--> statement-breakpoint

-- MC clears the counter after the rehearsal; everyone is counted again the next time they open the page
CREATE OR REPLACE FUNCTION reset_scans() RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_rev bigint;
BEGIN
  PERFORM 1 FROM lobby_stats WHERE id = 1 FOR UPDATE;
  DELETE FROM scanned_devices;
  UPDATE lobby_stats SET scan_rev = scan_rev + 1 WHERE id = 1 RETURNING scan_rev INTO v_rev;
  INSERT INTO admin_log (action) VALUES ('reset_scans');
  RETURN jsonb_build_object('ok', true, 'count', 0, 'rev', v_rev);
END
$$;
--> statement-breakpoint

-- MC switch "show greetings on the screen". Off = the stage clears its bubbles, phones hide the box.
CREATE OR REPLACE FUNCTION set_greetings(p_on boolean) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE events SET greetings_on = p_on, version = version + 1, updated_at = now() WHERE id = 1;
  INSERT INTO admin_log (action) VALUES (CASE WHEN p_on THEN 'greetings_on' ELSE 'greetings_off' END);
  RETURN jsonb_build_object('ok', true);
END
$$;
--> statement-breakpoint

-- Is a greeting allowed on screen right now? Asked again just before a batch is published, so a
-- greeting that passed the gate a moment before the MC flipped the switch is dropped, not shown.
CREATE OR REPLACE FUNCTION greetings_open() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT e.greetings_on AND e.current_award_id IS NULL AND NOT e.show_hall FROM events e WHERE e.id = 1
$$;
--> statement-breakpoint

-- One gate for a greeting, decided where every server instance agrees (Postgres). Results:
--   closed   the switch is off, or the stage is not on the lobby scene
--   replay   this request id already passed in the last 60 s — answer "sent", publish nothing
--   busy     3 greetings already passed in the last second, system-wide (retry_after = 1)
--   too_soon this device greeted less than p_gap_seconds ago (retry_after = whole seconds left)
--   ok       the slot is taken; when the sender was a device never seen before, `scan` carries the new count
CREATE OR REPLACE FUNCTION greeting_gate(p_hash bytea, p_gap_seconds integer, p_request bytea, p_max_per_second integer)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_on boolean;
  v_rows integer;
  v_inserted boolean;
  v_last timestamptz;
  v_rev bigint;
BEGIN
  PERFORM 1 FROM lobby_stats WHERE id = 1 FOR UPDATE;

  SELECT greetings_on AND current_award_id IS NULL AND NOT show_hall INTO v_on FROM events WHERE id = 1;
  IF NOT COALESCE(v_on, false) THEN
    RETURN jsonb_build_object('result', 'closed');
  END IF;

  DELETE FROM greeting_requests WHERE at < clock_timestamp() - interval '60 seconds';
  IF EXISTS (SELECT 1 FROM greeting_requests WHERE request_hash = p_request) THEN
    RETURN jsonb_build_object('result', 'replay');
  END IF;
  IF (SELECT count(*) FROM greeting_requests WHERE at > clock_timestamp() - interval '1 second') >= p_max_per_second THEN
    RETURN jsonb_build_object('result', 'busy', 'retry_after', 1);
  END IF;

  INSERT INTO scanned_devices (device_hash, last_greet_at) VALUES (p_hash, clock_timestamp())
  ON CONFLICT (device_hash) DO UPDATE SET last_greet_at = clock_timestamp()
  WHERE scanned_devices.last_greet_at IS NULL
     OR scanned_devices.last_greet_at <= clock_timestamp() - make_interval(secs => p_gap_seconds)
  RETURNING (xmax = 0) INTO v_inserted;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    SELECT last_greet_at INTO v_last FROM scanned_devices WHERE device_hash = p_hash;
    RETURN jsonb_build_object(
      'result', 'too_soon',
      'retry_after', GREATEST(1, ceil(extract(epoch FROM (COALESCE(v_last, clock_timestamp()) + make_interval(secs => p_gap_seconds) - clock_timestamp()))))::integer
    );
  END IF;

  INSERT INTO greeting_requests (request_hash, at) VALUES (p_request, clock_timestamp());
  IF v_inserted THEN
    UPDATE lobby_stats SET scan_rev = scan_rev + 1 WHERE id = 1 RETURNING scan_rev INTO v_rev;
    RETURN jsonb_build_object('result', 'ok', 'scan', jsonb_build_object('count', (SELECT count(*) FROM scanned_devices), 'rev', v_rev));
  END IF;
  RETURN jsonb_build_object('result', 'ok');
END
$$;
--> statement-breakpoint

-- Publishing failed after the gate said ok: give the sender their slot back so "try again" works
CREATE OR REPLACE FUNCTION greeting_release(p_hash bytea, p_request bytea) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM lobby_stats WHERE id = 1 FOR UPDATE;
  DELETE FROM greeting_requests WHERE request_hash = p_request;
  UPDATE scanned_devices SET last_greet_at = NULL WHERE device_hash = p_hash;
  RETURN jsonb_build_object('ok', true);
END
$$;
