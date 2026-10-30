-- fix3: one lock order for every function that writes both tables — events (id = 1) first, then awards.
-- Additive only: CREATE OR REPLACE with the same signatures as 0001/0003.
--
-- Audit of every PL/pgSQL function (v0.5.2):
--   set_award_status, extend_award, reset_award  events → awards                    ok (unchanged)
--   set_current_award                             events → FK key-share on awards   ok (unchanged)
--   set_hide_counts, set_show_hall, set_qr_fallback  events only                    ok (unchanged)
--   cast_vote                                     awards only, never events         ok (unchanged)
--   expire_awards                                 awards → events                   FIXED below
--   set_award_title                               awards → events                   FIXED below
-- An expired countdown closed by a reader while the MC pressed a button deadlocked (fix2 report).

-- Close every open award whose countdown has run out. Idempotent; returns the ids it closed.
-- Readers call this on every state fetch, so the common "nothing to close" case takes no lock at all.
CREATE OR REPLACE FUNCTION expire_awards() RETURNS smallint[]
LANGUAGE plpgsql AS $$
DECLARE
  v_ids smallint[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM awards WHERE status = 'open' AND auto_close_at IS NOT NULL AND now() >= auto_close_at
  ) THEN
    RETURN '{}';
  END IF;

  PERFORM 1 FROM events WHERE id = 1 FOR UPDATE; -- lock order: events before awards
  -- Re-checked under the lock: a racing reader or MC action may have closed it already
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

-- MC renames an award while the real names are not in yet (allowed in any status)
CREATE OR REPLACE FUNCTION set_award_title(p_award smallint, p_title text, p_subtitle text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_title text := btrim(COALESCE(p_title, ''));
  v_sub text := NULLIF(btrim(COALESCE(p_subtitle, '')), '');
BEGIN
  IF char_length(v_title) = 0 OR char_length(v_title) > 80 OR char_length(COALESCE(v_sub, '')) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_title');
  END IF;
  PERFORM 1 FROM events WHERE id = 1 FOR UPDATE; -- lock order: events before awards
  UPDATE awards SET title = v_title, subtitle = v_sub WHERE id = p_award;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  UPDATE events SET version = version + 1, updated_at = now() WHERE id = 1;
  INSERT INTO admin_log (action, award_id) VALUES ('rename', p_award);
  RETURN jsonb_build_object('ok', true);
END
$$;
