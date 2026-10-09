-- HRMS: mark how an attendance row was created, so admin-entered days (single
-- entry or bulk back-fill) are distinguishable from real punches.
--
-- OWNER MUST APPLY THIS MANUALLY. Like every migration in this repo it is NOT
-- run by CI/CD. The app degrades gracefully if it is not applied yet: the
-- column is nullable and nothing in the punch, regularization, leave or month
-- views depends on it. The admin entry flow simply omits entry_source when the
-- column is absent, so the feature keeps working either way.
--
-- Idempotent (IF NOT EXISTS / DROP IF EXISTS); safe to re-run. Does NOT touch
-- the status CHECK — admin-entered days are still scored into one of the
-- existing statuses ('in_progress','present','short','half_day').

ALTER TABLE public.attendance
  -- NULL for every existing row and for the punch flow (which never sets it);
  -- admin writes tag the row so the source stays auditable.
  ADD COLUMN IF NOT EXISTS entry_source text;

ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_entry_source_check;
ALTER TABLE public.attendance ADD CONSTRAINT attendance_entry_source_check
  CHECK (
    entry_source IS NULL
    OR entry_source IN ('punch','admin_manual','admin_bulk','regularization','remote')
  );
