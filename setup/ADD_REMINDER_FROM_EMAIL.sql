-- Adds a per-reminder "from" address so renewal-team reminders can send
-- from renewals@easemyoffice.in instead of the default contact@ mailbox.
-- Run this once in Supabase → SQL Editor.

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS from_email text;

COMMENT ON COLUMN public.reminders.from_email IS
  'Optional override for the sender address (e.g. "EaseMyOffice Renewals <renewals@easemyoffice.in>"). NULL falls back to the default CRM_FROM_EMAIL.';
