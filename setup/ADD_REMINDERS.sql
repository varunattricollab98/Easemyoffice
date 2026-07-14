-- ─────────────────────────────────────────────────────────────────────────
-- ADD_REMINDERS.sql
-- Scheduled client email reminders. A background job (process-reminders edge
-- function, triggered by pg_cron) sends any reminder whose send_at has passed.
-- Safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name text DEFAULT '',
  to_email text NOT NULL,
  subject text NOT NULL,
  message text NOT NULL,
  send_at timestamptz NOT NULL,
  -- scheduled | sent | cancelled | failed
  status text NOT NULL DEFAULT 'scheduled',
  sent_at timestamptz,
  error text,
  -- optional context links
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  -- ownership
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reminders_due ON public.reminders(status, send_at);
CREATE INDEX IF NOT EXISTS idx_reminders_created_by ON public.reminders(created_by);

-- keep updated_at fresh (function already exists in the base schema)
DROP TRIGGER IF EXISTS trg_reminders_updated_at ON public.reminders;
CREATE TRIGGER trg_reminders_updated_at
BEFORE UPDATE ON public.reminders
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

-- Read: admin sees all; everyone else sees the ones they created / are assigned.
DROP POLICY IF EXISTS reminders_select ON public.reminders;
CREATE POLICY reminders_select ON public.reminders
FOR SELECT TO authenticated
USING (
  public.is_admin(auth.uid())
  OR created_by = auth.uid()
  OR assigned_to = auth.uid()
);

-- Insert: any authenticated user, as themselves.
DROP POLICY IF EXISTS reminders_insert ON public.reminders;
CREATE POLICY reminders_insert ON public.reminders
FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid());

-- Update (e.g. cancel / edit): admin or the creator.
DROP POLICY IF EXISTS reminders_update ON public.reminders;
CREATE POLICY reminders_update ON public.reminders
FOR UPDATE TO authenticated
USING (public.is_admin(auth.uid()) OR created_by = auth.uid())
WITH CHECK (public.is_admin(auth.uid()) OR created_by = auth.uid());

-- Delete: admin or the creator.
DROP POLICY IF EXISTS reminders_delete ON public.reminders;
CREATE POLICY reminders_delete ON public.reminders
FOR DELETE TO authenticated
USING (public.is_admin(auth.uid()) OR created_by = auth.uid());
