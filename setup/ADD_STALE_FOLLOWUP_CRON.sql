-- ─────────────────────────────────────────────────────────────────────────
-- ADD_STALE_FOLLOWUP_CRON.sql
-- Runs the notify-stale-followups edge function daily at 9:00 AM IST
-- (3:30 AM UTC) to remind salespeople about leads stuck in follow-up.
--
-- Replace placeholders before running:
--   <PROJECT_REF>  -> your Supabase project ref
--   <ANON_KEY>     -> your project's anon/public key
--   <CRON_SECRET>  -> the same secret word as CRON_SECRET edge secret
--
-- Safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────

-- Remove any previous copy of this job
SELECT cron.unschedule('notify-stale-followups')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-stale-followups');

-- Schedule: daily at 3:30 AM UTC = 9:00 AM IST
SELECT cron.schedule(
  'notify-stale-followups',
  '30 3 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-stale-followups',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer <ANON_KEY>'
               ),
    body    := jsonb_build_object('secret', '<CRON_SECRET>')
  );
  $$
);

-- Verify:
--   SELECT * FROM cron.job WHERE jobname = 'notify-stale-followups';
