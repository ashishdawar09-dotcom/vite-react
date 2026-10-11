-- Waiver consent and per-player fee concessions for public registration.
--
-- Tournaments can now carry a waiver (shown in full on the registration form,
-- versioned so each consent records exactly which text was accepted), links to
-- their rules and waiver pages, and reduced per-player fees for youth and
-- students. Every registration records the player's age and fee type, and each
-- participant's acceptance is kept in waiver_consents. Doubles partners accept
-- through an emailed link (partner_consent_token).

alter table public.tournaments
  add column if not exists rules_url text,
  add column if not exists waiver_url text,
  add column if not exists waiver_text text,
  add column if not exists waiver_version text,
  -- Per-player fee for anyone under 18 on the event date, applied when lower
  -- than the category price.
  add column if not exists youth_price numeric(10, 2) check (youth_price is null or youth_price >= 0),
  -- Per-player fee for students (label says which, e.g. "UFV student"),
  -- applied when lower than the category price. Checked at check-in.
  add column if not exists student_price numeric(10, 2) check (student_price is null or student_price >= 0),
  add column if not exists student_label text;

alter table public.pending_registrations
  add column if not exists player_age smallint check (player_age is null or player_age between 4 and 110),
  add column if not exists partner_age smallint check (partner_age is null or partner_age between 4 and 110),
  add column if not exists player_fee_type text check (player_fee_type is null or player_fee_type in ('standard', 'youth', 'student')),
  add column if not exists partner_fee_type text check (partner_fee_type is null or partner_fee_type in ('standard', 'youth', 'student')),
  add column if not exists partner_consent_token uuid unique;

create table if not exists public.waiver_consents (
  id uuid primary key default gen_random_uuid(),
  -- Kept if the registration is later deleted: the consent is the record.
  registration_id uuid references public.pending_registrations (id) on delete set null,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  role text not null check (role in ('player', 'partner')),
  participant_name text not null,
  participant_email text,
  participant_age smallint not null check (participant_age between 4 and 110),
  -- British Columbia's age of majority is 19: younger participants need a
  -- parent or guardian to accept for them.
  guardian_name text,
  -- Full name typed by the person accepting (the guardian, for a minor).
  signature text not null,
  accepted_rules boolean not null check (accepted_rules),
  accepted_waiver boolean not null check (accepted_waiver),
  accepted_codes_of_conduct boolean not null check (accepted_codes_of_conduct),
  waiver_version text not null,
  waiver_sha256 text not null,
  ip_address text,
  user_agent text,
  accepted_at timestamptz not null default now(),
  check (participant_age >= 19 or guardian_name is not null)
);

create unique index if not exists waiver_consents_registration_role
  on public.waiver_consents (registration_id, role)
  where registration_id is not null;
create index if not exists waiver_consents_tournament_email
  on public.waiver_consents (tournament_id, lower(participant_email));

-- Written only by Edge Functions (service role); readable by admins.
alter table public.waiver_consents enable row level security;
revoke all on public.waiver_consents from anon, authenticated;
grant select on public.waiver_consents to authenticated;
create policy "admin read waiver_consents" on public.waiver_consents
  for select to authenticated using ((select public.is_admin()));
