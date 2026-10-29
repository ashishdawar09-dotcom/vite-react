-- WhatsApp updates for players who ask for them, through a self-hosted
-- Evolution API server (docs/whatsapp-setup.md).
--
-- Opt-in only. After registering, a player taps "Get updates on WhatsApp",
-- which opens WhatsApp with "... My code: 1A2B3C4D" ready to send to the
-- club's number. Evolution forwards that message to whatsapp-inbound, which
-- records the opt-in here and replies once. STOP turns it off, START back on.
-- Nobody who hasn't messaged us first is ever messaged.
--
-- Every outgoing message goes through one queue (whatsapp_outbox) drained
-- by one sender at a time (whatsapp-send), with gaps between messages, so
-- many courts starting at once never turns into a burst.

-- 1. Per-tournament settings, readable like the other tournament settings:
-- the switch, and the club number the opt-in button opens.
alter table public.tournaments
  add column whatsapp_enabled boolean not null default false,
  add column whatsapp_number text
    check (whatsapp_number is null or whatsapp_number ~ '^[1-9][0-9]{7,14}$');
grant select (whatsapp_enabled, whatsapp_number) on public.tournaments to anon, authenticated;

-- 2. Court messages are logged next to email and push.
alter table public.notification_log drop constraint notification_log_channel_check;
alter table public.notification_log add constraint notification_log_channel_check
  check (channel = any (array['email'::text, 'push'::text, 'whatsapp'::text]));

