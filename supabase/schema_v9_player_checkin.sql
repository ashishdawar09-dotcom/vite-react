-- schema_v9_player_checkin.sql
-- Adds tournament-day check-in tracking to players.
--
-- New column:
--   checked_in_at TIMESTAMPTZ NULL — null = not checked in for today;
--   timestamp = when the admin marked them present.
--
-- Existing players default to NULL so no migration of state is needed.
-- Reset between tournament days by calling db.resetCheckins(tournament_id)
-- which nulls the column for that tournament.
--
-- Apply via the Supabase SQL editor.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.players.checked_in_at IS
  'Tournament-day check-in timestamp. NULL = not checked in.';
