
-- User-level theme/appearance preferences (synced across devices)
CREATE TABLE public.user_theme_prefs (
  user_id uuid PRIMARY KEY,
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_theme_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_theme_prefs_select_own ON public.user_theme_prefs
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY user_theme_prefs_upsert_own ON public.user_theme_prefs
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY user_theme_prefs_update_own ON public.user_theme_prefs
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY user_theme_prefs_delete_own ON public.user_theme_prefs
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Allow any authenticated user to read the org-wide default theme.
-- (app_settings already restricts admin-only writes via existing policies.)
CREATE POLICY app_settings_read_org_theme ON public.app_settings
  FOR SELECT TO authenticated USING (key = 'org.theme_default');
