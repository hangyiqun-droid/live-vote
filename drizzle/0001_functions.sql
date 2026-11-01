-- All counting and state transitions happen inside Postgres,
-- one function call = one round trip = one transaction. Called from the server only.

-- Full tally of one award (what the stage needs after reconnecting)
CREATE OR REPLACE FUNCTION award_snapshot(p_award smallint) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'award_id', a.id,
    'seq', a.seq,
    'status', a.status,
    'round', a.round,
    'auto_close_at', a.auto_close_at,
    'total', COALESCE((
      SELECT sum(t.votes) FROM tallies t JOIN nominees n ON n.id = t.nominee_id
      WHERE t.award_id = a.id AND n.active), 0),
    'counts', COALESCE((
      SELECT jsonb_agg(jsonb_build_array(t.nominee_id, t.votes) ORDER BY t.nominee_id)
      FROM tallies t JOIN nominees n ON n.id = t.nominee_id
      WHERE t.award_id = a.id AND n.active), '[]'::jsonb)
  )
  FROM awards a WHERE a.id = p_award
$$;
--> statement-breakpoint

-- Award statuses without any counts — safe to send to phones
CREATE OR REPLACE FUNCTION event_state() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'version', e.version,
    'title', e.title,
    'current_award_id', e.current_award_id,
    'hide_counts', e.hide_counts,
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

-- Close every open award whose countdown has run out. Idempotent; returns the ids it closed.
CREATE OR REPLACE FUNCTION expire_awards() RETURNS smallint[]
LANGUAGE plpgsql AS $$
DECLARE
  v_ids smallint[];
BEGIN
  WITH x AS (
    UPDATE awards SET status = 'closed', closed_at = auto_close_at, seq = seq + 1
    WHERE status = 'open' AND auto_close_at IS NOT NULL AND now() >= auto_close_at
    RETURNING id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO v_ids FROM x;
  IF cardinality(v_ids) > 0 THEN
    UPDATE events SET version = version + 1, updated_at = now() WHERE id = 1;
    INSERT INTO admin_log (action, award_id) SELECT 'expire', unnest(v_ids);
  END IF;
  RETURN v_ids;
END
$$;
--> statement-breakpoint

-- One vote. The (award_id, device_hash) primary key is the anti-double-vote rule.
-- Results: counted (+snapshot when newly counted) | already_voted | not_open | invalid_nominee
CREATE OR REPLACE FUNCTION cast_vote(p_award smallint, p_nominee smallint, p_device_hash bytea, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_status award_status;
  v_auto timestamptz;
  v_existing uuid;
BEGIN
  -- Row lock: votes for one award queue up one by one, so seq is always ordered
  SELECT status, auto_close_at INTO v_status, v_auto FROM awards WHERE id = p_award FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_open', 'status', NULL);
  END IF;

  -- A retry of a vote that already landed answers "counted" even if voting has closed since
  SELECT request_id INTO v_existing FROM ballots WHERE award_id = p_award AND device_hash = p_device_hash;
  IF FOUND THEN
    IF v_existing = p_request_id THEN
      RETURN jsonb_build_object('result', 'counted', 'replay', true);
    END IF;
    RETURN jsonb_build_object('result', 'already_voted');
  END IF;

  IF v_status <> 'open' OR (v_auto IS NOT NULL AND now() >= v_auto) THEN
    RETURN jsonb_build_object('result', 'not_open',
      'status', CASE WHEN v_status = 'open' THEN 'closed' ELSE v_status::text END);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM nominees WHERE id = p_nominee AND active) THEN
    RETURN jsonb_build_object('result', 'invalid_nominee');
  END IF;

  INSERT INTO ballots (award_id, device_hash, request_id)
  VALUES (p_award, p_device_hash, p_request_id)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'already_voted');
  END IF;

  UPDATE tallies SET votes = votes + 1 WHERE award_id = p_award AND nominee_id = p_nominee;
  IF NOT FOUND THEN
    INSERT INTO tallies (award_id, nominee_id, votes) VALUES (p_award, p_nominee, 1);
  END IF;
  UPDATE awards SET seq = seq + 1 WHERE id = p_award;

  RETURN jsonb_build_object('result', 'counted', 'snapshot', award_snapshot(p_award));
END
$$;
--> statement-breakpoint

