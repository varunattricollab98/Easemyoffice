-- ─────────────────────────────────────────────────────────────────────────
-- ADD_CRM_SETTINGS.sql
-- Simple key-value settings table for admin-configurable CRM options
-- (email automation config, etc.). Safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.crm_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_settings ENABLE ROW LEVEL SECURITY;

-- Everyone can read settings; only admin can write.
DROP POLICY IF EXISTS settings_select ON public.crm_settings;
CREATE POLICY settings_select ON public.crm_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS settings_write ON public.crm_settings;
CREATE POLICY settings_write ON public.crm_settings
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
