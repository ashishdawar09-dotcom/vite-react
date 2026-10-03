-- =============================================================================
-- schema_v15_share_surfaces_and_bronze.sql
--
-- Adds the schema bits behind the share-surfaces + tournament-day-polish push:
--
--   1. tournaments.slug TEXT UNIQUE
--      → public spectator URL /t/:slug. Backfilled from name on existing rows;
--        auto-generated for new rows via a BEFORE INSERT trigger.
--
--   2. categories.has_bronze_match BOOLEAN
--      → admin toggle in CategoryEditor; when on, knockout generation adds an
--        extra match for the SF losers (3rd-place playoff).
--
--   3. matches.is_bronze BOOLEAN
--      → flags the bronze match row so the UI can label it "3rd Place" and the
--        winner-propagation logic knows where to route SF losers.
--
-- All steps are idempotent — safe to re-run. RLS is unaffected: the audited
-- `read tournaments` / `read categories` / `read matches` SELECT policies from
-- schema_v14 already cover these new columns (FOR SELECT USING (true)).
--
-- Run in Supabase Dashboard → SQL Editor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Column adds (idempotent)
-- ---------------------------------------------------------------------------
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS slug TEXT;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS has_bronze_match BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS is_bronze BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- 2. Slug helper — lowercase, dashes, length-capped, never empty.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.slugify(input TEXT) RETURNS TEXT AS $$
DECLARE
  s TEXT;
BEGIN
  s := lower(coalesce(input, ''));
  s := regexp_replace(s, '[^a-z0-9]+', '-', 'g');
  s := regexp_replace(s, '^-+|-+$', '', 'g');
  IF length(s) > 40 THEN
    s := substring(s FROM 1 FOR 40);
    s := regexp_replace(s, '-+$', '', 'g');
  END IF;
  IF s = '' THEN
    s := 'tournament';
  END IF;
  RETURN s;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ---------------------------------------------------------------------------
-- 3. Backfill slugs for existing tournaments. Skip rows that already have one.
--    Uses a uniqueness suffix when two tournaments share a name.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  base TEXT;
  candidate TEXT;
  suffix INT;
BEGIN
  FOR r IN
    SELECT id, name FROM public.tournaments
     WHERE slug IS NULL OR slug = ''
     ORDER BY created_at
  LOOP
    base := public.slugify(r.name);
    candidate := base;
    suffix := 1;
    WHILE EXISTS (
      SELECT 1 FROM public.tournaments
       WHERE slug = candidate AND id <> r.id
    ) LOOP
      suffix := suffix + 1;
      candidate := base || '-' || suffix::text;
    END LOOP;
    UPDATE public.tournaments SET slug = candidate WHERE id = r.id;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Lock down the slug column AFTER backfill, so no existing-row violation.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tournaments_slug_key'
       AND conrelid = 'public.tournaments'::regclass
  ) THEN
    ALTER TABLE public.tournaments
      ADD CONSTRAINT tournaments_slug_key UNIQUE (slug);
  END IF;
END $$;

-- Index for lookup-by-slug (UNIQUE constraint already creates one but we
-- add a partial NOT-NULL index defensively; harmless if duplicate).
CREATE INDEX IF NOT EXISTS tournaments_slug_idx
  ON public.tournaments (slug) WHERE slug IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. BEFORE INSERT trigger to auto-generate a slug for new tournaments
--    when the client doesn't provide one (current client behavior).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tournaments_autoslug() RETURNS TRIGGER AS $$
DECLARE
  base TEXT;
  candidate TEXT;
  suffix INT;
BEGIN
  IF NEW.slug IS NOT NULL AND NEW.slug <> '' THEN
    RETURN NEW;
  END IF;
  base := public.slugify(NEW.name);
  candidate := base;
  suffix := 1;
  WHILE EXISTS (
    SELECT 1 FROM public.tournaments
     WHERE slug = candidate
       AND (NEW.id IS NULL OR id <> NEW.id)
  ) LOOP
    suffix := suffix + 1;
    candidate := base || '-' || suffix::text;
  END LOOP;
  NEW.slug := candidate;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tournaments_autoslug ON public.tournaments;
CREATE TRIGGER tournaments_autoslug
  BEFORE INSERT ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.tournaments_autoslug();

-- ---------------------------------------------------------------------------
-- 6. Verification block — operator can eyeball the Results pane.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  missing_slug INT;
  total INT;
BEGIN
  SELECT count(*) INTO missing_slug
    FROM public.tournaments WHERE slug IS NULL OR slug = '';
  SELECT count(*) INTO total FROM public.tournaments;
  RAISE NOTICE '====== v15 SCHEMA VERIFICATION ======';
  RAISE NOTICE 'tournaments total: %, with empty/null slug: %', total, missing_slug;
  IF missing_slug > 0 THEN
    RAISE WARNING 'Some tournaments still have an empty slug — investigate.';
  END IF;
END $$;

-- Show the new column values for visual inspection.
SELECT id, name, slug, created_at
  FROM public.tournaments
 ORDER BY created_at DESC;

-- Tell PostgREST the schema cache is stale; otherwise the new columns appear
-- as "Could not find column 'slug' of 'tournaments' in the schema cache".
NOTIFY pgrst, 'reload schema';
