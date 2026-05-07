-- =============================================================================
-- schema_v6_perf_safety.sql
-- Performance + safety hardening for 500+ concurrent users.
--
-- Run this against your Supabase Postgres (SQL editor) ONCE.
-- Idempotent: safe to re-run.
--
-- Includes:
--   1. Composite indexes for hot read paths
--   2. Atomic RPC functions (eliminate race conditions in extend/start/swap)
--   3. Audit log table + trigger on `matches`
--   4. Multi-admin support (tournament_admins table + updated is_admin())
--   5. live_snapshot() RPC for spectator polling (single round-trip)
-- =============================================================================

-- 1. INDEXES ------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_matches_tid_status
  ON matches (tournament_id, status);

CREATE INDEX IF NOT EXISTS idx_matches_tid_court
  ON matches (tournament_id, court_number)
  WHERE court_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_matches_tid_scheduled
  ON matches (tournament_id, scheduled_at)
  WHERE scheduled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_matches_tid_category_status
  ON matches (tournament_id, category_id, status);

CREATE INDEX IF NOT EXISTS idx_player_categories_player
  ON player_categories (player_id);

CREATE INDEX IF NOT EXISTS idx_player_categories_category
  ON player_categories (category_id);


-- 2. MULTI-ADMIN SUPPORT ------------------------------------------------------

CREATE TABLE IF NOT EXISTS tournament_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  added_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tournament_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tournament_admins_read ON tournament_admins;
CREATE POLICY tournament_admins_read ON tournament_admins FOR SELECT USING (true);

-- Seed initial admin from existing hardcoded email if missing
INSERT INTO tournament_admins (email)
VALUES (lower('Ashishdawar09@gmail.com'))
ON CONFLICT (email) DO NOTHING;

-- Updated is_admin() now consults the table
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tournament_admins
    WHERE lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;


-- 3. ATOMIC RPCs --------------------------------------------------------------

