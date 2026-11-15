-- Result options from the start of a match + Replace team (Ashish, Nov 15 2026).
-- Additive only: the app before this change ignores the new column, table and function.
-- 1. "Retired (injury)": a side stopped during play and the other side won. The score so far is shown;
--    like a walkover it gives the win but no points either way (Ashish, Nov 15).
alter table public.matches add column if not exists is_retired boolean not null default false;

-- 2. The match history also records team swaps and the walkover / retired flags
--    (today a swap on a pending match leaves no trace: only score/status/winner/court/confirmed are logged).
create or replace function public.log_match_change()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
DECLARE
  v_actor text := coalesce(auth.jwt() ->> 'email', 'system');
  v_changed text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO match_audit_log (match_id, tournament_id, changed_by, action, after_data)
    VALUES (NEW.id, NEW.tournament_id, v_actor, 'insert', to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.score_a IS DISTINCT FROM OLD.score_a THEN v_changed := array_append(v_changed, 'score_a'); END IF;
    IF NEW.score_b IS DISTINCT FROM OLD.score_b THEN v_changed := array_append(v_changed, 'score_b'); END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN v_changed := array_append(v_changed, 'status'); END IF;
    IF NEW.winner_id IS DISTINCT FROM OLD.winner_id THEN v_changed := array_append(v_changed, 'winner_id'); END IF;
    IF NEW.court_number IS DISTINCT FROM OLD.court_number THEN v_changed := array_append(v_changed, 'court_number'); END IF;
    IF NEW.confirmed IS DISTINCT FROM OLD.confirmed THEN v_changed := array_append(v_changed, 'confirmed'); END IF;
    IF NEW.team_a_id IS DISTINCT FROM OLD.team_a_id THEN v_changed := array_append(v_changed, 'team_a_id'); END IF;
    IF NEW.team_b_id IS DISTINCT FROM OLD.team_b_id THEN v_changed := array_append(v_changed, 'team_b_id'); END IF;
    IF NEW.is_walkover IS DISTINCT FROM OLD.is_walkover THEN v_changed := array_append(v_changed, 'is_walkover'); END IF;
    IF NEW.is_retired IS DISTINCT FROM OLD.is_retired THEN v_changed := array_append(v_changed, 'is_retired'); END IF;
    IF array_length(v_changed, 1) > 0 THEN
      INSERT INTO match_audit_log (match_id, tournament_id, changed_by, action, before_data, after_data, changed_fields)
      VALUES (NEW.id, NEW.tournament_id, v_actor, 'update', to_jsonb(OLD), to_jsonb(NEW), v_changed);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO match_audit_log (match_id, tournament_id, changed_by, action, before_data)
    VALUES (OLD.id, OLD.tournament_id, v_actor, 'delete', to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

-- 3. Who replaced whom, when, why. Admin-only.
create table if not exists public.team_replacements (
  id bigint generated always as identity primary key,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  outgoing_team_id uuid not null,
  incoming_team_id uuid not null,
  match_ids uuid[] not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  replaced_by text not null default coalesce(auth.jwt() ->> 'email', 'system'),
  replaced_at timestamptz not null default now()
);
alter table public.team_replacements enable row level security;
create policy "admin read team replacements" on public.team_replacements for select to authenticated using ((select is_admin()));
revoke all on public.team_replacements from anon, authenticated;
grant select on public.team_replacements to authenticated;

-- 4. The swap itself: one transaction, every rule re-checked on the server (another admin may have
--    started the match a second ago). Either every listed match changes or none does.
--    Incoming = an existing team (p_incoming) or a new pair made here (p_new_p1 [+ p_new_p2]).
create or replace function public.replace_team(
  p_category_id uuid, p_outgoing uuid, p_incoming uuid, p_match_ids uuid[], p_reason text,
  p_new_p1 uuid default null, p_new_p2 uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_cat record; v_in uuid := p_incoming; m record; v_n int := 0; v_has_group boolean := false;
begin
  if not is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'reason_required'; end if;
  if coalesce(array_length(p_match_ids, 1), 0) = 0 then raise exception 'no_matches'; end if;
  select id, tournament_id, team_size into v_cat from categories where id = p_category_id;
  if v_cat.id is null then raise exception 'no_event'; end if;
  if not exists (select 1 from teams where id = p_outgoing and category_id = p_category_id) then raise exception 'outgoing_not_in_event'; end if;

  if v_in is null then                                    -- a new pair (or a new singles entry)
    if p_new_p1 is null then raise exception 'no_incoming'; end if;
    if (v_cat.team_size = 1) <> (p_new_p2 is null) then raise exception 'wrong_team_size'; end if;
    if exists (select 1 from players where id in (p_new_p1, p_new_p2) and (tournament_id <> v_cat.tournament_id or not active))
       or (select count(*) from players where id in (p_new_p1, p_new_p2)) <> (case when p_new_p2 is null then 1 else 2 end)
      then raise exception 'new_player_invalid'; end if;
    -- A player already on a team that is still in this event's draw can't join a second one
    -- (the injured player's partner joining a substitute is fine: their old team is the one going out).
    if exists (select 1 from teams t where t.category_id = p_category_id and t.id <> p_outgoing
               and (t.p1_id in (p_new_p1, p_new_p2) or t.p2_id in (p_new_p1, p_new_p2))
               and exists (select 1 from matches mm where mm.category_id = p_category_id and not mm.confirmed
                           and mm.status <> 'completed' and not mm.is_bye and (mm.team_a_id = t.id or mm.team_b_id = t.id)))
      then raise exception 'new_player_still_in_draw'; end if;
    insert into teams (tournament_id, category_id, name, p1_id, p2_id, sort_order)
    select v_cat.tournament_id, p_category_id,
           (select name from players where id = p_new_p1) || coalesce(' & ' || (select name from players where id = p_new_p2), ''),
           p_new_p1, p_new_p2, coalesce((select max(sort_order) + 1 from teams where category_id = p_category_id), 0)
    returning id into v_in;
  elsif not exists (select 1 from teams where id = v_in and category_id = p_category_id) then
    raise exception 'incoming_not_in_event';
  end if;
  if v_in = p_outgoing then raise exception 'same_team'; end if;
  if exists (select 1 from teams t join players p on p.id in (t.p1_id, t.p2_id) where t.id = v_in and not p.active) then
    raise exception 'incoming_sitting_out'; end if;
  if exists (select 1 from matches where category_id = p_category_id and not confirmed and status <> 'completed' and not is_bye
             and (team_a_id = v_in or team_b_id = v_in)) then raise exception 'incoming_still_in_draw'; end if;

  for m in select * from matches where id = any (p_match_ids) order by id for update loop
    if m.category_id <> p_category_id then raise exception 'match_not_in_event'; end if;
    if m.team_a_id is distinct from p_outgoing and m.team_b_id is distinct from p_outgoing then raise exception 'outgoing_not_in_match'; end if;
    if m.stage = 'group' then v_has_group := true; end if;
    if m.is_bye then
      if m.winner_id is distinct from p_outgoing then raise exception 'bye_not_held'; end if;
    elsif m.confirmed or m.status <> 'pending' or m.started_at is not null or m.court_number is not null
          or m.court_allocated_at is not null or m.score_a is not null or m.score_b is not null or m.winner_id is not null then
      raise exception 'match_in_play_or_played';
    end if;
    update matches set
      team_a_id = case when team_a_id = p_outgoing then v_in else team_a_id end,
      team_b_id = case when team_b_id = p_outgoing then v_in else team_b_id end,
      winner_id = case when is_bye and winner_id = p_outgoing then v_in else winner_id end
    where id = m.id;
    v_n := v_n + 1;
  end loop;
  if v_n <> array_length(p_match_ids, 1) then raise exception 'match_missing'; end if;
  if v_has_group then
    if exists (select 1 from matches where category_id = p_category_id and stage = 'knockout') then raise exception 'knockout_started'; end if;
    -- A group swap must take every one of the team's group matches, or the team would sit in the group twice.
    if exists (select 1 from matches where category_id = p_category_id and stage = 'group'
               and (team_a_id = p_outgoing or team_b_id = p_outgoing)) then raise exception 'group_swap_incomplete'; end if;
  end if;
  delete from on_deck_alerts where match_id = any (p_match_ids);   -- the new team gets its own "you're up soon"
  insert into team_replacements (tournament_id, category_id, outgoing_team_id, incoming_team_id, match_ids, reason)
  values (v_cat.tournament_id, p_category_id, p_outgoing, v_in, p_match_ids, btrim(p_reason));
  return v_in;
end $$;
revoke all on function public.replace_team(uuid, uuid, uuid, uuid[], text, uuid, uuid) from public, anon;
grant execute on function public.replace_team(uuid, uuid, uuid, uuid[], text, uuid, uuid) to authenticated;
