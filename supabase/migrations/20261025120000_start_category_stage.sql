-- Start Group Stage / Start Knockout as one transaction per category.
--
-- The app used to insert the matches and then set categories.phase in two
-- separate requests, guarded only per browser. Rapid taps or two admins made
-- a second round robin or a second bracket, and a dropped phase request left
-- the matches in place with the category still showing "Start". This locks
-- the category row, refuses if that stage already has matches, inserts, and
-- sets the phase, all or nothing.
--
-- The app builds the rows (shuffle, seeding, byes); this only checks and
-- writes them. tournament_id, category_id and stage come from the category
-- and the argument, never from the rows.

create function public.start_category_stage(p_category_id uuid, p_stage text, p_matches jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat categories%rowtype;
  v_count integer;
begin
  if not is_admin() then
    raise exception 'forbidden';
  end if;
  if p_stage is null or p_stage not in ('group', 'knockout') then
    raise exception 'Unknown stage: %', p_stage;
  end if;
  if p_matches is null or jsonb_typeof(p_matches) <> 'array' or jsonb_array_length(p_matches) = 0 then
    raise exception 'No matches to create.';
  end if;

  -- Concurrent starts of the same category queue here; the second one then
  -- sees the first one's matches and stops.
  select * into v_cat from categories where id = p_category_id for update;
  if not found then
    raise exception 'Category not found.';
  end if;

  if p_stage = 'group' then
    if v_cat.phase <> 'none' or exists (select 1 from matches where category_id = p_category_id) then
      raise exception 'stage_already_started';
    end if;
  elsif exists (select 1 from matches where category_id = p_category_id and stage = 'knockout') then
    raise exception 'stage_already_started';
  end if;

  -- Every team must belong to this category.
  if exists (
    select 1
      from jsonb_to_recordset(p_matches) as x(team_a_id uuid, team_b_id uuid, winner_id uuid),
           lateral (values (x.team_a_id), (x.team_b_id), (x.winner_id)) as t(team_id)
     where t.team_id is not null
       and not exists (select 1 from teams where id = t.team_id and category_id = p_category_id)
  ) then
    raise exception 'A team in this draw is not in this category. Refresh and try again.';
  end if;

  insert into matches (tournament_id, category_id, stage, group_idx, round_idx, slot_idx,
                       team_a_id, team_b_id, winner_id, confirmed, is_bye, status, is_bronze)
  select v_cat.tournament_id, p_category_id, p_stage, x.group_idx, x.round_idx, x.slot_idx,
         x.team_a_id, x.team_b_id, x.winner_id,
         coalesce(x.confirmed, false), coalesce(x.is_bye, false),
         coalesce(x.status, 'pending'), coalesce(x.is_bronze, false)
    from jsonb_to_recordset(p_matches) as x(group_idx integer, round_idx integer, slot_idx integer,
                                            team_a_id uuid, team_b_id uuid, winner_id uuid,
                                            confirmed boolean, is_bye boolean, status text, is_bronze boolean);
  get diagnostics v_count = row_count;

  update categories set phase = p_stage where id = p_category_id;
  return v_count;
end;
$$;

revoke all on function public.start_category_stage(uuid, text, jsonb) from public, anon;
grant execute on function public.start_category_stage(uuid, text, jsonb) to authenticated;
