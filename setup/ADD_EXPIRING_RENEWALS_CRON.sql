-- ─────────────────────────────────────────────────────────────────────────
-- ADD_EXPIRING_RENEWALS_CRON.sql
-- Runs the notify-expiring-renewals edge function daily at 9:30 AM IST
-- (4:00 AM UTC) to remind the renewals team about client plans expiring in
-- the next 30 days.
--
-- Replace placeholders before running:
--   <PROJECT_REF>  -> your Supabase project ref (cfzwdlibvxksrxcrsvpp)
--   <ANON_KEY>     -> your project's anon/public key
--   <CRON_SECRET>  -> the same secret word as the CRON_SECRET edge secret
--
-- Also set the (optional) edge secret RENEWALS_ADMIN_EMAIL so that plans with
-- no renewal owner get summarised to someone; without it, unassigned expiring
-- plans are skipped.
--
-- Safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────

-- Remove any previous copy of this job
SELECT cron.unschedule('notify-expiring-renewals')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-expiring-renewals');

-- Schedule: daily at 4:00 AM UTC = 9:30 AM IST
SELECT cron.schedule(
  'notify-expiring-renewals',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-expiring-renewals',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer <ANON_KEY>'
               ),
    body    := jsonb_build_object('secret', '<CRON_SECRET>')
  );
  $$
);

-- Verify:
--   SELECT * FROM cron.job WHERE jobname = 'notify-expiring-renewals';
