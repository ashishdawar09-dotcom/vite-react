-- Doubles partners can opt in to WhatsApp updates too.
--
-- A registrant's code is the first 8 characters of their registration id.
-- A partner's code is the LAST 8 characters of the same id, so nothing new
-- is stored and the code can go straight into the partner's emails.
--
-- resolve_whatsapp_code() knows both and says whose code it is; the new
-- whatsapp-inbound uses it. registration_for_whatsapp_code() (registrants
-- only) stays so the deployed function keeps working until the new one is
-- live; a later migration can drop it.

create function public.resolve_whatsapp_code(p_code text)
returns table (registration_id uuid, tournament_id uuid, role text, person_name text)
language sql
stable
security definer
set search_path = ''
as $$
  with matches as (
    select r.id, r.tournament_id, 'player'::text as role, r.player_name as person_name
    from public.pending_registrations r
    where split_part(r.id::text, '-', 1) = lower(p_code)
      and r.status not in ('rejected', 'payment_expired')
    union all
    select r.id, r.tournament_id, 'partner'::text, r.partner_name
    from public.pending_registrations r
    where right(r.id::text, 8) = lower(p_code)
      and nullif(btrim(r.partner_name), '') is not null
      and r.status not in ('rejected', 'payment_expired')
  )
  -- Nothing when no live entry matches, or (vanishingly unlikely) when one
  -- code fits more than one person.
  select m.id, m.tournament_id, m.role, m.person_name
  from matches m
  where p_code ~* '^[0-9a-f]{8}$'
    and (select count(*) from matches) = 1;
$$;

revoke all on function public.resolve_whatsapp_code(text) from public, anon, authenticated;
grant execute on function public.resolve_whatsapp_code(text) to service_role;
