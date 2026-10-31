-- Emailed invitations to opt in to WhatsApp updates, for people who entered
-- before the opt-in button existed (whatsapp-invite, _shared/whatsapp_invites.ts).

-- 1. When the tournament's WhatsApp switch was turned on: entries after that
-- saw the button on their confirmation screen and aren't invited again.
alter table public.tournaments add column whatsapp_enabled_at timestamptz;

create function public.stamp_whatsapp_enabled()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.whatsapp_enabled and (tg_op = 'INSERT' or old.whatsapp_enabled is distinct from true) then
    new.whatsapp_enabled_at := now();
  end if;
  return new;
end;
$$;

create trigger tournaments_whatsapp_enabled_at
  before insert or update of whatsapp_enabled on public.tournaments
  for each row execute function public.stamp_whatsapp_enabled();

-- Shuttle Storm was switched on (with the button live) at about 08:12 UTC
-- on 2026-10-29, before this column existed. No entries came in between
-- 03:22 and then, so the exact minute doesn't change who's invited.
update public.tournaments set whatsapp_enabled_at = '2026-10-29 08:12:00+00'
  where slug = 'shuttle-storm' and whatsapp_enabled and whatsapp_enabled_at is null;

-- 2. One row per person invited, so a send never emails anyone twice and a
-- failed send can be retried.
create table public.whatsapp_invites (
  id bigint generated always as identity primary key,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  registration_id uuid not null references public.pending_registrations(id) on delete cascade,
  role text not null check (role = any (array['player', 'partner'])),
  email text not null,
  person_name text not null,
  -- Who it is, as pickInvitees matches people: address and first name.
  person_key text not null,
  status text not null check (status = any (array['sending', 'sent', 'failed'])),
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (tournament_id, person_key)
);

alter table public.whatsapp_invites enable row level security;
create policy "admin read whatsapp invites" on public.whatsapp_invites
  as permissive for select to authenticated using ((select is_admin()));

-- Written only by the Edge Function (service role); admins read it.
revoke all on public.whatsapp_invites from anon, authenticated;
grant select on public.whatsapp_invites to authenticated;
grant all on public.whatsapp_invites to service_role;
