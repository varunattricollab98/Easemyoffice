-- ─────────────────────────────────────────────────────────────────────────
-- ADD_DAILY_SALES_REPORT_CRON.sql
-- Sends a daily sales performance report to all admin users at 9:15 AM IST
-- (3:45 AM UTC). Summarizes each salesperson's previous day activity:
-- calls, emails, WhatsApp, stage moves, follow-ups, leads, bookings.
--
-- Replace placeholders before running:
--   <PROJECT_REF>  -> your Supabase project ref
--   <ANON_KEY>     -> your project's anon/public key
--   <CRON_SECRET>  -> the same secret word as CRON_SECRET edge secret
--
-- Safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────

-- Remove any previous copy
SELECT cron.unschedule('daily-sales-report')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-sales-report');

-- Schedule: daily at 3:45 AM UTC = 9:15 AM IST
SELECT cron.schedule(
  'daily-sales-report',
  '45 3 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/daily-sales-report',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer <ANON_KEY>'
               ),
    body    := jsonb_build_object('secret', '<CRON_SECRET>')
  );
  $$
);

-- Verify:
--   SELECT * FROM cron.job WHERE jobname = 'daily-sales-report';
