-- ─────────────────────────────────────────────────────────────────────────
-- SCHEDULE_REMINDERS_CRON.sql
-- Runs the process-reminders edge function every 5 minutes so scheduled
-- reminders go out automatically.
--
-- BEFORE RUNNING, replace the 3 placeholders below:
--   <PROJECT_REF>  -> your Supabase project ref (the xxxx in xxxx.supabase.co)
--   <ANON_KEY>     -> your project's anon/public key (Settings -> API)
--   <CRON_SECRET>  -> the same secret word you set as the CRON_SECRET edge secret
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Enable the scheduler + HTTP extensions (one-time). If these error with a
--    permissions message, enable "pg_cron" and "pg_net" from
--    Supabase Dashboard -> Database -> Extensions, then run the rest.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2) Remove any previous copy of this job (so re-running is safe).
SELECT cron.unschedule('process-reminders')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-reminders');

-- 3) Schedule it every 5 minutes.
SELECT cron.schedule(
  'process-reminders',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/process-reminders',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer <ANON_KEY>'
               ),
    body    := jsonb_build_object('secret', '<CRON_SECRET>')
  );
  $$
);

-- Handy checks:
--   SELECT * FROM cron.job;                         -- see the scheduled job
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;  -- run history
