-- =============================================================================
-- schema_v14_rls_audit.sql
-- RLS hardening sweep. Re-asserts the correct row-level-security policy on
-- every table the client touches, regardless of what's currently in place.
--
-- Why: the production policy on player_categories was originally written as
-- "FOR ALL USING (true) WITH CHECK (true)" in schema_v5.sql (wide-open) and
-- later fixed in fix_rls_player_categories.sql. We can't be sure from the
-- repo alone which version is actually live in prod. This migration:
--   1. Re-asserts every policy from scratch (idempotent DROP + CREATE)
--   2. Prints a verification block at the end so the operator can EYEBALL
--      that every table is enabled + every write is admin-gated
--
-- Safe to run repeatedly. Run in Supabase Dashboard → SQL Editor.
--
-- Author: 2026-05-25 RLS audit.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Confirm the server-side admin check exists.
-- ---------------------------------------------------------------------------
-- is_admin() consults tournament_admins; defined in schema_v6_perf_safety.sql.
-- If this function is missing, every "admin write" policy below silently
-- denies all writes — bad. Surface it loudly:
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'is_admin') THEN
    RAISE EXCEPTION 'public.is_admin() function missing. Run schema_v6_perf_safety.sql first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. CORE TABLES: public read, admin-only write
--    tournaments, players, teams, matches, categories
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tournaments', 'players', 'teams', 'matches', 'categories'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "read %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "read %1$s" ON public.%1$I FOR SELECT USING (true)', t);
    EXECUTE format('DROP POLICY IF EXISTS "admin write %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "admin write %1$s" ON public.%1$I FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin())', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. player_categories: this is the one that was historically wide-open.
--    Re-assert: public read, admin-only write.
-- ---------------------------------------------------------------------------
ALTER TABLE public.player_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS player_categories_read ON public.player_categories;
DROP POLICY IF EXISTS "player_categories_read" ON public.player_categories;
CREATE POLICY player_categories_read ON public.player_categories
  FOR SELECT USING (true);

DROP POLICY IF EXISTS player_categories_write ON public.player_categories;
DROP POLICY IF EXISTS "player_categories_write" ON public.player_categories;
CREATE POLICY player_categories_write ON public.player_categories
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. tournament_admins: admin write; self-or-admin read.
--    (Self-read lets useAuth determine isAdmin without leaking the full list.)
-- ---------------------------------------------------------------------------
ALTER TABLE public.tournament_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tournament_admins_read ON public.tournament_admins;
DROP POLICY IF EXISTS tournament_admins_read_self ON public.tournament_admins;
CREATE POLICY tournament_admins_read_self ON public.tournament_admins
  FOR SELECT
  USING (
    public.is_admin()
    OR lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

DROP POLICY IF EXISTS tournament_admins_admin_write ON public.tournament_admins;
CREATE POLICY tournament_admins_admin_write ON public.tournament_admins
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. match_audit_log: public read, NO client write (only the trigger writes
--    via SECURITY DEFINER; no policy = blocked from clients).
-- ---------------------------------------------------------------------------
ALTER TABLE public.match_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_audit_read ON public.match_audit_log;
CREATE POLICY match_audit_read ON public.match_audit_log FOR SELECT USING (true);
-- intentionally no INSERT/UPDATE/DELETE policy

-- ---------------------------------------------------------------------------
-- 5. pending_registrations: admin read, NO client write
--    (writes via submit-public-registration Edge Function with service-role
--    key, or via approve_registration/reject_registration SECURITY DEFINER RPCs).
-- ---------------------------------------------------------------------------
ALTER TABLE public.pending_registrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pending_reg_admin_read ON public.pending_registrations;
CREATE POLICY pending_reg_admin_read ON public.pending_registrations
  FOR SELECT USING (public.is_admin());
-- intentionally no INSERT/UPDATE/DELETE policy

-- ---------------------------------------------------------------------------
-- 6. push_subscriptions: admin read, NO client write
--    (writes via subscribe-push Edge Function with service-role key).
-- ---------------------------------------------------------------------------
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_subs_admin_read ON public.push_subscriptions;
CREATE POLICY push_subs_admin_read ON public.push_subscriptions
  FOR SELECT USING (public.is_admin());
-- intentionally no INSERT/UPDATE/DELETE policy

-- ---------------------------------------------------------------------------
-- 7. notification_log: public read (lets us show "X notified" badges in UI),
--    NO client write (Edge Function only via service-role).
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_log_public_read ON public.notification_log;
CREATE POLICY notification_log_public_read ON public.notification_log
  FOR SELECT USING (true);
-- intentionally no INSERT/UPDATE/DELETE policy

-- ---------------------------------------------------------------------------
-- 8. STORAGE: player-photos bucket — public read, admin write
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "public read photos" ON storage.objects;
CREATE POLICY "public read photos" ON storage.objects FOR SELECT
  USING (bucket_id = 'player-photos');

DROP POLICY IF EXISTS "admin write photos" ON storage.objects;
CREATE POLICY "admin write photos" ON storage.objects FOR ALL
  USING (bucket_id = 'player-photos' AND public.is_admin())
  WITH CHECK (bucket_id = 'player-photos' AND public.is_admin());

-- ---------------------------------------------------------------------------
-- 9. VERIFICATION BLOCK
--    Print the current policy state so the operator running this migration
--    can read it in the SQL Editor's "Results" pane and confirm by eye:
--      - every table has rls = true
--      - every table the client mutates has at least one admin-only write policy
--      - no table has "true" as a write qualifier (== wide open)
-- ---------------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '====== RLS POLICY STATE ======'; END $$;

-- All rls-enabled tables in public schema
WITH t AS (
  SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND c.relname IN (
       'tournaments','players','teams','matches','categories',
       'player_categories','tournament_admins','match_audit_log',
       'pending_registrations','push_subscriptions','notification_log'
     )
)
SELECT table_name, rls_enabled FROM t ORDER BY table_name;

-- Every policy on every audited table — qualifier + check expression visible.
-- Look for cmd='ALL'/'INSERT'/'UPDATE'/'DELETE' rows whose qual contains
-- "true" without "is_admin()" — those are the dangerous ones.
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual    AS using_clause,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'tournaments','players','teams','matches','categories',
    'player_categories','tournament_admins','match_audit_log',
    'pending_registrations','push_subscriptions','notification_log'
  )
ORDER BY tablename, cmd, policyname;

DO $$ BEGIN RAISE NOTICE '====== RLS AUDIT COMPLETE ======'; END $$;
DO $$ BEGIN RAISE NOTICE 'Expected: every table rls_enabled=true.'; END $$;
DO $$ BEGIN RAISE NOTICE 'Expected: every non-SELECT policy on a client-mutated table calls is_admin().'; END $$;
DO $$ BEGIN RAISE NOTICE 'Expected: NO policy with qual="true" on cmd != SELECT.'; END $$;

NOTIFY pgrst, 'reload schema';
