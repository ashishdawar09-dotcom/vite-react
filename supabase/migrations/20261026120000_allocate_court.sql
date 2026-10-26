-- Allocate (or move) a match to a court, one admin at a time.
--
-- The app checked "is this court free?" against its own copy of the matches
-- and then wrote court_number. Two admins picking Court 2 for different
-- matches at the same moment both passed the check, both rows got Court 2,
-- the Court Status card showed only one of them, and both pairs of teams
-- were told "Court 2". This takes a per-tournament lock, refuses if another
-- unfinished match holds the court, and only then writes.
--
-- "Holds the court" = not confirmed, on that court, and either live or
-- allocated (warming up). That is what the admin screens show as busy.
--
-- A first allocation (or a row with a court but no stamp) sets
-- court_allocated_at (start of warm-up). Moving a match that already has a
-- court keeps its timestamps, like the old reassignCourt. The player-conflict warning stays in the app: it is a
-- question for the admin, not a rule.
--
-- Replaces the never-used start_match_on_court (left in place; nothing
-- calls it).

create function public.allocate_court(p_match_id uuid, p_court integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_match matches%rowtype;
  v_holder record;
begin
  if not is_admin() then
    raise exception 'forbidden';
  end if;
  if p_court is null or p_court < 1 then
    raise exception 'Pick a court.';
  end if;

  select * into v_match from matches where id = p_match_id;
  if not found then
    raise exception 'Match not found. Refresh and try again.';
  end if;

  -- Every allocation in this tournament queues here, so the check below
  -- sees any allocation that committed first.
  perform pg_advisory_xact_lock(hashtext('allocate_court|' || v_match.tournament_id::text)::bigint);

  -- Re-read under the lock: the match may have been finished or moved.
  select * into v_match from matches where id = p_match_id for update;
  if v_match.confirmed then
    raise exception 'This match is already finished.';
  end if;

  select m.id, m.status, m.started_at,
         coalesce(ta.name, '?') as a_name, coalesce(tb.name, '?') as b_name
    into v_holder
    from matches m
    left join teams ta on ta.id = m.team_a_id
    left join teams tb on tb.id = m.team_b_id
   where m.tournament_id = v_match.tournament_id
     and m.court_number = p_court
     and m.id <> p_match_id
     and not m.confirmed
     and (m.status = 'live' or m.court_allocated_at is not null)
   limit 1;
  if found then
    raise exception 'court_taken: Court % is held by % v % (%). Pick another court.',
      p_court, v_holder.a_name, v_holder.b_name,
      case when v_holder.status = 'live' then 'in play' else 'warming up' end;
  end if;

  update matches
     set court_number = p_court,
         court_allocated_at = case when v_match.court_number is null or v_match.court_allocated_at is null then now()
                                   else v_match.court_allocated_at end
   where id = p_match_id;
end;
$$;

revoke all on function public.allocate_court(uuid, integer) from public, anon;
grant execute on function public.allocate_court(uuid, integer) to authenticated;
