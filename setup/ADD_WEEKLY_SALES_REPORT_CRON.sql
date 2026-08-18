-- ─────────────────────────────────────────────────────────────────────────
-- ADD_WEEKLY_SALES_REPORT_CRON.sql
-- Sends a weekly sales performance report every Monday at 9:00 AM IST
-- (3:30 AM UTC). Includes:
--   - Full team comparison table to admins with CSV attachment
--   - Individual performance summaries to each salesperson
--   - Week-over-week comparison, closing rate, top 3 / bottom 3 performers
--
-- Replace placeholders before running:
--   <PROJECT_REF>  -> your Supabase project ref
--   <ANON_KEY>     -> your project's anon/public key
--   <CRON_SECRET>  -> the same secret word as CRON_SECRET edge secret
--
-- Safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────

-- Remove any previous copy
SELECT cron.unschedule('weekly-sales-report')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-sales-report');

-- Schedule: every Monday at 3:30 AM UTC = 9:00 AM IST
SELECT cron.schedule(
  'weekly-sales-report',
  '30 3 * * 1',
  $$
  SELECT net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/weekly-sales-report',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer <ANON_KEY>'
               ),
    body    := jsonb_build_object('secret', '<CRON_SECRET>')
  );
  $$
);

-- Verify:
--   SELECT * FROM cron.job WHERE jobname = 'weekly-sales-report';
