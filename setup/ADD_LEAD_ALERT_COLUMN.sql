-- ─────────────────────────────────────────────────────────────────────────
-- ADD_LEAD_ALERT_COLUMN.sql
-- Adds a nullable timestamp that the notify-new-leads edge function stamps the
-- first time it alerts about a lead, so a lead is never alerted twice.
-- Safe to run multiple times (IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS first_alert_sent_at timestamptz;

-- Speeds up the function's "recent, not-yet-alerted" lookup.
CREATE INDEX IF NOT EXISTS leads_first_alert_sent_at_idx
  ON public.leads (first_alert_sent_at);
