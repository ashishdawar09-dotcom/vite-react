-- v2: add rounds_per_pair and match.status
-- Run after schema.sql

alter table public.tournaments
  add column if not exists rounds_per_pair int not null default 1
  check (rounds_per_pair between 1 and 3);

alter table public.matches
  add column if not exists status text not null default 'pending'
  check (status in ('pending','live','completed'));

alter table public.matches
  add column if not exists started_at timestamptz;

-- Backfill: confirmed matches are completed
update public.matches set status = 'completed' where confirmed = true and status <> 'completed';
