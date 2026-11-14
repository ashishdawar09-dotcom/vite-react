-- A director can close a full tournament's waitlist: no new names, and the
-- "we're full" page says sorry, fully booked, with no waitlist form.
--
-- tournaments.waitlist_closed: false (the default) keeps the waitlist open,
-- as before. Not granted to anon: the public page reads it through
-- registration_capacity, which now also answers waitlist_open.
--
-- registration_capacity: same count as before, plus waitlist_open. Pages
-- built before this change ignore the extra key.
--
-- The join-waitlist Edge Function refuses new names while it's closed.
--
-- This migration only adds the switch. Closing one tournament's waitlist is
--   update public.tournaments set waitlist_closed = true where id = '<id>';
-- and reopening it sets it back to false.
--
-- Rollback: set waitlist_closed to false everywhere, restore
-- registration_capacity from 20261107080000_entry_cap_and_waitlist.sql, then
-- drop the column.

alter table public.tournaments
  add column if not exists waitlist_closed boolean not null default false;

create or replace function public.registration_capacity(p_tournament_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cap integer;
  v_closed boolean;
  v_taken integer;
begin
  select entry_cap, waitlist_closed into v_cap, v_closed from public.tournaments where id = p_tournament_id;
  if v_cap is null then
    return jsonb_build_object('cap', null, 'taken', null, 'remaining', null, 'full', false,
                              'waitlist_open', not coalesce(v_closed, false));
  end if;
  v_taken := public.entry_count(p_tournament_id);
  return jsonb_build_object(
    'cap', v_cap,
    'taken', v_taken,
    'remaining', greatest(v_cap - v_taken, 0),
    'full', v_taken >= v_cap,
    'waitlist_open', not coalesce(v_closed, false)
  );
end;
$$;

revoke all on function public.registration_capacity(uuid) from public;
grant execute on function public.registration_capacity(uuid) to anon, authenticated, service_role;
