-- Seeding (Ashish, Nov 13 2026): the director numbers the top entries of each
-- event (1, 2, 3…) and may tag others tier A (strong) or B (good). The group
-- draw keeps strong entries apart and the knockout is ordered by seed.
--
-- One row per entry: a team (doubles) or a player (singles, whose one-player
-- teams are only made when the group stage starts).
-- ADMIN-ONLY: no anon access at all, authenticated rows only via is_admin().
-- live_snapshot() and /api/snapshot never read this table, so seeds and
-- tiers never reach a public page.

create table public.entry_seeds (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  player_id uuid references public.players(id) on delete cascade,
  seed int check (seed between 1 and 999),
  tier text check (tier in ('A', 'B')),
  note text check (char_length(note) <= 500),
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint entry_seeds_one_entry check ((team_id is null) <> (player_id is null)),
  constraint entry_seeds_has_rating check (seed is not null or tier is not null or note is not null)
);

create unique index entry_seeds_category_team on public.entry_seeds (category_id, team_id) where team_id is not null;
create unique index entry_seeds_category_player on public.entry_seeds (category_id, player_id) where player_id is not null;
create index entry_seeds_tournament on public.entry_seeds (tournament_id);

alter table public.entry_seeds enable row level security;

create policy "admin all entry seeds" on public.entry_seeds
  as permissive for all to authenticated
  using ((select is_admin())) with check ((select is_admin()));

revoke all on public.entry_seeds from anon, authenticated;
grant select, insert, update, delete on public.entry_seeds to authenticated;
grant all on public.entry_seeds to service_role;

-- Replaces an event's seeds in one go (the Seeding screen saves the whole
-- list, so renumbering 1 ↔ 2 never trips over a half-saved state).
-- p_rows: [{ "team_id"?: uuid, "player_id"?: uuid, "seed"?: int, "tier"?: "A"|"B", "note"?: text }]
create function public.save_entry_seeds(p_category_id uuid, p_rows jsonb)
returns setof public.entry_seeds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament uuid;
  v_by text := auth.jwt() ->> 'email';
  r jsonb;
  v_team uuid;
  v_player uuid;
  v_seed int;
  v_tier text;
  v_note text;
begin
  if not is_admin() then
    raise exception 'forbidden';
  end if;
  select tournament_id into v_tournament from categories where id = p_category_id;
  if v_tournament is null then
    raise exception 'Event not found.';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'Seeds must be a list.';
  end if;

  delete from entry_seeds where category_id = p_category_id;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_team := nullif(r ->> 'team_id', '')::uuid;
    v_player := nullif(r ->> 'player_id', '')::uuid;
    v_seed := nullif(r ->> 'seed', '')::int;
    v_tier := nullif(r ->> 'tier', '');
    v_note := nullif(btrim(coalesce(r ->> 'note', '')), '');
    if v_seed is null and v_tier is null and v_note is null then
      continue;
    end if;
    if v_team is not null and not exists (select 1 from teams where id = v_team and category_id = p_category_id) then
      raise exception 'That team is not in this event any more. Reload and try again.';
    end if;
    if v_player is not null and not exists (
      select 1 from player_categories pc join players p on p.id = pc.player_id
       where pc.player_id = v_player and pc.category_id = p_category_id and p.tournament_id = v_tournament) then
      raise exception 'That player is not in this event any more. Reload and try again.';
    end if;
    insert into entry_seeds (tournament_id, category_id, team_id, player_id, seed, tier, note, updated_by, updated_at)
    values (v_tournament, p_category_id, v_team, v_player, v_seed, v_tier, v_note, v_by, now());
  end loop;

  return query select * from entry_seeds where category_id = p_category_id;
end;
$$;

revoke all on function public.save_entry_seeds(uuid, jsonb) from public, anon;
grant execute on function public.save_entry_seeds(uuid, jsonb) to authenticated;
