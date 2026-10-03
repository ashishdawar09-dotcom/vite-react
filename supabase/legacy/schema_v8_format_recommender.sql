-- schema_v8_format_recommender.sql
-- Adds tournament-format-recommender support to categories.
--
-- Two new optional columns on categories:
--   groups_count   = number of groups for the category. 0 = auto-derive at
--                    stage-start time using src/lib/formatPlanner.defaultFormat(N).
--   top_n_advance  = top-N teams from each group that advance to knockout.
--                    0 = auto-derive (same fallback path).
--
-- Both columns default to 0 so existing categories continue to work without
-- migration; the new client-side recommender fills in sensible values when
-- the admin saves the category through the new UI.
--
-- Apply via Supabase SQL editor.

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS groups_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS top_n_advance INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.categories.groups_count IS
  'Number of groups for this category. 0 = auto-derive from team count via formatPlanner.';
COMMENT ON COLUMN public.categories.top_n_advance IS
  'Top-N teams from each group that advance to knockout. 0 = auto-derive.';
