-- Security hardening ahead of Shuttle Storm (Oct 2026 review).

-- 1. Function execute grants -----------------------------------------------
-- Admin RPCs check is_admin() internally, but anon shouldn't reach them at all.
do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_players(uuid)',
    'public.approve_registration(uuid)',
    'public.reject_registration(uuid, text)',
    'public.extend_match(uuid, integer)',
    'public.set_player_categories(uuid, uuid[])',
    'public.start_match_on_court(uuid, integer)',
    'public.swap_match_queue_positions(uuid, integer, uuid, integer)',
    'public.my_player(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- Trigger functions are never called through the API.
  foreach f in array array['public.log_match_change()', 'public.tournaments_autoslug()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
-- is_admin() stays executable by anon/authenticated: RLS policies call it as
-- the querying role. live_snapshot() stays public (spectator data).

alter function public.slugify(text) set search_path = public;
alter function public.tournaments_autoslug() set search_path = public;

-- 2. Admin write policies ---------------------------------------------------
-- "admin write X" was FOR ALL, so every public read also evaluated is_admin()
-- (volatile, once per row). Split into insert/update/delete and cache the
-- check per statement with (select ...). Reads stay covered by "read X".
alter function public.is_admin() stable;

do $$
declare
  t text;
  pol text;
begin
  foreach t in array array['categories', 'matches', 'players', 'teams', 'tournaments'] loop
    pol := 'admin write ' || t;
    execute format('drop policy if exists %I on public.%I', pol, t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.is_admin()))', 'admin insert ' || t, t);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', 'admin update ' || t, t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.is_admin()))', 'admin delete ' || t, t);
  end loop;
end $$;

drop policy if exists "player_categories_write" on public.player_categories;
create policy "admin insert player_categories" on public.player_categories
  for insert to authenticated with check ((select public.is_admin()));
create policy "admin update player_categories" on public.player_categories
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin delete player_categories" on public.player_categories
  for delete to authenticated using ((select public.is_admin()));

drop policy if exists "tournament_admins_admin_write" on public.tournament_admins;
create policy "admin insert tournament_admins" on public.tournament_admins
  for insert to authenticated with check ((select public.is_admin()));
create policy "admin update tournament_admins" on public.tournament_admins
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin delete tournament_admins" on public.tournament_admins
  for delete to authenticated using ((select public.is_admin()));
drop policy if exists "tournament_admins_read_self" on public.tournament_admins;
create policy "tournament_admins_read_self" on public.tournament_admins
  for select to authenticated
  using ((select public.is_admin()) or lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', '')));

-- 3. Player photos ---------------------------------------------------------
-- Public URLs keep working for a public bucket without a SELECT policy; the
-- policy only enabled anonymous listing of every file. Uploads are admin-only.
drop policy if exists "public read photos" on storage.objects;
update storage.buckets
   set file_size_limit = 5 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
 where id = 'player-photos';

-- 4. Push subscriptions ----------------------------------------------------
-- The notify function POSTs to each stored endpoint, so endpoints must be
-- HTTPS (the subscribe function also allow-lists push service hosts).
alter table public.push_subscriptions
  add constraint push_subscriptions_endpoint_https check (endpoint ~ '^https://' and length(endpoint) <= 1024),
  add constraint push_subscriptions_key_lengths check (length(p256dh) <= 256 and length(auth) <= 128),
  add constraint push_subscriptions_user_agent_length check (user_agent is null or length(user_agent) <= 512);

-- 5. Rate limiting for public Edge Functions -----------------------------
create table public.rate_limit_events (
  id bigint generated always as identity primary key,
  bucket text not null,
  key_hash text not null,
  created_at timestamptz not null default now()
);
create index rate_limit_events_lookup on public.rate_limit_events (bucket, key_hash, created_at);
alter table public.rate_limit_events enable row level security;
revoke all on public.rate_limit_events from anon, authenticated;

-- Returns true and records the hit when fewer than p_max hits exist for
-- (bucket, key) in the window; false otherwise. Service role only.
create function public.rate_limit_hit(p_bucket text, p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_bucket || '|' || p_key));
  delete from rate_limit_events
   where bucket = p_bucket and created_at < now() - make_interval(secs => greatest(p_window_seconds, 3600));
  select count(*) into v_count
    from rate_limit_events
   where bucket = p_bucket and key_hash = p_key
     and created_at > now() - make_interval(secs => p_window_seconds);
  if v_count >= p_max then
    return false;
  end if;
  insert into rate_limit_events (bucket, key_hash) values (p_bucket, p_key);
  return true;
end;
$$;
revoke all on function public.rate_limit_hit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, text, integer, integer) to service_role;
