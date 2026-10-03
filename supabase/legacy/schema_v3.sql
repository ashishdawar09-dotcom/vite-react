-- v3: Categories + scheduling + court tracking + walkover
-- Run AFTER schema.sql + schema_v2.sql, in Supabase SQL Editor.
-- Safe to re-run (idempotent).

-- ============================================================
-- 1. CATEGORIES TABLE
-- ============================================================
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null,
  team_size int not null default 2 check (team_size in (1, 2)),
  match_minutes int not null default 12 check (match_minutes between 1 and 120),
  starts_at timestamptz,
  phase text not null default 'none' check (phase in ('none','group','knockout')),
  rounds_per_pair int not null default 1 check (rounds_per_pair between 1 and 3),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists categories_tournament_idx on public.categories(tournament_id);

-- ============================================================
-- 2. COLUMN ADDITIONS
-- ============================================================
alter table public.tournaments
  add column if not exists num_courts int not null default 2 check (num_courts between 1 and 12);

alter table public.teams
  add column if not exists category_id uuid references public.categories(id) on delete cascade;

alter table public.teams
  alter column p2_id drop not null;

alter table public.matches
  add column if not exists category_id uuid references public.categories(id) on delete cascade,
  add column if not exists court_number int,
  add column if not exists scheduled_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists is_walkover boolean not null default false,
  add column if not exists queue_position int;

create index if not exists matches_category_idx on public.matches(category_id);
create index if not exists teams_category_idx on public.teams(category_id);

-- ============================================================
-- 3. DATA MIGRATION — backfill existing data into a default Doubles category
-- ============================================================
do $$
declare
  t record;
  cid uuid;
begin
  for t in select id, phase, rounds_per_pair from public.tournaments loop
    if not exists (select 1 from public.categories where tournament_id = t.id) then
      insert into public.categories (tournament_id, name, team_size, phase, rounds_per_pair, sort_order)
      values (t.id, 'Doubles', 2, t.phase, t.rounds_per_pair, 0)
      returning id into cid;

      update public.teams   set category_id = cid where tournament_id = t.id and category_id is null;
      update public.matches set category_id = cid where tournament_id = t.id and category_id is null;
    end if;
  end loop;
end $$;

-- Backfill confirmed_at for already-confirmed matches (use created_at as a fallback for time math)
update public.matches
  set confirmed_at = coalesce(started_at, created_at)
  where confirmed = true and confirmed_at is null;

-- ============================================================
-- 4. NOT NULL constraints (after backfill)
-- ============================================================
do $$
begin
  if exists (select 1 from public.teams where category_id is null) then
    raise notice 'Skipping NOT NULL on teams.category_id: % rows still null', (select count(*) from public.teams where category_id is null);
  else
    alter table public.teams alter column category_id set not null;
  end if;

  if exists (select 1 from public.matches where category_id is null) then
    raise notice 'Skipping NOT NULL on matches.category_id: % rows still null', (select count(*) from public.matches where category_id is null);
  else
    alter table public.matches alter column category_id set not null;
  end if;
end $$;

-- ============================================================
-- 5. RLS / REALTIME / REPLICA IDENTITY for categories
-- ============================================================
alter table public.categories enable row level security;

drop policy if exists "read categories" on public.categories;
create policy "read categories" on public.categories for select using (true);

drop policy if exists "admin write categories" on public.categories;
create policy "admin write categories" on public.categories for all
  using (public.is_admin()) with check (public.is_admin());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'categories'
  ) then
    alter publication supabase_realtime add table public.categories;
  end if;
end $$;

alter table public.categories replica identity full;
