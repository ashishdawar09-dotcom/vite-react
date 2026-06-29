-- =============================================================================
-- schema_v16_security_hardening.sql
--
-- Closes two read-side data-exposure findings from the 2026-06-29 security
-- review. Idempotent — safe to re-run. Run in Supabase Dashboard → SQL Editor.
--
--   H1 — players.email was world-readable. `players` has RLS SELECT USING(true)
--        and the public anon key ships in the browser bundle, so anyone could
--        GET /rest/v1/players?select=email and dump every participant's email.
--        live_snapshot() (SECURITY DEFINER) also returned it to spectators, and
--        the public /p/:id page rendered it. This migration:
--          1. Rewrites live_snapshot() to omit email from the players JSON.
--          2. Revokes table-wide SELECT on players from anon AND authenticated,
--             re-granting only the non-PII columns. (Column-level REVOKE alone
--             is a no-op while a table-wide grant exists, so we revoke the table
--             grant first, then grant the safe column subset.)
--          3. Adds an admin-only SECURITY DEFINER admin_players() RPC so the
--             admin app can still read email (gated by is_admin()).
--
--   L1 — notification_log was public-read and stores error_message that can
--        embed a player email. No client reads it, so restrict SELECT to admins.
--
-- After this migration ONLY the service-role (edge functions) and the two
-- SECURITY DEFINER RPCs can read players.email — no client role can.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Sanity: is_admin() must exist (admin_players + notification_log depend on it)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'is_admin') THEN
    RAISE EXCEPTION 'public.is_admin() missing. Run schema_v6_perf_safety.sql first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Rewrite live_snapshot() — players JSON uses an explicit column list that
--    EXCLUDES email. Everything else is byte-for-byte identical to the v6
--    definition (teams/matches/categories/player_categories/generated_at), so
--    the spectator client shape is unchanged. SECURITY DEFINER is preserved.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION live_snapshot(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'tournament', (SELECT to_jsonb(t.*) FROM tournaments t WHERE t.id = p_tournament_id),
    'players',    (SELECT coalesce(jsonb_agg(jsonb_build_object(
                      'id', p.id,
                      'tournament_id', p.tournament_id,
                      'name', p.name,
                      'color', p.color,
                      'photo_url', p.photo_url,
                      'note', p.note,
                      'active', p.active,
                      'sort_order', p.sort_order,
                      'created_at', p.created_at,
                      'checked_in_at', p.checked_in_at
                  ) ORDER BY p.sort_order), '[]'::jsonb)
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

GRANT EXECUTE ON FUNCTION live_snapshot(uuid) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. admin_players() — admin-only read of full player rows (incl. email).
--    SECURITY DEFINER (runs as owner, bypasses the column grants below), but
--    refuses non-admins via is_admin(). The admin app calls this instead of a
--    direct players.select('*') so it still gets email.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_players(p_tournament_id uuid)
RETURNS SETOF public.players
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT * FROM public.players
     WHERE tournament_id = p_tournament_id
     ORDER BY sort_order;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_players(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_players(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Column-level lockdown of players.email for BOTH client roles.
--    Revoke the table-wide SELECT, then grant only the non-PII columns.
--    (A bare column REVOKE would be ignored while a table-wide grant exists.)
--    RLS policy `read players USING(true)` is intentionally LEFT INTACT —
--    privileges and RLS are independent layers; row visibility is unchanged,
--    only the email *column* becomes unreadable to client roles.
-- ---------------------------------------------------------------------------
REVOKE SELECT ON public.players FROM anon;
REVOKE SELECT ON public.players FROM authenticated;

GRANT SELECT (id, tournament_id, name, color, photo_url, note, active, sort_order, created_at, checked_in_at)
  ON public.players TO anon;
GRANT SELECT (id, tournament_id, name, color, photo_url, note, active, sort_order, created_at, checked_in_at)
  ON public.players TO authenticated;

-- Admins still INSERT/UPDATE/DELETE players (incl. setting email) via the RLS
-- write policy; those privileges are untouched. Only column SELECT is narrowed.

-- ---------------------------------------------------------------------------
-- 4. L1 — notification_log: restrict read to admins (no client reads it; its
--    error_message can embed a player email).
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_log_public_read ON public.notification_log;
DROP POLICY IF EXISTS notification_log_admin_read ON public.notification_log;
CREATE POLICY notification_log_admin_read ON public.notification_log
  FOR SELECT USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- 5. VERIFICATION — eyeball the Results pane.
-- ---------------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '====== v16 SECURITY VERIFICATION ======'; END $$;

-- Per-role column privileges on players.email — expect NO rows for anon/authenticated.
SELECT grantee, table_name, column_name, privilege_type
  FROM information_schema.column_privileges
 WHERE table_schema = 'public' AND table_name = 'players' AND column_name = 'email'
   AND grantee IN ('anon', 'authenticated')
 ORDER BY grantee;
DO $$ BEGIN RAISE NOTICE 'Expected above: ZERO rows (no anon/authenticated SELECT on players.email).'; END $$;

-- Safe columns still readable — expect rows for both roles (e.g. name).
SELECT grantee, column_name
  FROM information_schema.column_privileges
 WHERE table_schema = 'public' AND table_name = 'players' AND column_name = 'name'
   AND grantee IN ('anon', 'authenticated')
 ORDER BY grantee;
DO $$ BEGIN RAISE NOTICE 'Expected above: anon + authenticated CAN select players.name.'; END $$;

NOTIFY pgrst, 'reload schema';
