-- Enable Supabase realtime for the dashboard tables
ALTER TABLE public.leads REPLICA IDENTITY FULL;
ALTER TABLE public.follow_ups REPLICA IDENTITY FULL;
ALTER TABLE public.lead_activities REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.leads; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.follow_ups; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_activities; EXCEPTION WHEN duplicate_object THEN NULL; END;
END$$;

-- Per-user notification preferences for follow-up reminders
CREATE TABLE IF NOT EXISTS public.notification_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  in_app_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT false,
  remind_minutes_before integer NOT NULL DEFAULT 15,
  daily_digest boolean NOT NULL DEFAULT false,
  email_address text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_prefs_select_own" ON public.notification_prefs
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notif_prefs_insert_own" ON public.notification_prefs
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "notif_prefs_update_own" ON public.notification_prefs
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "notif_prefs_delete_own" ON public.notification_prefs
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER notif_prefs_set_updated_at
  BEFORE UPDATE ON public.notification_prefs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
