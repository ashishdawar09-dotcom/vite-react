-- =============================================================================
-- schema_v6_fix_start_match.sql
-- Bugfix: start_match_on_court was using FOR UPDATE with count(*), which
-- Postgres rejects ("FOR UPDATE is not allowed with aggregate functions").
--
-- The fix: lock the candidate rows in an explicit subquery first, then count.
-- We use pg_advisory_xact_lock keyed on (tournament_id, court) so only one
-- transaction at a time can decide if a court is free — same atomicity
-- guarantee, no row-aggregate conflict.
--
-- Run this in Supabase SQL editor. Idempotent.
-- =============================================================================

CREATE OR REPLACE FUNCTION start_match_on_court(p_match_id uuid, p_court int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tid uuid;
  v_busy int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT tournament_id INTO v_tid FROM matches WHERE id = p_match_id;
  IF v_tid IS NULL THEN RETURN false; END IF;

  -- Serialize concurrent attempts to start on the same (tournament, court).
  -- Advisory lock auto-releases at end of transaction.
  PERFORM pg_advisory_xact_lock(
    hashtext(v_tid::text || '|' || p_court::text)::bigint
  );

  -- Now safely check occupancy without aggregate-vs-FOR-UPDATE conflict.
  SELECT count(*) INTO v_busy
    FROM matches
   WHERE tournament_id = v_tid
     AND court_number = p_court
     AND status = 'live'
     AND id <> p_match_id;

  IF v_busy > 0 THEN
    RETURN false;
  END IF;

  UPDATE matches
     SET status = 'live',
         started_at = now(),
         court_number = p_court
   WHERE id = p_match_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION start_match_on_court(uuid, int) TO authenticated;
