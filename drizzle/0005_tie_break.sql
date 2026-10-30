-- req1: equal scores are decided by who reached that score first (SPEC 5.3). Additive only:
-- one nullable column, CREATE OR REPLACE with the same signatures as 0001.
--
-- last_vote_at never leaves Postgres: snapshots carry only the resulting `order` (nominee ids), and
-- it sits on the per-nominee board, which has no device column. ballots still has neither nominee
-- nor time (SPEC 2.2). NULL = no votes yet, or votes counted before this migration: such a row
-- ranks after anyone timed on the same score, then by nominee id.
ALTER TABLE "tallies" ADD COLUMN "last_vote_at" timestamp with time zone;
--> statement-breakpoint

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
      WHERE t.award_id = a.id AND n.active), '[]'::jsonb),
    'order', COALESCE((
      SELECT jsonb_agg(t.nominee_id ORDER BY t.votes DESC, t.last_vote_at ASC NULLS LAST, t.nominee_id)
      FROM tallies t JOIN nominees n ON n.id = t.nominee_id
      WHERE t.award_id = a.id AND n.active), '[]'::jsonb)
  )
  FROM awards a WHERE a.id = p_award
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
  v_at timestamptz;
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

  -- clock_timestamp(), not now(): now() is when the transaction began, before the queue above, so
  -- it could put a vote that waited in line ahead of the one counted before it
  v_at := clock_timestamp();
  UPDATE tallies SET votes = votes + 1, last_vote_at = v_at WHERE award_id = p_award AND nominee_id = p_nominee;
  IF NOT FOUND THEN
    INSERT INTO tallies (award_id, nominee_id, votes, last_vote_at) VALUES (p_award, p_nominee, 1, v_at);
  END IF;
  UPDATE awards SET seq = seq + 1 WHERE id = p_award;

  RETURN jsonb_build_object('result', 'counted', 'snapshot', award_snapshot(p_award));
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
  UPDATE tallies SET votes = 0, last_vote_at = NULL WHERE award_id = p_award;
  UPDATE awards SET status = 'pending', opened_at = NULL, closed_at = NULL, revealed_at = NULL,
    auto_close_at = NULL, round = round + 1, seq = seq + 1
  WHERE id = p_award;
  UPDATE events SET version = version + 1, updated_at = now() WHERE id = 1;
  INSERT INTO admin_log (action, award_id) VALUES ('reset', p_award);
  RETURN jsonb_build_object('ok', true, 'award', award_snapshot(p_award));
END
$$;
