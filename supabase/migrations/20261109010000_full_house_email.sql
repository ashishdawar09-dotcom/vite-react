-- The "full house" thank-you email (sent from the admin Emails tab once every
-- entry is taken) goes through the same per-player claim as the briefings, so
-- a retried batch or a second admin never emails anyone twice. It only needs
-- a third kind on briefing_emails.

alter table public.briefing_emails drop constraint if exists briefing_emails_kind_check;
alter table public.briefing_emails
  add constraint briefing_emails_kind_check check (kind in ('day_before', 'morning_of', 'full_house'));
