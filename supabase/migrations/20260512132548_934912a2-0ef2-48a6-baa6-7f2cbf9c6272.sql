-- KPI tile click events: server-side store so the admin report can aggregate
-- across all devices/users.
CREATE TABLE IF NOT EXISTS public.kpi_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  team TEXT,
  kpi_id TEXT NOT NULL,
  label TEXT,
  path TEXT,
  search JSONB NOT NULL DEFAULT '{}'::jsonb,
  value NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kpi_events_created_idx ON public.kpi_events (created_at DESC);
CREATE INDEX IF NOT EXISTS kpi_events_kpi_idx ON public.kpi_events (kpi_id);
CREATE INDEX IF NOT EXISTS kpi_events_user_idx ON public.kpi_events (user_id);
CREATE INDEX IF NOT EXISTS kpi_events_team_idx ON public.kpi_events (team);

ALTER TABLE public.kpi_events ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can record their own KPI clicks.
CREATE POLICY "kpi_events_insert_own"
  ON public.kpi_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Only admins can read aggregated KPI usage.
CREATE POLICY "kpi_events_admin_select"
  ON public.kpi_events FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- Only admins can purge events (e.g. clear button).
CREATE POLICY "kpi_events_admin_delete"
  ON public.kpi_events FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));