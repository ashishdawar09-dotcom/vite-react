-- schema_v10_court_allocation.sql
-- Adds a court-allocation phase between "pending" and "live" so admins can
-- allocate a court (players walk over, warm up) before clicking Begin Scoring
-- to start the actual play clock.
--
-- State machine after this column lands:
--   status   court_number  court_allocated_at  started_at   meaning
--   pending  null          null                null         queued, no court
--   pending  set           set                 null         WARMING UP on court
--   live     set           set                 set          scoring in progress
--   completed set          set                 set          done
--
-- court_allocated_at is cleared on Cancel Allocation or Reschedule. The
-- status field stays "pending" through warm-up, so every existing filter
-- like `status === "pending"` keeps working without changes.
--
-- Apply via Supabase SQL editor before deploying the matching code.

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS court_allocated_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.matches.court_allocated_at IS
  'Set when admin allocates a court (warm-up phase). NULL if no court allocated yet. Cleared on Cancel Allocation or Reschedule.';

-- PostgREST caches the schema; tell it to reload so the new column is usable
-- immediately without a wait.
NOTIFY pgrst, 'reload schema';
