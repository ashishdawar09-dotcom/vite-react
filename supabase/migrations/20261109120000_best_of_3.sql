-- Best-of-3 knockout matches.
--
-- categories.best_of_3_from is the event's setting: the first knockout round
-- played best of 3 games ('qf', 'sf' or 'final'; null = every match is one
-- game). The bronze match follows the final. Default 'sf', the published
-- Shuttle Storm rules: semifinals and finals are best of 3 games to 15.
--
-- matches.best_of (1 or 3) is the match's own format. It is set from the
-- event's setting when the bracket is created and whenever the setting
-- changes, but only on matches that haven't started, so a live or finished
-- match keeps the format it was played in. Every screen reads this column.
--
-- matches.games holds a best-of-3 match's finished games in order, as
-- [[a, b], ...]. While the match is live, score_a/score_b hold the current
-- game's points (the +/- taps keep working unchanged); once it is confirmed
-- they hold games won (2-0 or 2-1), so any screen that shows score_a-score_b
-- shows the match result. Null on one-game matches.
--
-- Additive only: existing rows get best_of = 1 and games = null, which is
-- exactly today's behaviour.

alter table public.categories
  add column best_of_3_from text default 'sf'
    constraint categories_best_of_3_from_check check (best_of_3_from in ('qf', 'sf', 'final'));

alter table public.matches
  add column best_of smallint not null default 1
    constraint matches_best_of_check check (best_of in (1, 3)),
  add column games jsonb
    constraint matches_games_check check (
      games is null or (jsonb_typeof(games) = 'array' and jsonb_array_length(games) <= 3)
    );

-- Stamp best_of on a category's knockout matches that haven't started, from
-- the category's setting. Rounds count back from the final: the final (and
-- the bronze match) is 0, the semifinals 1, the quarterfinals 2. Returns how
-- many matches changed. Internal: called by start_category_stage and
-- set_knockout_format, never by the app directly.
create function public.apply_knockout_format(p_category_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from text;
  v_depth integer;
  v_last integer;
  v_count integer;
begin
  select best_of_3_from into v_from from categories where id = p_category_id;
  v_depth := case v_from when 'final' then 0 when 'sf' then 1 when 'qf' then 2 else -1 end;

  select max(round_idx) into v_last
    from matches where category_id = p_category_id and stage = 'knockout';
  if v_last is null then
    return 0;
  end if;

  with target as (
    select m.id,
           case when (case when m.is_bronze then 0 else v_last - m.round_idx end) <= v_depth
                then 3 else 1 end::smallint as best_of
      from matches m
     where m.category_id = p_category_id
       and m.stage = 'knockout'
       and m.round_idx is not null
       and m.status = 'pending'
       and not m.confirmed
       and m.started_at is null
       and m.games is null
  )
  update matches m
     set best_of = t.best_of
    from target t
   where m.id = t.id
     and m.best_of is distinct from t.best_of;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.apply_knockout_format(uuid) from public, anon, authenticated;

-- The event setting, from Edit Event. Saves the setting and restamps the
-- event's knockout matches that haven't started, in one transaction.
-- p_from: 'qf', 'sf', 'final', or null for "never".
create function public.set_knockout_format(p_category_id uuid, p_from text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not is_admin() then
    raise exception 'forbidden';
  end if;
  if p_from is not null and p_from not in ('qf', 'sf', 'final') then
    raise exception 'Unknown format: %', p_from;
  end if;
  update categories set best_of_3_from = p_from where id = p_category_id;
  if not found then
    raise exception 'Category not found.';
  end if;
  return apply_knockout_format(p_category_id);
end;
$$;

revoke all on function public.set_knockout_format(uuid, text) from public, anon;
grant execute on function public.set_knockout_format(uuid, text) to authenticated;

-- start_category_stage, unchanged except for the last step: a new knockout
-- bracket takes its format from the event's setting in the same transaction.
create or replace function public.start_category_stage(
  p_category_id uuid,
  p_stage text,
  p_matches jsonb,
  p_groups_count integer default null,
  p_top_n_advance integer default null,
  p_rounds_per_pair integer default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
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

  update categories
     set phase = p_stage,
         groups_count = coalesce(p_groups_count, groups_count),
         top_n_advance = coalesce(p_top_n_advance, top_n_advance),
         rounds_per_pair = coalesce(p_rounds_per_pair, rounds_per_pair)
   where id = p_category_id;

  if p_stage = 'knockout' then
    perform apply_knockout_format(p_category_id);
  end if;
  return v_count;
end;
$$;
