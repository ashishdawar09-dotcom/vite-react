-- =============================================================================
-- schema_v7_admin_self_service.sql
-- Make tournament_admins the single source of truth for admin status, and
-- let existing admins manage the list themselves (no more SQL inserts).
--
-- Run in Supabase SQL editor. Idempotent.
-- =============================================================================

ALTER TABLE tournament_admins ENABLE ROW LEVEL SECURITY;

-- Drop any v6 policies before recreating with stricter rules.
DROP POLICY IF EXISTS tournament_admins_read       ON tournament_admins;
DROP POLICY IF EXISTS tournament_admins_admin_write ON tournament_admins;
DROP POLICY IF EXISTS tournament_admins_read_self  ON tournament_admins;

-- READ: an admin can read all rows; any authenticated user can read THEIR
-- OWN row so the client can determine isAdmin without privilege escalation.
CREATE POLICY tournament_admins_read_self ON tournament_admins
  FOR SELECT
  USING (
    is_admin()
    OR lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- INSERT / UPDATE / DELETE: existing admins only.
CREATE POLICY tournament_admins_admin_write ON tournament_admins
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Case-insensitive uniqueness so 'Foo@x.com' and 'foo@x.com' aren't dupes.
CREATE UNIQUE INDEX IF NOT EXISTS tournament_admins_email_lower_idx
  ON tournament_admins (lower(email));

-- Keep the existing email TEXT column itself unique too (defensive).
-- (Already PK-style in v6 schema; this is no-op if already present.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tournament_admins_email_key'
  ) THEN
    -- The v6 schema declared `email text NOT NULL UNIQUE`, so this branch
    -- usually does nothing. Kept for safety on environments that drifted.
    NULL;
  END IF;
END $$;

-- =============================================================================
-- DONE.
-- =============================================================================
