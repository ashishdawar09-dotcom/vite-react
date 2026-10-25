-- Deleting a team from the Teams tab now goes through delete_team(), which
-- needs a reason and keeps a record of what was removed. The plain RLS
-- delete on teams stays for the bulk paths (invalid-team cleanup, player
-- deactivation, tournament delete).

create table public.team_deletions (
  id bigint generated always as identity primary key,
  team_id uuid not null,
  tournament_id uuid,
  category_id uuid,
  p1_id uuid,
  p1_name text,
  p2_id uuid,
  p2_name text,
  team_snapshot jsonb not null,
  reason text not null,
  deleted_by text,
  deleted_at timestamptz not null default now()
);
create index team_deletions_tournament on public.team_deletions (tournament_id, deleted_at desc);
alter table public.team_deletions enable row level security;
create policy "admin read team deletions" on public.team_deletions
  as permissive for select to authenticated using ((select is_admin()));

-- Written only by delete_team(); admins read it.
revoke all on public.team_deletions from anon, authenticated;
grant select on public.team_deletions to authenticated;
grant all on public.team_deletions to service_role;

create function public.delete_team(p_team_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_team teams%rowtype;
begin
  if not is_admin() then
    raise exception 'forbidden';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'Please give a reason (3 to 500 characters).';
  end if;

  select * into v_team from teams where id = p_team_id for update;
  if not found then
    raise exception 'Team not found. It may already have been deleted.';
  end if;

  -- Once a team is in a match the tournament has started; don't pull it
  -- out from under the schedule.
  if exists (select 1 from matches
              where team_a_id = p_team_id or team_b_id = p_team_id or winner_id = p_team_id) then
    raise exception 'This team is already in a match and can''t be deleted.';
  end if;

  insert into team_deletions (team_id, tournament_id, category_id, p1_id, p1_name, p2_id, p2_name,
                              team_snapshot, reason, deleted_by)
  values (v_team.id, v_team.tournament_id, v_team.category_id,
          v_team.p1_id, (select name from players where id = v_team.p1_id),
          v_team.p2_id, (select name from players where id = v_team.p2_id),
          to_jsonb(v_team), v_reason, auth.jwt() ->> 'email');

  delete from teams where id = p_team_id;
end;
$$;

revoke all on function public.delete_team(uuid, text) from public, anon;
grant execute on function public.delete_team(uuid, text) to authenticated;
