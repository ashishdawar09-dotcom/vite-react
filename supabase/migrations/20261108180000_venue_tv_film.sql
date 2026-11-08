-- The Shuttle Storm film on the venue TV, switched on and off from the admin TV tab.
--
-- While tv_film_on is true every TV plays the film full screen on a loop
-- (before the first match, or in a break); while it's false the TVs show the
-- live boards only. It lives on the tournament row so it reaches every TV
-- through the same live_snapshot feed as tv_messages. Writes go through
-- set_tv_film, which checks the caller is an admin.

alter table public.tournaments
  add column if not exists tv_film_on boolean not null default false;

-- Public data, like the rest of the tournament row (column grants since 20261024194341).
grant select (tv_film_on) on public.tournaments to anon, authenticated;

create or replace function public.set_tv_film(p_tournament_id uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_on boolean;
begin
  if not is_admin() then
    raise exception 'forbidden';
  end if;
  update tournaments set tv_film_on = coalesce(p_on, false)
   where id = p_tournament_id
  returning tv_film_on into v_on;
  if not found then
    raise exception 'Tournament not found.';
  end if;
  return v_on;
end;
$$;

revoke all on function public.set_tv_film(uuid, boolean) from public, anon;
grant execute on function public.set_tv_film(uuid, boolean) to authenticated, service_role;
