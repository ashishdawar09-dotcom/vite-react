-- Volunteer desk (Nov 2026).
--
-- On game day volunteers at the front desk check players in and take their
-- photo from a separate small page (volunteer-desk/). They are not admins:
-- each volunteer gets a private link, and the volunteer-desk Edge Function
-- is the only thing that reads these two tables. It can do three things for
-- that link's tournament and nothing else: list the players, set or clear
-- players.checked_in_at, and set players.photo_url.
--
-- Nothing existing changes here: two new tables, no new columns, no triggers.

-- One row per volunteer link. The link itself is never stored, only its
-- SHA-256, so reading this table does not give anyone a working link.
create table if not exists public.desk_links (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 60),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  check (valid_until > valid_from)
);

alter table public.desk_links enable row level security;
-- No policies on purpose: only the service role (the Edge Function) may touch it.
revoke all on table public.desk_links from public, anon, authenticated;
grant select, insert, update, delete on table public.desk_links to service_role;

comment on table public.desk_links is
  'Private volunteer links for the game-day check-in desk. Holds a hash of each link. Service role only.';

-- Everything a volunteer link changed, so any step can be traced and undone.
create table if not exists public.desk_actions (
  id bigint generated always as identity primary key,
  link_id uuid references public.desk_links(id) on delete set null,
  volunteer text not null,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  player_name text not null,
  action text not null check (action in ('check_in', 'undo_check_in', 'photo', 'undo_photo')),
  prev_checked_in_at timestamptz,
  prev_photo_url text,
  new_photo_url text,
  consent_text text,
  created_at timestamptz not null default now()
);

create index if not exists desk_actions_player_idx on public.desk_actions (player_id, id desc);
create index if not exists desk_actions_tournament_idx on public.desk_actions (tournament_id, id desc);

alter table public.desk_actions enable row level security;
-- No policies on purpose: only the service role (the Edge Function) may touch it.
revoke all on table public.desk_actions from public, anon, authenticated;
grant select, insert on table public.desk_actions to service_role;

comment on table public.desk_actions is
  'Log of every check-in and photo change made from a volunteer desk link. Service role only.';
