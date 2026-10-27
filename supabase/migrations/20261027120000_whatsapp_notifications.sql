-- WhatsApp messages through a self-hosted Evolution API server
-- (supabase/functions/_shared/whatsapp.ts, docs/whatsapp-setup.md):
--   - "go to Court N" from notify-court-allocated, next to email and push
--   - one "get ready for tomorrow" message per number the evening before,
--     from the whatsapp-reminders function, run by pg_cron
-- Off by default: an admin ticks "WhatsApp messages" on the tournament,
-- and nothing is sent until the EVOLUTION_* function secrets exist.

-- 1. Per-tournament switch. Readable like the other tournament settings.
alter table public.tournaments
  add column whatsapp_enabled boolean not null default false;
grant select (whatsapp_enabled) on public.tournaments to anon, authenticated;

-- 2. Court messages are logged next to email and push.
alter table public.notification_log drop constraint notification_log_channel_check;
alter table public.notification_log add constraint notification_log_channel_check
  check (channel = any (array['email'::text, 'push'::text, 'whatsapp'::text]));

-- 3. Day-before messages: one row per number, so nobody gets it twice.
create table public.whatsapp_reminders (
  id bigint generated always as identity primary key,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  kind text not null check (kind = 'day_before'),
  phone text not null,
  player_ids uuid[] not null default '{}',
  status text not null check (status = any (array['sending', 'sent', 'failed'])),
  attempts integer not null default 1,
  error_message text,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (tournament_id, kind, phone)
);
alter table public.whatsapp_reminders enable row level security;
create policy "admin read whatsapp reminders" on public.whatsapp_reminders
  as permissive for select to authenticated using ((select is_admin()));

-- Written only by the Edge Function (service role); admins read it.
revoke all on public.whatsapp_reminders from anon, authenticated;
grant select on public.whatsapp_reminders to authenticated;
grant all on public.whatsapp_reminders to service_role;

-- Claims a number before sending. True for a new number, or for a retry of
-- a failed send (up to 3 tries) or of a send that never reported back
-- (a call that died mid-send). False when it's sent or another call has it.
create function public.claim_whatsapp_reminder(
  p_tournament_id uuid, p_kind text, p_phone text, p_player_ids uuid[]
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  insert into public.whatsapp_reminders as r (tournament_id, kind, phone, player_ids, status)
  values (p_tournament_id, p_kind, p_phone, p_player_ids, 'sending')
  on conflict (tournament_id, kind, phone) do update
    set status = 'sending', attempts = r.attempts + 1, claimed_at = now(),
        player_ids = excluded.player_ids
    where r.attempts < 3
      and (r.status = 'failed' or (r.status = 'sending' and r.claimed_at < now() - interval '10 minutes'))
  returning true;
$$;

revoke all on function public.claim_whatsapp_reminder(uuid, text, text, uuid[]) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_reminder(uuid, text, text, uuid[]) to service_role;

-- 4. Shared secret for database -> whatsapp-reminders, generated here so it
-- never appears in the repository. Copy it into the function's
-- WHATSAPP_REMINDER_SECRET (docs/whatsapp-setup.md).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'whatsapp_reminder_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'whatsapp_reminder_secret',
      'Shared secret: database -> whatsapp-reminders Edge Function');
  end if;
end $$;

-- 5. Calls the function between 6 and 9 pm Pacific on the day before a
-- tournament with WhatsApp on. Any other time it does nothing, so the
-- function isn't woken every 5 minutes for no reason.
create or replace function public.queue_whatsapp_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_now timestamp := now() at time zone 'America/Vancouver';
  secret text;
begin
  if extract(hour from local_now) not between 18 and 20 then
    return;
  end if;
  if not exists (
    select 1 from public.tournaments
    where whatsapp_enabled and event_date = local_now::date + 1
  ) then
    return;
  end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'whatsapp_reminder_secret';
  if secret is null then
    return;
  end if;
  perform net.http_post(
    url := 'https://wdqooznwzesmjdvlcrxw.supabase.co/functions/v1/whatsapp-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 140000
  );
end;
$$;

revoke all on function public.queue_whatsapp_reminders() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('whatsapp-day-before', '*/5 * * * *', 'select public.queue_whatsapp_reminders()');
