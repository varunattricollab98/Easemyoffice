-- =============================================================================
-- ADD_TELECMI_CALLS.sql
-- TeleCMI call auto-logging. A webhook edge function (telecmi-webhook) receives
-- every call event from TeleCMI and:
--   - stores the RAW payload here (so field names can be verified from a real
--     call and nothing is ever lost),
--   - records the parsed caller/agent/status/duration,
--   - links the matched lead + agent when found.
-- Run ONCE in Supabase -> SQL Editor. Safe to re-run (IF NOT EXISTS).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.telecmi_call_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Parsed, best-effort fields (raw kept in `payload` for anything not parsed).
  direction     TEXT,                 -- 'incoming' | 'outgoing' | null
  status        TEXT,                 -- 'answered' | 'missed' | raw status text
  caller_number TEXT,                 -- the client's phone number
  agent_number  TEXT,                 -- the agent's phone (matched to profiles.phone)
  agent_name    TEXT,                 -- convenience label from the payload, if any
  duration_sec  INTEGER,              -- call duration in seconds (0 for missed)
  call_id       TEXT,                 -- TeleCMI's own call id, if provided
  call_time     TIMESTAMPTZ,          -- when the call happened (from payload if given)
  -- Resolution against the CRM.
  matched_lead_id  UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  matched_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_lead     BOOLEAN NOT NULL DEFAULT false, -- did this event create a new lead?
  note          TEXT,                 -- short human note about how it was handled
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb, -- the exact raw webhook body
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telecmi_call_events_created_idx
  ON public.telecmi_call_events(created_at DESC);
CREATE INDEX IF NOT EXISTS telecmi_call_events_caller_idx
  ON public.telecmi_call_events(caller_number);
CREATE INDEX IF NOT EXISTS telecmi_call_events_lead_idx
  ON public.telecmi_call_events(matched_lead_id);

ALTER TABLE public.telecmi_call_events ENABLE ROW LEVEL SECURITY;

-- Authenticated users can READ call events (the CRM Calls section). Writes are
-- done only by the webhook via the service-role key, which bypasses RLS, so no
-- insert policy is granted to normal users.
DROP POLICY IF EXISTS "telecmi_calls_select_auth" ON public.telecmi_call_events;
CREATE POLICY "telecmi_calls_select_auth" ON public.telecmi_call_events
  FOR SELECT TO authenticated USING (true);
