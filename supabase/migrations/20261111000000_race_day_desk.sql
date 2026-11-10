-- Race-day desk (Nov 2026): "you're up soon" alerts and the desk monitor.
--
-- 1. race_day_settings: one row per tournament. Admins read it and change it
--    through set_race_day_settings(): the "you're up soon" alerts (on unless
--    turned off), the desk monitor (off until turned on) and where its emails
--    go. The monitor's day plan and its own state are written by the
--    race-monitor function (service role) and by hand.
-- 2. on_deck_alerts: one row per match whose players got "you're up soon",
--    claimed before anything is sent, so a second admin device or a retry
--    never sends it twice. Written by notify-on-deck only; admins read it.
-- 3. The desk monitor: pg_cron runs kick_race_monitor() every 10 minutes. It
--    calls the race-monitor Edge Function only on a tournament's day, 8:30 am
--    to 9 pm at the venue (UTC-7 all year since Nov 2026), and only for
--    tournaments with the monitor on. The function checks the
--    x-internal-secret header against its RACE_MONITOR_SECRET, a copy of the
--    vault secret generated here (so it never appears in the repository).

create table if not exists public.race_day_settings (
  tournament_id uuid primary key references public.tournaments(id) on delete cascade,
  on_deck_alerts boolean not null default true,
  monitor_on boolean not null default false,
  monitor_email_to text,
  monitor_plan jsonb,
  monitor_state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.race_day_settings enable row level security;
drop policy if exists "admin read race day settings" on public.race_day_settings;
create policy "admin read race day settings" on public.race_day_settings
  as permissive for select to authenticated using ((select is_admin()));

revoke all on public.race_day_settings from anon, authenticated;
grant select on public.race_day_settings to authenticated;
grant all on public.race_day_settings to service_role;

create table if not exists public.on_deck_alerts (
  match_id uuid primary key references public.matches(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  expected_at timestamptz,
  claimed_at timestamptz not null default now(),
  emailed integer not null default 0,
  email_failed integer not null default 0,
  no_email integer not null default 0,
  pushed integer not null default 0,
  push_failed integer not null default 0
);

create index if not exists on_deck_alerts_tournament on public.on_deck_alerts (tournament_id);

alter table public.on_deck_alerts enable row level security;
drop policy if exists "admin read on deck alerts" on public.on_deck_alerts;
create policy "admin read on deck alerts" on public.on_deck_alerts
  as permissive for select to authenticated using ((select is_admin()));

revoke all on public.on_deck_alerts from anon, authenticated;
grant select on public.on_deck_alerts to authenticated;
grant all on public.on_deck_alerts to service_role;

-- The Emails tab's switches. A null argument leaves that setting as it is.
-- Monitor addresses: up to 3, comma separated; '' clears them.
create or replace function public.set_race_day_settings(
  p_tournament_id uuid,
  p_on_deck_alerts boolean default null,
  p_monitor_on boolean default null,
  p_monitor_email_to text default null
)
returns public.race_day_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.race_day_settings;
  emails text := nullif(btrim(p_monitor_email_to), '');
begin
  if not (select public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if emails is not null then
    emails := regexp_replace(lower(emails), '\s+', '', 'g');
    if emails !~ '^[^@,;]+@[^@,;]+\.[a-z]{2,}(,[^@,;]+@[^@,;]+\.[a-z]{2,}){0,2}$' then
      raise exception 'monitor_email_to: up to 3 email addresses, comma separated' using errcode = '22023';
    end if;
  end if;
  insert into public.race_day_settings as s (tournament_id, on_deck_alerts, monitor_on, monitor_email_to)
  values (p_tournament_id, coalesce(p_on_deck_alerts, true), coalesce(p_monitor_on, false), emails)
  on conflict (tournament_id) do update
    set on_deck_alerts = coalesce(p_on_deck_alerts, s.on_deck_alerts),
        monitor_on = coalesce(p_monitor_on, s.monitor_on),
        monitor_email_to = case when p_monitor_email_to is null then s.monitor_email_to else emails end,
        updated_at = now()
  returning * into r;
  return r;
end;
$$;

revoke all on function public.set_race_day_settings(uuid, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.set_race_day_settings(uuid, boolean, boolean, text) to authenticated, service_role;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'race_monitor_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'race_monitor_secret',
      'Shared secret: database -> race-monitor Edge Function');
  end if;
end $$;

create or replace function public.kick_race_monitor()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_now timestamp := now() at time zone interval '-07:00';
  secret text;
begin
  if local_now::time < time '08:30' or local_now::time > time '21:00' then
    return;
  end if;
  if not exists (
    select 1
      from public.race_day_settings s
      join public.tournaments t on t.id = s.tournament_id
     where s.monitor_on
       and nullif(btrim(s.monitor_email_to), '') is not null
       and t.event_date = local_now::date
  ) then
    return;
  end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'race_monitor_secret';
  if secret is null then
    return;
  end if;
  perform net.http_post(
    url := 'https://wdqooznwzesmjdvlcrxw.supabase.co/functions/v1/race-monitor',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end;
$$;

revoke all on function public.kick_race_monitor() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('race-monitor', '*/10 * * * *', 'select public.kick_race_monitor()');
