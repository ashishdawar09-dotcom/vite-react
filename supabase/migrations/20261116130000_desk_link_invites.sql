-- Volunteer desk: invites by email (Nov 2026).
--
-- An organizer makes a volunteer's link from the desk site's organizer screen
-- (volunteer-desk-admin Edge Function), which emails it to the volunteer.
-- So a link now remembers who it was sent to, when, and by which organizer.
--
-- Only the two desk tables change; nothing the app reads is touched.

alter table public.desk_links
  add column if not exists email text
    check (email is null or (length(email) <= 254 and email = lower(email) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  add column if not exists emailed_at timestamptz,
  add column if not exists created_by text;

-- One link per volunteer email in a tournament: "Send again" replaces it.
create unique index if not exists desk_links_one_per_email
  on public.desk_links (tournament_id, email) where email is not null;

comment on column public.desk_links.email is 'Where the link was emailed. Null for a link made by hand.';
comment on column public.desk_links.created_by is 'The organizer (email) who made the link.';
