-- ─────────────────────────────────────────────────────────────────────────
-- ADD_GMAIL_TAG_SYNC_CRON.sql
-- Runs the gmail-tag-sync edge function every 10 minutes so that EVERY Gmail
-- thread labelled "<Name> lead" becomes a lead assigned to that salesperson,
-- across the FULL mailbox — independent of who is logged in or which tab is
-- open. This replaces the old client-side, admin-only, single-inbox-page sync.
--
-- Replace placeholders before running:
--   <PROJECT_REF>  -> your Supabase project ref (e.g. cfzwdlibvxksrxcrsvpp)
--   <ANON_KEY>     -> your project's anon/public key
--   <CRON_SECRET>  -> the same secret word as the CRON_SECRET edge secret
--
-- Safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────

-- The sync surfaces owner tags it cannot match to a profile by writing an
-- email_log row with status='unmatched'. The email_log CHECK constraint (see
-- setup/ADD_EMAIL_LOG.sql) originally only allowed 'sent'/'failed', so widen it
-- to also accept 'unmatched'. Idempotent: drop-then-add.
ALTER TABLE public.email_log DROP CONSTRAINT IF EXISTS email_log_status_check;
ALTER TABLE public.email_log
  ADD CONSTRAINT email_log_status_check
  CHECK (status IN ('sent', 'failed', 'unmatched'));

-- Remove any previous copy of this job
SELECT cron.unschedule('gmail-tag-sync')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gmail-tag-sync');

-- Schedule: every 10 minutes
SELECT cron.schedule(
  'gmail-tag-sync',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/gmail-tag-sync',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer <ANON_KEY>'
               ),
    body    := jsonb_build_object('secret', '<CRON_SECRET>')
  );
  $$
);

-- Verify:
--   SELECT * FROM cron.job WHERE jobname = 'gmail-tag-sync';
--   -- unmatched owner tags surface here:
--   SELECT * FROM public.email_log WHERE source = 'gmail-tag-sync' ORDER BY sent_at DESC;
