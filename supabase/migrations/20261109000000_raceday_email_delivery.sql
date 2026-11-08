-- Race-day email delivery (Resend).
--
-- 1. notification_log keeps Resend's email id for each court-call email, and
--    the resend-webhook function records what happened to it (delivered,
--    bounced, …), so the admin can see "the email didn't reach Priya" and
--    tell her in person.
-- 2. briefing_emails: the day-before and morning-of player briefings, one row
--    per player per kind (claimed before sending, so a retried batch never
--    emails twice).
-- 3. record_email_delivery(): the webhook's single write. A later, weaker
--    event never overwrites a stronger one (a delay after delivery, say).

alter table public.notification_log
  add column if not exists provider_message_id text,
  add column if not exists delivery_status text,
  add column if not exists delivery_detail text,
  add column if not exists delivery_at timestamptz;

create index if not exists notification_log_provider_message_id
  on public.notification_log (provider_message_id) where provider_message_id is not null;

create table if not exists public.briefing_emails (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  kind text not null check (kind in ('day_before', 'morning_of')),
  email text not null,
  status text not null check (status in ('sending', 'sent', 'scheduled', 'failed', 'cancelled')),
  error_message text,
  provider_message_id text,
  scheduled_at timestamptz,
  sent_at timestamptz,
  delivery_status text,
  delivery_detail text,
  delivery_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, player_id, kind)
);

create index if not exists briefing_emails_provider_message_id
  on public.briefing_emails (provider_message_id) where provider_message_id is not null;

alter table public.briefing_emails enable row level security;
drop policy if exists "admin read briefing emails" on public.briefing_emails;
create policy "admin read briefing emails" on public.briefing_emails
  as permissive for select to authenticated using ((select is_admin()));

-- Written only by the player-briefing and resend-webhook functions; admins read it.
revoke all on public.briefing_emails from anon, authenticated;
grant select on public.briefing_emails to authenticated;
grant all on public.briefing_emails to service_role;

create or replace function public.email_delivery_rank(p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'delivery_delayed' then 1
    when 'delivered' then 2
    when 'bounced' then 3
    when 'complained' then 3
    when 'failed' then 3
    when 'suppressed' then 3
    else 0
  end
$$;

create or replace function public.record_email_delivery(
  p_email_id text,
  p_status text,
  p_detail text,
  p_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer := 0;
  m integer := 0;
begin
  if p_email_id is null or public.email_delivery_rank(p_status) = 0 then
    return 0;
  end if;

  update public.notification_log
     set delivery_status = p_status,
         delivery_detail = left(p_detail, 300),
         delivery_at = coalesce(p_at, now())
   where provider_message_id = p_email_id
     and public.email_delivery_rank(delivery_status) <= public.email_delivery_rank(p_status);
  get diagnostics n = row_count;

  update public.briefing_emails
     set delivery_status = p_status,
         delivery_detail = left(p_detail, 300),
         delivery_at = coalesce(p_at, now()),
         updated_at = now()
   where provider_message_id = p_email_id
     and public.email_delivery_rank(delivery_status) <= public.email_delivery_rank(p_status);
  get diagnostics m = row_count;

  return n + m;
end
$$;

revoke all on function public.record_email_delivery(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_email_delivery(text, text, text, timestamptz) to service_role;
revoke all on function public.email_delivery_rank(text) from public, anon;
grant execute on function public.email_delivery_rank(text) to authenticated, service_role;

-- Claims one player's briefing before it's sent: true when there was no row,
-- or the last try failed / was cancelled / stalled mid-send (5 minutes).
-- A sent or scheduled briefing is never claimed again.
create or replace function public.claim_briefing(
  p_tournament_id uuid,
  p_player_id uuid,
  p_kind text,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.briefing_emails (tournament_id, player_id, kind, email, status)
  values (p_tournament_id, p_player_id, p_kind, p_email, 'sending')
  on conflict (tournament_id, player_id, kind) do update
     set status = 'sending',
         email = excluded.email,
         error_message = null,
         provider_message_id = null,
         scheduled_at = null,
         sent_at = null,
         delivery_status = null,
         delivery_detail = null,
         delivery_at = null,
         updated_at = now()
   where public.briefing_emails.status in ('failed', 'cancelled')
      or (public.briefing_emails.status = 'sending' and public.briefing_emails.updated_at < now() - interval '5 minutes')
  returning id into v_id;
  return v_id;
end
$$;

revoke all on function public.claim_briefing(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_briefing(uuid, uuid, text, text) to service_role;
