-- ─────────────────────────────────────────────────────────────────────────
-- ADD_NEW_LEAD_ALERT_CRON.sql
-- Runs the notify-new-leads edge function every 15 minutes so a freshly-
-- created lead reaches its owner (or the leads admin, if unassigned) within
-- minutes instead of whenever someone next opens the CRM.
--
-- PREREQUISITE: run setup/ADD_LEAD_ALERT_COLUMN.sql first (adds the
-- first_alert_sent_at column the function stamps).
--
-- Replace placeholders before running:
--   <PROJECT_REF>  -> your Supabase project ref (cfzwdlibvxksrxcrsvpp)
--   <ANON_KEY>     -> your project's anon/public key
--   <CRON_SECRET>  -> the same secret word as the CRON_SECRET edge secret
--
-- Also set the (optional) edge secrets:
--   LEADS_ADMIN_EMAIL -> where the unassigned-leads summary is sent
--   CRM_APP_URL       -> base URL so alert emails include deep links
--
-- Safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────

-- Remove any previous copy of this job
SELECT cron.unschedule('notify-new-leads')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-new-leads');

-- Schedule: every 15 minutes
SELECT cron.schedule(
  'notify-new-leads',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-new-leads',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer <ANON_KEY>'
               ),
    body    := jsonb_build_object('secret', '<CRON_SECRET>')
  );
  $$
);

-- Verify:
--   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'notify-new-leads';
