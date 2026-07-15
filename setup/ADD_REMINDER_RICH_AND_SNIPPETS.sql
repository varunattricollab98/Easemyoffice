-- ─────────────────────────────────────────────────────────────────────────
-- ADD_REMINDER_RICH_AND_SNIPPETS.sql
-- Rich HTML reminders, file attachments, and reusable email snippets.
-- Safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Reminders: store HTML body + attachments
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS is_html boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2) Reusable email snippets (shared team templates)
CREATE TABLE IF NOT EXISTS public.email_snippets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subject text DEFAULT '',
  body_html text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_snippets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS snippets_select ON public.email_snippets;
CREATE POLICY snippets_select ON public.email_snippets
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS snippets_insert ON public.email_snippets;
CREATE POLICY snippets_insert ON public.email_snippets
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS snippets_update ON public.email_snippets;
CREATE POLICY snippets_update ON public.email_snippets
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()) OR created_by = auth.uid())
  WITH CHECK (public.is_admin(auth.uid()) OR created_by = auth.uid());

DROP POLICY IF EXISTS snippets_delete ON public.email_snippets;
CREATE POLICY snippets_delete ON public.email_snippets
  FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR created_by = auth.uid());

DROP TRIGGER IF EXISTS trg_snippets_updated_at ON public.email_snippets;
CREATE TRIGGER trg_snippets_updated_at
  BEFORE UPDATE ON public.email_snippets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) Private storage bucket for reminder attachments (invoices etc.)
INSERT INTO storage.buckets (id, name, public)
VALUES ('reminder-attachments', 'reminder-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Logged-in users can upload to and read from this bucket.
DROP POLICY IF EXISTS reminder_attach_insert ON storage.objects;
CREATE POLICY reminder_attach_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'reminder-attachments');

DROP POLICY IF EXISTS reminder_attach_select ON storage.objects;
CREATE POLICY reminder_attach_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'reminder-attachments');

DROP POLICY IF EXISTS reminder_attach_delete ON storage.objects;
CREATE POLICY reminder_attach_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'reminder-attachments');
