-- Outcome of the partner waiver email, so admins know whether to share the
-- link by hand: null = not sent yet, 'sent', or 'failed: <reason>'.
alter table public.pending_registrations
  add column if not exists partner_waiver_email_status text,
  add column if not exists partner_waiver_emailed_at timestamptz;
