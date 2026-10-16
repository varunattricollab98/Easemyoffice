-- Free-text remark per attendance day (admin note or imported sheet remark,
-- e.g. "Will be late", "Logout not recorded in sheet"). Shown in the Daily log.
-- Safe to re-run.
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS remarks text;
