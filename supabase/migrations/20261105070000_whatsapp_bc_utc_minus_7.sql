-- WhatsApp timing in BC's permanent UTC-7.
--
-- BC stopped changing clocks on Nov 1, 2026: Vancouver stays at -07:00 all
-- year. The database server's time-zone rules are older than that change, so
-- `now() at time zone 'America/Vancouver'` is an hour behind real BC time
-- (checked Nov 4: it turns 16:30 UTC on Nov 21 into 08:30, not 09:30). That
-- put the day-before reminders at 7-10 pm instead of 6-9 pm, and would cancel
-- unsent ones an hour late.
--
-- Both functions now use a fixed -07:00, which is BC time from Nov 1, 2026 on
-- whatever the server's rules say. Nothing else changes.
-- Rollback: the two bodies from 20261029120000_whatsapp_notifications.sql.

create or replace function public.next_whatsapp_message(p_holder uuid)
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
      and t.event_date <= (now() at time zone interval '-07:00')::date;
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

create or replace function public.queue_whatsapp_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_now timestamp := now() at time zone interval '-07:00';
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
