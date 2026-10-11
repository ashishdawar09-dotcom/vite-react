-- Registration emails: "received" on submit (after payment for card) and
-- "you're in" when an admin approves. Columns record what was sent so
-- retries (Stripe webhooks, double-clicks) never send twice, and admins can
-- see failures.

alter table public.tournaments
  -- Where player replies go (emails are sent from no-reply@adawar.org).
  add column if not exists reply_to_email text;

alter table public.pending_registrations
  add column if not exists confirmation_email_status text,   -- 'sent' | 'failed: …'
  add column if not exists confirmation_emailed_at timestamptz,
  add column if not exists approval_email_status text,       -- 'sent' | 'failed: …'
  add column if not exists approval_emailed_at timestamptz;
