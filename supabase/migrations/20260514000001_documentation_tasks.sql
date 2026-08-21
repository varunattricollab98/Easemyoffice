-- Create doc_task_stage enum
CREATE TYPE public.doc_task_stage AS ENUM (
  'assigned',
  'docs_requested',
  'docs_received',
  'draft_shared',
  'draft_approved',
  'agreement_shared',
  'countersigned',
  'part_b_shared',
  'completed'
);

-- Create documentation_tasks table
CREATE TABLE IF NOT EXISTS public.documentation_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  assigned_to uuid NOT NULL REFERENCES auth.users(id),
  assigned_by uuid REFERENCES auth.users(id),
  stage public.doc_task_stage NOT NULL DEFAULT 'assigned',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_documentation_tasks_booking_id ON public.documentation_tasks(booking_id);
CREATE INDEX IF NOT EXISTS idx_documentation_tasks_assigned_to ON public.documentation_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_documentation_tasks_stage ON public.documentation_tasks(stage);
CREATE UNIQUE INDEX IF NOT EXISTS idx_documentation_tasks_booking_unique ON public.documentation_tasks(booking_id);

-- updated_at trigger
CREATE TRIGGER trg_documentation_tasks_updated_at
BEFORE UPDATE ON public.documentation_tasks
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Enable RLS
ALTER TABLE public.documentation_tasks ENABLE ROW LEVEL SECURITY;

-- SELECT: admin sees all, assigned_to sees own
CREATE POLICY documentation_tasks_select ON public.documentation_tasks
FOR SELECT TO authenticated
USING (
  public.is_admin(auth.uid())
  OR assigned_to = auth.uid()
);

-- INSERT: admin, sales, or bd can assign
CREATE POLICY documentation_tasks_insert ON public.documentation_tasks
FOR INSERT TO authenticated
WITH CHECK (
  public.is_admin(auth.uid())
  OR public.has_role(auth.uid(), 'sales')
  OR public.has_role(auth.uid(), 'bd')
);

-- UPDATE: admin or assigned person can update (stage changes)
CREATE POLICY documentation_tasks_update ON public.documentation_tasks
FOR UPDATE TO authenticated
USING (
  public.is_admin(auth.uid())
  OR assigned_to = auth.uid()
)
WITH CHECK (
  public.is_admin(auth.uid())
  OR assigned_to = auth.uid()
);

-- DELETE: admin only
CREATE POLICY documentation_tasks_delete ON public.documentation_tasks
FOR DELETE TO authenticated
USING (public.is_admin(auth.uid()));