-- Status machine. Same status again = ok/unchanged (idempotent retries).
CREATE OR REPLACE FUNCTION set_award_status(p_award smallint, p_status award_status, p_auto_close_seconds integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_cur award_status;
BEGIN
  PERFORM 1 FROM events WHERE id = 1 FOR UPDATE; -- serialise all state changes
  PERFORM expire_awards();

  SELECT status INTO v_cur FROM awards WHERE id = p_award FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_cur = p_status THEN
    RETURN jsonb_build_object('ok', true, 'unchanged', true, 'award', award_snapshot(p_award));
  END IF;
  IF NOT (
    (v_cur = 'pending' AND p_status = 'open') OR
    (v_cur = 'open' AND p_status = 'closed') OR
    (v_cur = 'closed' AND p_status IN ('open', 'revealed')) OR
    (v_cur = 'revealed' AND p_status = 'closed')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_transition', 'from', v_cur, 'to', p_status);
  END IF;

  IF p_status = 'open' THEN
    IF EXISTS (SELECT 1 FROM awards WHERE status = 'open' AND id <> p_award) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'another_open');
    END IF;
    UPDATE awards SET status = 'open', opened_at = now(), closed_at = NULL,
      auto_close_at = CASE WHEN COALESCE(p_auto_close_seconds, 0) > 0
                           THEN now() + make_interval(secs => p_auto_close_seconds) END,
      seq = seq + 1
    WHERE id = p_award;
    UPDATE events SET current_award_id = p_award WHERE id = 1;
  ELSIF p_status = 'closed' THEN
    UPDATE awards SET status = 'closed',
      closed_at = CASE WHEN v_cur = 'open' THEN now() ELSE closed_at END,
      auto_close_at = CASE WHEN v_cur = 'open' THEN NULL ELSE auto_close_at END,
      revealed_at = NULL, seq = seq + 1
    WHERE id = p_award;
  ELSE -- revealed
    UPDATE awards SET status = 'revealed', revealed_at = now(), seq = seq + 1 WHERE id = p_award;
  END IF;

  UPDATE events SET version = version + 1, updated_at = now() WHERE id = 1;
  INSERT INTO admin_log (action, award_id) VALUES (
    CASE WHEN v_cur = 'closed' AND p_status = 'open' THEN 'reopen'
         WHEN v_cur = 'revealed' THEN 'unreveal'
         ELSE p_status::text END, p_award);
  RETURN jsonb_build_object('ok', true, 'award', award_snapshot(p_award));
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION extend_award(p_award smallint, p_seconds integer) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM events WHERE id = 1 FOR UPDATE;
  UPDATE awards SET auto_close_at = GREATEST(COALESCE(auto_close_at, now()), now()) + make_interval(secs => p_seconds),
    seq = seq + 1
  WHERE id = p_award AND status = 'open' AND (auto_close_at IS NULL OR now() < auto_close_at);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_open');
  END IF;
  UPDATE events SET version = version + 1, updated_at = now() WHERE id = 1;
  INSERT INTO admin_log (action, award_id) VALUES ('extend', p_award);
  RETURN jsonb_build_object('ok', true, 'award', award_snapshot(p_award));
END
$$;
--> statement-breakpoint

-- NULL = back to lobby
CREATE OR REPLACE FUNCTION set_current_award(p_award smallint) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE events SET current_award_id = p_award, version = version + 1, updated_at = now() WHERE id = 1;
  INSERT INTO admin_log (action, award_id) VALUES ('set_current', p_award);
  RETURN jsonb_build_object('ok', true);
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION set_hide_counts(p_hide boolean) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE events SET hide_counts = p_hide, version = version + 1, updated_at = now() WHERE id = 1;
  INSERT INTO admin_log (action) VALUES ('hide_counts');
  RETURN jsonb_build_object('ok', true);
END
$$;
--> statement-breakpoint

-- Wipe one award back to pending (only from pending/closed). Bumps round so phones forget old picks.
CREATE OR REPLACE FUNCTION reset_award(p_award smallint) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_cur award_status;
BEGIN
  PERFORM 1 FROM events WHERE id = 1 FOR UPDATE;
  SELECT status INTO v_cur FROM awards WHERE id = p_award FOR UPDATE;
  IF NOT FOUND OR v_cur NOT IN ('pending', 'closed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_transition');
  END IF;
  DELETE FROM ballots WHERE award_id = p_award;
  UPDATE tallies SET votes = 0 WHERE award_id = p_award;
  UPDATE awards SET status = 'pending', opened_at = NULL, closed_at = NULL, revealed_at = NULL,
    auto_close_at = NULL, round = round + 1, seq = seq + 1
  WHERE id = p_award;
  UPDATE events SET version = version + 1, updated_at = now() WHERE id = 1;
  INSERT INTO admin_log (action, award_id) VALUES ('reset', p_award);
  RETURN jsonb_build_object('ok', true, 'award', award_snapshot(p_award));
END
$$;
--> statement-breakpoint

-- Every ballot has exactly one vote on the board
CREATE OR REPLACE FUNCTION verify_tallies(p_award smallint) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT sum(votes) FROM tallies WHERE award_id = p_award), 0)
       = (SELECT count(*) FROM ballots WHERE award_id = p_award)
$$;
