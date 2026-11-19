-- Winners photos (Nov 2026).
--
-- After a final, a desk volunteer takes one photo of the event's winners
-- (with their prizes) and uploads it from the volunteer desk's Winners tab.
-- The live app shows it under that event's champion card, and the Shuttle
-- Storm website shows it on its champions section.
--
-- One row per event. Anyone may read it (it is shown publicly); only the
-- volunteer-desk Edge Function writes it. Nothing existing changes except
-- the desk's own log table, which learns two more kinds of action.

create table if not exists public.category_winner_photos (
  category_id uuid primary key references public.categories(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  photo_url text not null,
  uploaded_by text not null,
  consent_text text,
  updated_at timestamptz not null default now()
);

create index if not exists category_winner_photos_tournament_idx on public.category_winner_photos (tournament_id);

alter table public.category_winner_photos enable row level security;
revoke all on table public.category_winner_photos from public, anon, authenticated;
grant select on table public.category_winner_photos to anon, authenticated;
grant select, insert, update, delete on table public.category_winner_photos to service_role;

drop policy if exists "read winner photos" on public.category_winner_photos;
create policy "read winner photos" on public.category_winner_photos for select to public using (true);

comment on table public.category_winner_photos is
  'One winners photo per event, uploaded from the volunteer desk. Public read; written by the volunteer-desk function only.';

-- The desk log also records winners photos, against the event.
alter table public.desk_actions
  add column if not exists category_id uuid references public.categories(id) on delete set null;

alter table public.desk_actions drop constraint if exists desk_actions_action_check;
alter table public.desk_actions
  add constraint desk_actions_action_check
  check (action in ('check_in', 'undo_check_in', 'photo', 'undo_photo', 'winner_photo', 'remove_winner_photo'));
