-- ─────────────────────────────────────────────────────────────────────────
-- UPDATE_REMINDERS_CRON_2MIN.sql
-- Changes the process-reminders cron from every 5 minutes to every 2 minutes.
--
-- WHY: The edge function now sends only 1 email per invocation to enforce a
-- minimum 2-minute gap between consecutive emails (rate-limit protection).
-- Running every 2 min ensures the queue still drains at a reasonable pace
-- while respecting the gap. Max throughput: 30 emails/hour from cron alone,
-- well within the 50/hour hard cap enforced server-side.
--
-- BEFORE RUNNING, replace the 3 placeholders below:
--   <PROJECT_REF>  -> your Supabase project ref (the xxxx in xxxx.supabase.co)
--   <ANON_KEY>     -> your project's anon/public key (Settings -> API)
--   <CRON_SECRET>  -> the same secret word you set as the CRON_SECRET edge secret
--
-- Safe to run multiple times (unschedules the old job first).
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Remove the existing 5-minute job.
SELECT cron.unschedule('process-reminders')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-reminders');

-- 2) Schedule it every 2 minutes.
SELECT cron.schedule(
  'process-reminders',
  '*/2 * * * *',
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

-- Verify:
--   SELECT * FROM cron.job WHERE jobname = 'process-reminders';
--   → schedule should show "*/2 * * * *"