-- Atomically increment extended_minutes (eliminates lost-update race).
CREATE OR REPLACE FUNCTION extend_match(p_match_id uuid, p_extra_minutes int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE matches
     SET extended_minutes = COALESCE(extended_minutes, 0) + p_extra_minutes
   WHERE id = p_match_id;
END;
$$;

-- Start a match on a court ONLY if that court is currently free.
-- Returns true on success, false if the court is already occupied.
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

  -- Check court occupancy with a row-lock to prevent two concurrent starts.
  SELECT count(*) INTO v_busy
    FROM matches
   WHERE tournament_id = v_tid
     AND court_number = p_court
     AND status = 'live'
     AND id <> p_match_id
   FOR UPDATE;

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

-- Atomic queue-position swap.
CREATE OR REPLACE FUNCTION swap_match_queue_positions(
  p_id1 uuid, p_pos1 int,
  p_id2 uuid, p_pos2 int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  -- Lock both rows to prevent interleaved updates.
  PERFORM 1 FROM matches WHERE id IN (p_id1, p_id2) FOR UPDATE;
  UPDATE matches SET queue_position = p_pos2 WHERE id = p_id1;
  UPDATE matches SET queue_position = p_pos1 WHERE id = p_id2;
END;
$$;

-- Atomic player-category replace (delete+insert in one transaction).
CREATE OR REPLACE FUNCTION set_player_categories(
  p_player_id uuid,
  p_category_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  DELETE FROM player_categories
   WHERE player_id = p_player_id
     AND (p_category_ids IS NULL OR NOT (category_id = ANY(p_category_ids)));
  IF p_category_ids IS NOT NULL AND array_length(p_category_ids, 1) > 0 THEN
    INSERT INTO player_categories (player_id, category_id)
    SELECT p_player_id, unnest(p_category_ids)
    ON CONFLICT (player_id, category_id) DO NOTHING;
  END IF;
END;
$$;


-- 4. AUDIT LOG ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS match_audit_log (
  id bigserial PRIMARY KEY,
  match_id uuid NOT NULL,
  tournament_id uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by text,
  action text NOT NULL,        -- 'insert' | 'update' | 'delete'
  before_data jsonb,
  after_data jsonb,
  changed_fields text[]
);

CREATE INDEX IF NOT EXISTS idx_match_audit_match
  ON match_audit_log (match_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_match_audit_tournament
  ON match_audit_log (tournament_id, changed_at DESC);

ALTER TABLE match_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_audit_read ON match_audit_log;
CREATE POLICY match_audit_read ON match_audit_log FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION log_match_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor text := coalesce(auth.jwt() ->> 'email', 'system');
  v_changed text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO match_audit_log (match_id, tournament_id, changed_by, action, after_data)
    VALUES (NEW.id, NEW.tournament_id, v_actor, 'insert', to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Determine which fields changed (only score/status/winner are interesting).
    IF NEW.score_a IS DISTINCT FROM OLD.score_a THEN v_changed := array_append(v_changed, 'score_a'); END IF;
    IF NEW.score_b IS DISTINCT FROM OLD.score_b THEN v_changed := array_append(v_changed, 'score_b'); END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN v_changed := array_append(v_changed, 'status'); END IF;
    IF NEW.winner_id IS DISTINCT FROM OLD.winner_id THEN v_changed := array_append(v_changed, 'winner_id'); END IF;
    IF NEW.court_number IS DISTINCT FROM OLD.court_number THEN v_changed := array_append(v_changed, 'court_number'); END IF;
    IF NEW.confirmed IS DISTINCT FROM OLD.confirmed THEN v_changed := array_append(v_changed, 'confirmed'); END IF;
    IF array_length(v_changed, 1) > 0 THEN
      INSERT INTO match_audit_log (match_id, tournament_id, changed_by, action, before_data, after_data, changed_fields)
      VALUES (NEW.id, NEW.tournament_id, v_actor, 'update', to_jsonb(OLD), to_jsonb(NEW), v_changed);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO match_audit_log (match_id, tournament_id, changed_by, action, before_data)
    VALUES (OLD.id, OLD.tournament_id, v_actor, 'delete', to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_match_audit ON matches;
CREATE TRIGGER trg_match_audit
AFTER INSERT OR UPDATE OR DELETE ON matches
FOR EACH ROW EXECUTE FUNCTION log_match_change();


-- 5. live_snapshot() — single-call spectator snapshot ------------------------

CREATE OR REPLACE FUNCTION live_snapshot(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'tournament', (SELECT to_jsonb(t.*) FROM tournaments t WHERE t.id = p_tournament_id),
    'players',    (SELECT coalesce(jsonb_agg(p ORDER BY p.sort_order), '[]'::jsonb)
                   FROM players p WHERE p.tournament_id = p_tournament_id),
    'teams',      (SELECT coalesce(jsonb_agg(t ORDER BY t.sort_order), '[]'::jsonb)
                   FROM teams t WHERE t.tournament_id = p_tournament_id),
    'matches',    (SELECT coalesce(jsonb_agg(m ORDER BY m.slot_idx), '[]'::jsonb)
                   FROM matches m WHERE m.tournament_id = p_tournament_id),
    'categories', (SELECT coalesce(jsonb_agg(c ORDER BY c.sort_order), '[]'::jsonb)
                   FROM categories c WHERE c.tournament_id = p_tournament_id),
    'player_categories',
                  (SELECT coalesce(jsonb_agg(jsonb_build_object(
                      'id', pc.id, 'player_id', pc.player_id, 'category_id', pc.category_id
                  )), '[]'::jsonb)
                   FROM player_categories pc
                   JOIN players p ON p.id = pc.player_id
                   WHERE p.tournament_id = p_tournament_id),
    'generated_at', extract(epoch from now())
  );
$$;

-- Allow anonymous read access to live_snapshot.
GRANT EXECUTE ON FUNCTION live_snapshot(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION extend_match(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION start_match_on_court(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION swap_match_queue_positions(uuid, int, uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION set_player_categories(uuid, uuid[]) TO authenticated;

-- =============================================================================
-- DONE.
-- =============================================================================
