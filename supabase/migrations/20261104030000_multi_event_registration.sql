-- One registration form can now enter several events at once.
--
-- Each event is still its own pending_registrations row, so approval, teams,
-- payments and emails work per event exactly as before. Rows created by one
-- submission share a submission_id, and one payment covers them all: the same
-- e-Transfer reference on every row, or one Stripe Checkout session. The
-- session id is stored on the first row only (stripe_checkout_session_id is
-- unique); stripe-webhook finds the rest by submission_id. Single-event
-- entries leave submission_id null and behave as before.
alter table public.pending_registrations
  add column if not exists submission_id uuid;

create index if not exists pending_registrations_submission
  on public.pending_registrations (submission_id)
  where submission_id is not null;

-- How far each person got in the step-by-step form (you, events, partners,
-- waiver, pay), what they had picked, and when they finished. Written only by
-- the save-registration-lead and register-player Edge Functions; admins read.
alter table public.registration_leads
  add column if not exists last_step text,
  add column if not exists selections jsonb,
  add column if not exists completed_at timestamptz;
