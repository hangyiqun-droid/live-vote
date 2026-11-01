-- Admin (MC) page. Additive only — replaces functions from 0001 with the same signatures and adds new ones.

-- Award statuses without any counts — safe to send to phones (+ hall / backup-QR flags)
CREATE OR REPLACE FUNCTION event_state() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'version', e.version,
    'title', e.title,
    'current_award_id', e.current_award_id,
    'hide_counts', e.hide_counts,
    'show_hall', e.show_hall,
    'qr_fallback', e.qr_fallback,
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

-- Status machine. Same status again = ok/unchanged (idempotent retries).
-- Opening or revealing an award also puts it on screen and takes the hall down.
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
    UPDATE events SET current_award_id = p_award, show_hall = false WHERE id = 1;
  ELSIF p_status = 'closed' THEN
    UPDATE awards SET status = 'closed',
      closed_at = CASE WHEN v_cur = 'open' THEN now() ELSE closed_at END,
      auto_close_at = CASE WHEN v_cur = 'open' THEN NULL ELSE auto_close_at END,
      revealed_at = NULL, seq = seq + 1
    WHERE id = p_award;
  ELSE -- revealed
    UPDATE awards SET status = 'revealed', revealed_at = now(), seq = seq + 1 WHERE id = p_award;
    UPDATE events SET current_award_id = p_award, show_hall = false WHERE id = 1;
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

-- NULL = back to lobby. Choosing an award to show always takes the hall down.
CREATE OR REPLACE FUNCTION set_current_award(p_award smallint) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF p_award IS NOT NULL AND NOT EXISTS (SELECT 1 FROM awards WHERE id = p_award) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  UPDATE events SET current_award_id = p_award, show_hall = false, version = version + 1, updated_at = now()
  WHERE id = 1;
  INSERT INTO admin_log (action, award_id) VALUES ('set_current', p_award);
  RETURN jsonb_build_object('ok', true);
END
$$;
--> statement-breakpoint

-- Hall of winners on/off. Off = back to whatever award is current.
CREATE OR REPLACE FUNCTION set_show_hall(p_show boolean) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE events SET show_hall = p_show, version = version + 1, updated_at = now() WHERE id = 1;
  INSERT INTO admin_log (action) VALUES (CASE WHEN p_show THEN 'hall_on' ELSE 'hall_off' END);
  RETURN jsonb_build_object('ok', true);
END
$$;
--> statement-breakpoint

-- Stage QR → backup URL
CREATE OR REPLACE FUNCTION set_qr_fallback(p_on boolean) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE events SET qr_fallback = p_on, version = version + 1, updated_at = now() WHERE id = 1;
  INSERT INTO admin_log (action) VALUES (CASE WHEN p_on THEN 'qr_fallback_on' ELSE 'qr_fallback_off' END);
  RETURN jsonb_build_object('ok', true);
END
$$;
--> statement-breakpoint

-- MC renames an award (allowed in any status)
CREATE OR REPLACE FUNCTION set_award_title(p_award smallint, p_title text, p_subtitle text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_title text := btrim(COALESCE(p_title, ''));
  v_sub text := NULLIF(btrim(COALESCE(p_subtitle, '')), '');
BEGIN
  IF char_length(v_title) = 0 OR char_length(v_title) > 80 OR char_length(COALESCE(v_sub, '')) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_title');
  END IF;
  UPDATE awards SET title = v_title, subtitle = v_sub WHERE id = p_award;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  UPDATE events SET version = version + 1, updated_at = now() WHERE id = 1;
  INSERT INTO admin_log (action, award_id) VALUES ('rename', p_award);
  RETURN jsonb_build_object('ok', true);
END
$$;
--> statement-breakpoint

-- Everything the MC page needs in one round trip: statuses + every award's tally + ballot check
CREATE OR REPLACE FUNCTION admin_overview() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'state', event_state(),
    'tallies', COALESCE((
      SELECT jsonb_agg(award_snapshot(a.id) || jsonb_build_object('verified', verify_tallies(a.id)) ORDER BY a.sort_order)
      FROM awards a), '[]'::jsonb)
  )
$$;
