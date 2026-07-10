-- Report subscriptions for scheduled email delivery
CREATE TABLE public.report_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  reports TEXT[] NOT NULL DEFAULT ARRAY['overdue','pipeline','productivity']::TEXT[],
  frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily','weekly')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.report_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subs_admin_all" ON public.report_subscriptions
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER subs_updated_at
  BEFORE UPDATE ON public.report_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_report_subs_enabled ON public.report_subscriptions(enabled, frequency);