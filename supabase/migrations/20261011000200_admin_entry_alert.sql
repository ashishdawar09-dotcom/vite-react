-- Tournament directors get an email for every new entry (on submit for
-- e-Transfer, once paid for card), sent with the player's confirmation.

alter table public.tournaments
  add column if not exists admin_notify_emails text[];

alter table public.pending_registrations
  add column if not exists admin_email_status text,      -- 'sent' | 'failed: …'
  add column if not exists admin_emailed_at timestamptz;
