-- Announcements for the venue TV, typed by an admin on the TV tab.
--
-- They live on the tournament row because live_snapshot already returns the
-- whole row (minus admin_notify_emails), so every TV gets them through the
-- same CDN-cached feed with no change to the feed. Each entry:
--   { id, text, style: 'line' | 'full', posted_at, until (null = until taken down) }
-- Writes go through post_tv_message / remove_tv_message, which check the
-- caller is an admin, validate, drop expired entries and change the list in
-- one locked step, so two admins posting at once can't overwrite each other.

alter table public.tournaments
  add column if not exists tv_messages jsonb not null default '[]'::jsonb;

alter table public.tournaments
  drop constraint if exists tournaments_tv_messages_is_array;
alter table public.tournaments
  add constraint tournaments_tv_messages_is_array check (jsonb_typeof(tv_messages) = 'array');

-- Public data, like the rest of the tournament row (column grants since 20261024194341).
grant select (tv_messages) on public.tournaments to anon, authenticated;

create or replace function public.post_tv_message(p_tournament_id uuid, p_text text, p_style text, p_minutes integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_text text := btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
  v_style text := coalesce(p_style, 'line');
  v_now timestamptz := now();
  v_cur jsonb;
  v_list jsonb;
begin
  if not is_admin() then
    raise exception 'forbidden';
  end if;
  if char_length(v_text) < 1 or char_length(v_text) > 120 then
    raise exception 'Type a message of 1 to 120 characters.';
  end if;
  if v_style not in ('line', 'full') then
    raise exception 'Choose the announcement line or full screen.';
  end if;
  if p_minutes is not null and (p_minutes < 1 or p_minutes > 1440) then
    raise exception 'Keep it up for 1 minute to 24 hours, or until you take it down.';
  end if;

  select tv_messages into v_cur from tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'Tournament not found.';
  end if;

  select coalesce(jsonb_agg(m order by ord), '[]'::jsonb) into v_list
    from jsonb_array_elements(coalesce(v_cur, '[]'::jsonb)) with ordinality as e(m, ord)
   where jsonb_typeof(m) = 'object'
     and (m->>'until' is null or (m->>'until')::timestamptz > v_now);

  if jsonb_array_length(v_list) >= 10 then
    raise exception 'Up to 10 announcements at a time. Take one down first.';
  end if;

  v_list := jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid()::text,
    'text', v_text,
    'style', v_style,
    'posted_at', v_now,
    'until', case when p_minutes is null then null else v_now + make_interval(mins => p_minutes) end
  )) || v_list;

  update tournaments set tv_messages = v_list where id = p_tournament_id;
  return v_list;
end;
$$;

create or replace function public.remove_tv_message(p_tournament_id uuid, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_cur jsonb;
  v_list jsonb;
begin
  if not is_admin() then
    raise exception 'forbidden';
  end if;

  select tv_messages into v_cur from tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'Tournament not found.';
  end if;

  select coalesce(jsonb_agg(m order by ord), '[]'::jsonb) into v_list
    from jsonb_array_elements(coalesce(v_cur, '[]'::jsonb)) with ordinality as e(m, ord)
   where jsonb_typeof(m) = 'object'
     and m->>'id' is distinct from p_id
     and (m->>'until' is null or (m->>'until')::timestamptz > v_now);

  update tournaments set tv_messages = v_list where id = p_tournament_id;
  return v_list;
end;
$$;

revoke all on function public.post_tv_message(uuid, text, text, integer) from public, anon;
revoke all on function public.remove_tv_message(uuid, text) from public, anon;
grant execute on function public.post_tv_message(uuid, text, text, integer) to authenticated, service_role;
grant execute on function public.remove_tv_message(uuid, text) to authenticated, service_role;