-- 3. Opt-ins. The code a player sends is the first 8 characters of their
-- registration id. One row per chat that sent it (a player and a parent can
-- both opt in; whatsapp-inbound allows up to 3). jid is where updates go:
-- the phone-number ID (<number>@s.whatsapp.net) when Evolution knows it.
-- WhatsApp also has private "@lid" IDs for the same chat; the other form,
-- when sent, is kept in jid_alt so STOP matches whichever one arrives.
create table public.whatsapp_optins (
  id bigint generated always as identity primary key,
  registration_id uuid not null references public.pending_registrations(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  role text not null default 'player' check (role = any (array['player', 'partner'])),
  jid text not null,
  jid_alt text,
  push_name text,
  opted_in_at timestamptz not null default now(),
  opted_out_at timestamptz,
  unique (registration_id, role, jid)
);
create index whatsapp_optins_jid on public.whatsapp_optins (jid);
create index whatsapp_optins_jid_alt on public.whatsapp_optins (jid_alt) where jid_alt is not null;

-- The registration a code belongs to. Null when no live entry matches, or
-- (vanishingly unlikely) more than one does.
create function public.registration_for_whatsapp_code(p_code text)
returns table (id uuid, tournament_id uuid, player_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.tournament_id, r.player_name
  from public.pending_registrations r
  where p_code ~* '^[0-9a-f]{8}$'
    and split_part(r.id::text, '-', 1) = lower(p_code)
    and r.status not in ('rejected', 'payment_expired')
    and (select count(*) from public.pending_registrations r2
         where split_part(r2.id::text, '-', 1) = lower(p_code)
           and r2.status not in ('rejected', 'payment_expired')) = 1;
$$;

revoke all on function public.registration_for_whatsapp_code(text) from public, anon, authenticated;
grant execute on function public.registration_for_whatsapp_code(text) to service_role;

-- 4. Outgoing messages.
create table public.whatsapp_outbox (
  id bigint generated always as identity primary key,
  jid text not null,
  body text not null,
  kind text not null check (kind = any (array['reply', 'court_call', 'day_before'])),
  priority smallint not null default 1,          -- 0 goes first
  tournament_id uuid references public.tournaments(id) on delete cascade,
  match_id uuid references public.matches(id) on delete cascade,
  player_ids uuid[] not null default '{}',
  dedupe_key text unique,                         -- e.g. one day-before message per number
  status text not null default 'queued'
    check (status = any (array['queued', 'sending', 'sent', 'failed', 'cancelled'])),
  attempts integer not null default 0,
  not_before timestamptz not null default now(),
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index whatsapp_outbox_due on public.whatsapp_outbox (priority, id) where status = 'queued';

alter table public.whatsapp_optins enable row level security;
alter table public.whatsapp_outbox enable row level security;
create policy "admin read whatsapp optins" on public.whatsapp_optins
  as permissive for select to authenticated using ((select is_admin()));
create policy "admin read whatsapp outbox" on public.whatsapp_outbox
  as permissive for select to authenticated using ((select is_admin()));

-- Written only by Edge Functions (service role); admins read them.
revoke all on public.whatsapp_optins, public.whatsapp_outbox from anon, authenticated;
grant select on public.whatsapp_optins, public.whatsapp_outbox to authenticated;
grant all on public.whatsapp_optins, public.whatsapp_outbox to service_role;

-- 5. One sender at a time: whoever holds the lease drains the queue.
create table public.whatsapp_sender_lease (
  id boolean primary key default true check (id),
  holder uuid,
  leased_until timestamptz not null default '-infinity'
);
insert into public.whatsapp_sender_lease default values;
alter table public.whatsapp_sender_lease enable row level security;
revoke all on public.whatsapp_sender_lease from anon, authenticated;

-- Takes the lease for p_seconds if nobody holds it, and returns a token
-- that the holder passes back (null when someone else holds it). A row
-- still marked 'sending' at that point belongs to a sender whose lease ran
-- out mid-send; it goes back in the queue (it may go out twice, which
-- beats never).
create function public.take_whatsapp_lease(p_seconds integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  token uuid := gen_random_uuid();
begin
  update public.whatsapp_sender_lease
    set holder = token, leased_until = now() + make_interval(secs => p_seconds)
    where id and leased_until < now();
  if not found then
    return null;
  end if;
  update public.whatsapp_outbox set status = 'queued' where status = 'sending';
  return token;
end;
$$;

-- Only the current holder can release it.
create function public.release_whatsapp_lease(p_holder uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.whatsapp_sender_lease set holder = null, leased_until = '-infinity'
    where id and holder = p_holder;
$$;

-- Next message to send, marked 'sending'; nothing if p_holder no longer
-- holds the lease (a sender that overran stops instead of overlapping the
-- next one). Messages that would be wrong or unwanted by now are dropped
-- first:
--   - court calls older than 20 minutes ("you're up now" no longer true)
--   - day-before messages once the tournament day has started (Pacific)
--   - replies older than a day
--   - anything for a tournament whose WhatsApp switch is now off
create function public.next_whatsapp_message(p_holder uuid)
returns setof public.whatsapp_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.whatsapp_sender_lease
    where holder = p_holder and leased_until > now()
  ) then
    return;
  end if;
  update public.whatsapp_outbox
    set status = 'cancelled', error_message = 'too late to send'
    where status = 'queued' and kind = 'court_call' and created_at < now() - interval '20 minutes';
  update public.whatsapp_outbox o
    set status = 'cancelled', error_message = 'too late to send'
    from public.tournaments t
    where o.status = 'queued' and o.kind = 'day_before' and t.id = o.tournament_id
      and t.event_date <= (now() at time zone 'America/Vancouver')::date;
  update public.whatsapp_outbox
    set status = 'cancelled', error_message = 'too late to send'
    where status = 'queued' and kind = 'reply' and created_at < now() - interval '1 day';
  update public.whatsapp_outbox o
    set status = 'cancelled', error_message = 'WhatsApp switched off for the tournament'
    from public.tournaments t
    where o.status = 'queued' and t.id = o.tournament_id and not t.whatsapp_enabled;
  return query
    update public.whatsapp_outbox o
      set status = 'sending', attempts = o.attempts + 1
      where o.id = (
        select id from public.whatsapp_outbox
        where status = 'queued' and not_before <= now()
        order by priority, id
        limit 1
        for update skip locked
      )
      returning o.*;
end;
$$;

revoke all on function public.take_whatsapp_lease(integer), public.release_whatsapp_lease(uuid),
  public.next_whatsapp_message(uuid) from public, anon, authenticated;
grant execute on function public.take_whatsapp_lease(integer), public.release_whatsapp_lease(uuid),
  public.next_whatsapp_message(uuid) to service_role;

-- 6. Shared secret for database/functions -> whatsapp-send and
-- whatsapp-reminders, generated here so it never appears in the repository.
-- Copy it into the WHATSAPP_INTERNAL_SECRET function secret.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'whatsapp_internal_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'whatsapp_internal_secret',
      'Shared secret: database -> whatsapp-send / whatsapp-reminders Edge Functions');
  end if;
end $$;

create function public.call_whatsapp_function(p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'whatsapp_internal_secret';
  if secret is null then
    return;
  end if;
  perform net.http_post(
    url := 'https://wdqooznwzesmjdvlcrxw.supabase.co/functions/v1/' || p_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
end;
$$;

-- Every minute: wake the sender if something is due and nobody is sending.
-- The functions also wake it straight away when they queue a message; this
-- is the backstop.
create function public.kick_whatsapp_sender()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.whatsapp_sender_lease where leased_until > now()) then
    return;
  end if;
  if not exists (select 1 from public.whatsapp_outbox where status in ('queued', 'sending') and not_before <= now()) then
    return;
  end if;
  perform public.call_whatsapp_function('whatsapp-send');
end;
$$;

-- Every 5 minutes, 6 to 9 pm Pacific on the day before a tournament with
-- WhatsApp on: queue the day-before message for anyone opted in who hasn't
-- had it (so late opt-ins that evening still get it).
create function public.queue_whatsapp_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_now timestamp := now() at time zone 'America/Vancouver';
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
  perform public.call_whatsapp_function('whatsapp-reminders');
end;
$$;

revoke all on function public.call_whatsapp_function(text), public.kick_whatsapp_sender(),
  public.queue_whatsapp_reminders() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('whatsapp-send', '* * * * *', 'select public.kick_whatsapp_sender()');
select cron.schedule('whatsapp-day-before', '*/5 * * * *', 'select public.queue_whatsapp_reminders()');
