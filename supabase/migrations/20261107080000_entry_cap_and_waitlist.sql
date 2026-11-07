-- A hard stop on entries per tournament, the count the public form shows,
-- and a waitlist for when it's full.
--
-- An entry is one player in one event: someone in three events is three
-- entries, a doubles pair is two. Shuttle Storm '26 stops at 150 (Ashish,
-- Nov 7 2026: "We need to put a hard stop at 150").
--
-- How entries are counted (entry_count), per event:
-- * Everyone on the roster (player_categories, active players).
-- * Everyone on an entry not approved yet: e-Transfer entries waiting for
--   review ('pending') and card entries with checkout open
--   ('awaiting_payment'), plus the partner they name with an email.
-- * A person is an email plus first name, the way approve_registration
--   matches players, so a partner paying their own share, a retry, or the
--   approved copy of an entry is counted once. Roster players without an
--   email are themselves.
-- * In doubles, anyone without a partner also holds the seat beside them:
--   a player waiting for a partner counts two. On Nov 7 2026 that gave
--   121 roster entries + 10 open seats = 131, Ashish's own count.
--
-- The stop (enforce_entry_cap): after every insert into
-- pending_registrations, the tournament's count is taken again under a
-- per-tournament lock, and if it's over the cap the insert is undone with
-- 'entry_cap_reached'. Because it counts after the insert, entries that add
-- nobody new (a partner paying their share, joining a partner who is waiting
-- for them, a card retry) still go through at the cap. Directors adding
-- players in the app are not limited.
--
-- registration_capacity: the public count for the form (cap, taken,
-- remaining, full); no cap gives nulls.
--
-- registration_waitlist: name, mobile number and email of people who want a
-- spot once it's full. Written by the join-waitlist Edge Function; directors
-- read it.
--
-- Rollback: drop trigger pending_registrations_entry_cap on
-- pending_registrations (or set entry_cap to null), then drop the functions,
-- the table and the column.

alter table public.tournaments
  add column if not exists entry_cap integer
  constraint tournaments_entry_cap_positive check (entry_cap is null or entry_cap > 0);

grant select (entry_cap) on public.tournaments to anon, authenticated;

create or replace function public.entry_count(p_tournament_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with cats as (
    select id, team_size from public.categories where tournament_id = p_tournament_id
  ),
  open_entries as (
    select pr.category_id,
           lower(btrim(pr.player_email)) || '|' || split_part(lower(btrim(pr.player_name)), ' ', 1) as who,
           case when c.team_size = 2 and nullif(btrim(pr.partner_email), '') is not null
                then lower(btrim(pr.partner_email)) || '|' || split_part(lower(btrim(coalesce(pr.partner_name, ''))), ' ', 1)
           end as partner
      from public.pending_registrations pr
      join cats c on c.id = pr.category_id
     where pr.status in ('pending', 'awaiting_payment')
  ),
  roster as (
    select pc.category_id, p.id as player_id,
           coalesce(nullif(lower(btrim(p.email)), '') || '|' || split_part(lower(btrim(p.name)), ' ', 1),
                    'id:' || p.id::text) as who
      from public.player_categories pc
      join public.players p on p.id = pc.player_id and p.active
      join cats c on c.id = pc.category_id
  ),
  people as (
    select category_id, who from roster
    union
    select category_id, who from open_entries
    union
    select category_id, partner from open_entries where partner is not null
  ),
  paired as (
    -- On a team whose two players are both still active.
    select r.category_id, r.who
      from roster r
      join public.teams t on t.category_id = r.category_id and r.player_id in (t.p1_id, t.p2_id)
      join public.players a on a.id = t.p1_id and a.active
      join public.players b on b.id = t.p2_id and b.active
    union
    -- On an entry naming a partner by email: approval makes them a team.
    select category_id, who from open_entries where partner is not null
    union
    select category_id, partner from open_entries where partner is not null
  )
  select (
    (select count(*) from people)
    + (select count(*)
         from people pe
         join cats c on c.id = pe.category_id and c.team_size = 2
        where not exists (select 1 from paired pa where pa.category_id = pe.category_id and pa.who = pe.who))
  )::integer;
$$;

revoke all on function public.entry_count(uuid) from public, anon, authenticated;
grant execute on function public.entry_count(uuid) to service_role;

create or replace function public.registration_capacity(p_tournament_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cap integer;
  v_taken integer;
begin
  select entry_cap into v_cap from public.tournaments where id = p_tournament_id;
  if v_cap is null then
    return jsonb_build_object('cap', null, 'taken', null, 'remaining', null, 'full', false);
  end if;
  v_taken := public.entry_count(p_tournament_id);
  return jsonb_build_object(
    'cap', v_cap,
    'taken', v_taken,
    'remaining', greatest(v_cap - v_taken, 0),
    'full', v_taken >= v_cap
  );
end;
$$;

revoke all on function public.registration_capacity(uuid) from public;
grant execute on function public.registration_capacity(uuid) to anon, authenticated, service_role;

create or replace function public.enforce_entry_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_cap integer;
  v_taken integer;
begin
  for r in select distinct tournament_id from inserted where status in ('pending', 'awaiting_payment') loop
    select entry_cap into v_cap from public.tournaments where id = r.tournament_id;
    continue when v_cap is null;
    -- One check at a time per tournament: two entries racing for the last
    -- spots can't both see room. The count runs after the lock is held, so it
    -- sees anything the other one committed.
    perform pg_advisory_xact_lock(hashtext('entry_cap|' || r.tournament_id::text)::bigint);
    v_taken := public.entry_count(r.tournament_id);
    if v_taken > v_cap then
      raise exception 'entry_cap_reached'
        using errcode = 'P0001',
              detail = json_build_object('cap', v_cap, 'taken', v_taken)::text,
              hint = 'Every entry for this tournament is taken.';
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.enforce_entry_cap() from public, anon, authenticated;

drop trigger if exists pending_registrations_entry_cap on public.pending_registrations;
create trigger pending_registrations_entry_cap
  after insert on public.pending_registrations
  referencing new table as inserted
  for each statement
  execute function public.enforce_entry_cap();

create table if not exists public.registration_waitlist (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  email text not null check (char_length(email) between 3 and 254),
  phone text not null check (char_length(phone) between 7 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The directors' alert for this name: 'sent', 'failed: …' or 'not configured'.
  admin_email_status text
);

-- One row per address per tournament; joining again updates it.
create unique index if not exists registration_waitlist_tournament_email
  on public.registration_waitlist (tournament_id, lower(email));

alter table public.registration_waitlist enable row level security;
drop policy if exists "admin read registration waitlist" on public.registration_waitlist;
create policy "admin read registration waitlist" on public.registration_waitlist
  as permissive for select to authenticated using ((select is_admin()));

-- Written only by the Edge Function (service role); admins read it.
revoke all on public.registration_waitlist from anon, authenticated;
grant select on public.registration_waitlist to authenticated;
grant all on public.registration_waitlist to service_role;

-- Shuttle Storm Abbotsford 2026: 150 entries.
update public.tournaments set entry_cap = 150 where id = 'e7bb59ca-5cfc-4e5e-a4f6-0649ece00feb';
