-- =============================================================================
-- Add two new pipeline stages to the lead_stage type:
--   * "followups"       (shown as "Followups")      -> placed after Negotiation
--   * "not_interested"  (shown as "Not interested") -> placed just before Lost
--
-- The visible order in the app is controlled by the STAGES list in the code;
-- the BEFORE/AFTER below just keeps the database's internal order tidy too.
--
-- Run ONCE in Supabase -> SQL Editor. Safe to re-run (uses IF NOT EXISTS).
-- If you get an error about "transaction block", run each ALTER line on its own
-- (select one line and click RUN, then the other).
-- =============================================================================
ALTER TYPE public.lead_stage ADD VALUE IF NOT EXISTS 'followups' AFTER 'negotiation';
ALTER TYPE public.lead_stage ADD VALUE IF NOT EXISTS 'not_interested' BEFORE 'lost';
