-- ─────────────────────────────────────────────────────────────────────────
-- ADD_LOGOUT_REMINDER_CRON.sql
-- Runs the attendance-logout-reminder edge function daily at 7:30 PM IST
-- (2:00 PM UTC). Anyone whose attendance for the day is still open gets a
-- bell notification, a desktop alert and an email telling them to press
-- LOGOUT — an open day does not count its hours, and after 16 hours it is
-- written off as a missed punch out.
--
-- Replace placeholders before running:
--   <PROJECT_REF>  -> your Supabase project ref (cfzwdlibvxksrxcrsvpp)
--   <ANON_KEY>     -> your project's anon/public key
--   <CRON_SECRET>  -> the same secret word as the CRON_SECRET edge secret
--
-- The function sends at most ONE reminder per person per day and refuses to
-- run before the working window closes, so re-running or scheduling it more
-- often cannot spam anyone.
--
-- Safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────

-- Remove any previous copy of this job
SELECT cron.unschedule('attendance-logout-reminder')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'attendance-logout-reminder');

-- Schedule: daily at 2:00 PM UTC = 7:30 PM IST
SELECT cron.schedule(
  'attendance-logout-reminder',
  '0 14 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/attendance-logout-reminder',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer <ANON_KEY>'
               ),
    body    := jsonb_build_object('secret', '<CRON_SECRET>')
  );
  $$
);

-- Verify the job exists:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'attendance-logout-reminder';

-- See who would be reminded right now (read-only, no notifications sent):
--   SELECT a.employee_id, e.first_name, a.first_login_at, a.open_since
--   FROM attendance a
--   JOIN employees e ON e.id = a.employee_id
--   WHERE a.work_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
--     AND a.open_since IS NOT NULL
--     AND a.last_logout_at IS NULL;

-- Check what the job did (after 7:30 PM IST):
--   SELECT user_id, title, created_at FROM notifications
--   WHERE type = 'hr_logout_reminder' ORDER BY created_at DESC LIMIT 20;
