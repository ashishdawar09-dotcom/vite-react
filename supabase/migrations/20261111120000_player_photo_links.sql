-- Player photo links (Nov 10, 2026).
--
-- Every player gets a private link, /photo/<token>, to add or change the
-- photo on their own player profile (players.photo_url), which the live app
-- and the hall TV's player cards show. The player-photo Edge Function is the
-- only thing that reads this table: the token is the credential, so neither
-- the public nor signed-in users can see it.
--
-- The photo invite email (player-briefing, kind photo_invite) creates the
-- links it needs and sends each player their own.

create table if not exists public.player_photo_links (
  player_id uuid primary key references public.players(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  removed_at timestamptz,
  uploads integer not null default 0 check (uploads >= 0),
  consent_at timestamptz,
  consent_text text
);

alter table public.player_photo_links enable row level security;
-- No policies on purpose: only the service role (the Edge Functions) may touch it.
revoke all on table public.player_photo_links from public, anon, authenticated;
grant select, insert, update, delete on table public.player_photo_links to service_role;

comment on table public.player_photo_links is
  'Private per-player links for adding a profile photo (/photo/<token>). Service role only.';

-- The photo invite is a fourth kind of player email.
alter table public.briefing_emails drop constraint if exists briefing_emails_kind_check;
alter table public.briefing_emails
  add constraint briefing_emails_kind_check check (kind in ('day_before', 'morning_of', 'full_house', 'photo_invite'));
