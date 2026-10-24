-- Deleting a player needs a one-time code emailed to the owner. Admins keep
-- insert/update on players but lose delete; the `delete-player` Edge Function
-- (service role) deletes only after the code checks out.

-- Production had already split the baseline "admin write players" policy
-- into insert/update/delete by hand; drop whichever exist and recreate.
drop policy if exists "admin write players" on public.players;
drop policy if exists "admin insert players" on public.players;
drop policy if exists "admin update players" on public.players;
drop policy if exists "admin delete players" on public.players;
create policy "admin insert players" on public.players as permissive for insert to public with check ((select is_admin()));
create policy "admin update players" on public.players as permissive for update to public using ((select is_admin())) with check ((select is_admin()));

-- One row per code sent. Only the hash is stored; service role only.
create table public.player_delete_codes (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  code_hash text not null,
  requested_by text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index player_delete_codes_player on public.player_delete_codes (player_id, created_at desc);
alter table public.player_delete_codes enable row level security;
revoke all on public.player_delete_codes from anon, authenticated;
grant select, insert, update, delete on public.player_delete_codes to service_role;
