-- The waitlist asks which event someone wants to play (Ashish, Nov 11 2026):
-- a spot that opens is in one particular event, so the directors can offer it
-- to the people waiting for that event first. One event per person; rows from
-- before this change, and old cached forms that don't send one, stay null.
-- If the event is deleted the person stays on the waitlist without one.

alter table public.registration_waitlist
  add column if not exists category_id uuid references public.categories(id) on delete set null;

create index if not exists registration_waitlist_category
  on public.registration_waitlist (category_id);
