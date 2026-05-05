-- Badminton Tournament schema
-- Run this in Supabase Dashboard → SQL Editor

-- ============================================================
-- TABLES
-- ============================================================

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_date date,
  phase text not null default 'none' check (phase in ('none','group','knockout')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null,
  color text not null default '#457B9D',
  photo_url text,
  note text,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists players_tournament_idx on public.players(tournament_id);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null,
  p1_id uuid not null references public.players(id) on delete cascade,
  p2_id uuid not null references public.players(id) on delete cascade,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists teams_tournament_idx on public.teams(tournament_id);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  stage text not null check (stage in ('group','knockout')),
  group_idx int,           -- group stage: which group (0..n)
  round_idx int,           -- knockout: which round (0..n)
  slot_idx int not null,   -- position within group/round
  team_a_id uuid references public.teams(id) on delete set null,
  team_b_id uuid references public.teams(id) on delete set null,
  score_a int,
  score_b int,
  winner_id uuid references public.teams(id) on delete set null,
  confirmed boolean not null default false,
  is_bye boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists matches_tournament_idx on public.matches(tournament_id);
create index if not exists matches_stage_idx on public.matches(tournament_id, stage);

-- ============================================================
-- STORAGE bucket for player photos
-- ============================================================
insert into storage.buckets (id, name, public)
values ('player-photos', 'player-photos', true)
on conflict (id) do nothing;

-- ============================================================
-- ROW LEVEL SECURITY
-- Public read, admin-only write. Admin = email matches your address.
-- ============================================================
alter table public.tournaments enable row level security;
alter table public.players     enable row level security;
alter table public.teams       enable row level security;
alter table public.matches     enable row level security;

-- helper: is the current user the admin?
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select lower((auth.jwt() ->> 'email')) = lower('Ashishdawar09@gmail.com')),
    false
  );
$$;

-- READ: anyone (anon or authenticated)
drop policy if exists "read tournaments" on public.tournaments;
create policy "read tournaments" on public.tournaments for select using (true);
drop policy if exists "read players" on public.players;
create policy "read players" on public.players for select using (true);
drop policy if exists "read teams" on public.teams;
create policy "read teams" on public.teams for select using (true);
drop policy if exists "read matches" on public.matches;
create policy "read matches" on public.matches for select using (true);

-- WRITE: admin only
drop policy if exists "admin write tournaments" on public.tournaments;
create policy "admin write tournaments" on public.tournaments for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin write players" on public.players;
create policy "admin write players" on public.players for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin write teams" on public.teams;
create policy "admin write teams" on public.teams for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin write matches" on public.matches;
create policy "admin write matches" on public.matches for all
  using (public.is_admin()) with check (public.is_admin());

-- Storage policies for player-photos bucket
drop policy if exists "public read photos" on storage.objects;
create policy "public read photos" on storage.objects for select
  using (bucket_id = 'player-photos');
drop policy if exists "admin write photos" on storage.objects;
create policy "admin write photos" on storage.objects for all
  using (bucket_id = 'player-photos' and public.is_admin())
  with check (bucket_id = 'player-photos' and public.is_admin());

-- ============================================================
-- REALTIME (so anyone watching sees scores live)
-- ============================================================
alter publication supabase_realtime add table public.tournaments;
alter publication supabase_realtime add table public.players;
alter publication supabase_realtime add table public.teams;
alter publication supabase_realtime add table public.matches;
