-- schema_v11_player_email_and_notification_log.sql
-- Adds an optional contact email to players and a log of every notification
-- attempt, so the court-allocation email flow has somewhere to record sent/
-- skipped/failed outcomes.
--
-- Flow after this lands:
--   1. Admin clicks "Start Match" -> allocateCourtForMatch runs
--   2. Client fires `notify-court-allocated` edge function
--   3. Function looks up each player's `email`, sends via Resend, writes a
--      notification_log row per recipient with status sent/skipped/failed
--
-- The `email` column is nullable -- players without an email are simply
-- skipped (status='skipped'), they're not blocked from playing.
--
-- No unique constraint on (match_id, channel): admins can legitimately
-- cancel and re-allocate, and each attempt should be visible in the log.
--
-- Apply via Supabase SQL editor before deploying the matching code.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS email TEXT DEFAULT NULL;

COMMENT ON COLUMN public.players.email IS
  'Optional contact email. Editable on the player profile page by admins. Used by the notify-court-allocated edge function.';

CREATE TABLE IF NOT EXISTS public.notification_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  player_id     UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL CHECK (channel IN ('email')),
  status        TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error_message TEXT,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_log_match
  ON public.notification_log(match_id);

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

-- Public read so admin UI can show "sent" / "failed" chips on match cards.
-- Writes happen only from the edge function via the service-role key, which
-- bypasses RLS, so no INSERT/UPDATE policy is needed.
DROP POLICY IF EXISTS notification_log_public_read ON public.notification_log;
CREATE POLICY notification_log_public_read
  ON public.notification_log FOR SELECT USING (true);

-- PostgREST caches the schema; tell it to reload so the new column/table are
-- usable immediately without a wait.
NOTIFY pgrst, 'reload schema';
