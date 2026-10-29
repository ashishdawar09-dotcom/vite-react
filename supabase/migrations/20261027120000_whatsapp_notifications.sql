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

-- 3. Opt-ins. One row per registration; the code a player sends is the first
-- 8 characters of their registration id. jid is the sender's WhatsApp ID as
-- Evolution reports it (usually <number>@s.whatsapp.net), and is where
-- updates go.
create table public.whatsapp_optins (
  id bigint generated always as identity primary key,
  registration_id uuid not null references public.pending_registrations(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  role text not null default 'player' check (role = any (array['player', 'partner'])),
  jid text not null,
  push_name text,
  opted_in_at timestamptz not null default now(),
  opted_out_at timestamptz,
  unique (registration_id, role)
);
create index whatsapp_optins_jid on public.whatsapp_optins (jid);

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
  leased_until timestamptz not null default '-infinity'
);
insert into public.whatsapp_sender_lease default values;
alter table public.whatsapp_sender_lease enable row level security;
revoke all on public.whatsapp_sender_lease from anon, authenticated;

-- Takes the lease for p_seconds if nobody holds it. A row still marked
-- 'sending' at that point belongs to a sender that died mid-send; it goes
-- back in the queue (it may go out twice, which beats never).
create function public.take_whatsapp_lease(p_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.whatsapp_sender_lease
    set leased_until = now() + make_interval(secs => p_seconds)
    where leased_until < now();
  if not found then
    return false;
  end if;
  update public.whatsapp_outbox set status = 'queued' where status = 'sending';
  return true;
end;
$$;

create function public.release_whatsapp_lease()
returns void
language sql
security definer
set search_path = ''
as $$
  -- "where id": API calls refuse an UPDATE without a WHERE clause.
  update public.whatsapp_sender_lease set leased_until = '-infinity' where id;
$$;

-- Next message to send, marked 'sending'. Court calls that waited more than
-- 20 minutes are dropped first: "you're up now" would be wrong by then.
create function public.next_whatsapp_message()
returns setof public.whatsapp_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.whatsapp_outbox
    set status = 'cancelled', error_message = 'too late to send'
    where status = 'queued' and kind = 'court_call' and created_at < now() - interval '20 minutes';
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

revoke all on function public.take_whatsapp_lease(integer), public.release_whatsapp_lease(),
  public.next_whatsapp_message() from public, anon, authenticated;
grant execute on function public.take_whatsapp_lease(integer), public.release_whatsapp_lease(),
  public.next_whatsapp_message() to service_role;

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
