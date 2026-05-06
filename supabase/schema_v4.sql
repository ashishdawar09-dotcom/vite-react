-- Schema v4: Add extended_minutes to matches for time-over extensions
-- Safe to run multiple times (idempotent)

ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS extended_minutes int NOT NULL DEFAULT 0;
