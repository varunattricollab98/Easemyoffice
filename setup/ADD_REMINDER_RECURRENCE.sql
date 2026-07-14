-- ─────────────────────────────────────────────────────────────────────────
-- ADD_REMINDER_RECURRENCE.sql
-- Adds repeating-reminder support:
--   repeat_interval_days -> 0 = one-time; 1 = daily; 2 = alternate days; N = every N days
--   repeat_until         -> stop sending after this moment (null = one-time)
--   occurrences_sent     -> how many times this reminder has gone out
-- Safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS repeat_interval_days int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS repeat_until timestamptz,
  ADD COLUMN IF NOT EXISTS occurrences_sent int NOT NULL DEFAULT 0;
