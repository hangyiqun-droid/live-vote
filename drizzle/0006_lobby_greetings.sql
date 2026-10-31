-- fix9: lobby counter ("scanned N people") + on-screen greetings. Additive only: one table, one
-- column with a default, new functions, and CREATE OR REPLACE of event_state() with the same
-- signature as 0003 (it only gains `greetings_on`).
--
-- Privacy (SPEC 2.2): scanned_devices holds an HMAC that is domain-separated from
-- ballots.device_hash (the server hashes "scan:<device id>"), so the two tables cannot be joined.
-- No nominee, no IP, no message. The greeting text never touches Postgres — it goes
-- phone → server → Ably → stage. last_greet_at only paces senders (one greeting per device per
-- N seconds) across serverless instances.
CREATE TABLE "scanned_devices" (
	"device_hash" "bytea" PRIMARY KEY NOT NULL,
	"last_greet_at" timestamp with time zone
);
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

-- A phone opened the vote page. `at` is Postgres' own clock in ms: the stage drops count
-- messages older than the newest it has seen, whichever server instance sent them.
CREATE OR REPLACE FUNCTION register_scan(p_hash bytea) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_rows integer;
BEGIN
  INSERT INTO scanned_devices (device_hash) VALUES (p_hash) ON CONFLICT (device_hash) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object(
    'new', v_rows > 0,
    'count', (SELECT count(*) FROM scanned_devices),
    'at', floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
  );
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION scan_count() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'count', (SELECT count(*) FROM scanned_devices),
    'at', floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
  )
$$;
--> statement-breakpoint

-- MC clears the counter after the rehearsal; everyone is counted again the next time they open the page
CREATE OR REPLACE FUNCTION reset_scans() RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM scanned_devices;
  INSERT INTO admin_log (action) VALUES ('reset_scans');
  RETURN jsonb_build_object('ok', true, 'count', 0, 'at', floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint);
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

-- One gate for a greeting, decided where every server instance agrees (Postgres):
--   closed    : the switch is off, or the stage is not on the lobby scene
--   too_soon  : this device greeted less than p_gap_seconds ago (retry_after = whole seconds left)
--   ok        : the slot is taken for this device
CREATE OR REPLACE FUNCTION greeting_gate(p_hash bytea, p_gap_seconds integer) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_on boolean;
  v_award smallint;
  v_hall boolean;
  v_rows integer;
  v_last timestamptz;
BEGIN
  SELECT greetings_on, current_award_id, show_hall INTO v_on, v_award, v_hall FROM events WHERE id = 1;
  IF NOT COALESCE(v_on, false) OR v_award IS NOT NULL OR COALESCE(v_hall, false) THEN
    RETURN jsonb_build_object('result', 'closed');
  END IF;

  INSERT INTO scanned_devices (device_hash, last_greet_at) VALUES (p_hash, clock_timestamp())
  ON CONFLICT (device_hash) DO UPDATE SET last_greet_at = clock_timestamp()
  WHERE scanned_devices.last_greet_at IS NULL
     OR scanned_devices.last_greet_at <= clock_timestamp() - make_interval(secs => p_gap_seconds);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 THEN
    RETURN jsonb_build_object('result', 'ok');
  END IF;

  SELECT last_greet_at INTO v_last FROM scanned_devices WHERE device_hash = p_hash;
  RETURN jsonb_build_object(
    'result', 'too_soon',
    'retry_after', GREATEST(1, ceil(extract(epoch FROM (COALESCE(v_last, clock_timestamp()) + make_interval(secs => p_gap_seconds) - clock_timestamp()))))::integer
  );
END
$$;
