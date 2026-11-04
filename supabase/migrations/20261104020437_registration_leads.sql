-- People who start the public registration form (type their name and email)
-- but never submit it. The form saves them as they type (save-registration-lead
-- Edge Function), so a director can send one reminder to finish.

create table public.registration_leads (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  email text not null,
  name text not null,
  phone text,
  category_id uuid references public.categories(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set once the reminder goes out, so nobody is reminded twice.
  reminded_at timestamptz,
  reminder_status text
);

-- One row per address per tournament; typing again updates it.
create unique index registration_leads_tournament_email
  on public.registration_leads (tournament_id, lower(email));

alter table public.registration_leads enable row level security;
create policy "admin read registration leads" on public.registration_leads
  as permissive for select to authenticated using ((select is_admin()));

-- Written only by the Edge Function (service role); admins read it.
revoke all on public.registration_leads from anon, authenticated;
grant select on public.registration_leads to authenticated;
grant all on public.registration_leads to service_role;
