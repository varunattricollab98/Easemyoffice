-- TeleCMI call auto-logging: stores raw webhook payloads + parsed call fields,
-- links matched lead + agent. Writes come from the telecmi-webhook edge
-- function via the service role; authenticated users may read.
CREATE TABLE IF NOT EXISTS public.telecmi_call_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction     TEXT,
  status        TEXT,
  caller_number TEXT,
  agent_number  TEXT,
  agent_name    TEXT,
  duration_sec  INTEGER,
  call_id       TEXT,
  call_time     TIMESTAMPTZ,
  matched_lead_id  UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  matched_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_lead     BOOLEAN NOT NULL DEFAULT false,
  note          TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telecmi_call_events_created_idx
  ON public.telecmi_call_events(created_at DESC);
CREATE INDEX IF NOT EXISTS telecmi_call_events_caller_idx
  ON public.telecmi_call_events(caller_number);
CREATE INDEX IF NOT EXISTS telecmi_call_events_lead_idx
  ON public.telecmi_call_events(matched_lead_id);

ALTER TABLE public.telecmi_call_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "telecmi_calls_select_auth" ON public.telecmi_call_events;
CREATE POLICY "telecmi_calls_select_auth" ON public.telecmi_call_events
  FOR SELECT TO authenticated USING (true);
