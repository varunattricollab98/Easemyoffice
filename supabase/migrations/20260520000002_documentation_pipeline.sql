-- Documentation pipeline: TAT, stage history, assignment notifications.
--
-- 1. documentation_tasks gains:
--      due_at            assignment time + TAT (snapshot, so changing the TAT
--                        later never rewrites the history of old tasks)
--      stage_changed_at  when the task entered its current stage
--      completed_at      when it reached 'completed' (NULL if reopened)
-- 2. documentation_stage_events: append-only history of every stage change
--    (written only by trigger), which powers "time spent per stage" analytics.
-- 3. A notification for the documentation person whenever a task is assigned
--    or re-assigned to them.
-- 4. Signed-in users may read the two documentation settings (TAT days and
--    stage alert days); before this only admins could read app_settings.
--
-- TAT is configured in app_settings key 'doc_tat_days' (JSON number, default 3,
-- calendar days). Existing rows are back-filled from created_at / updated_at.
--
-- Run 20260520000001_doc_stage_final_requested.sql first. Safe to re-run; the
-- owner applies this migration manually in the Supabase SQL editor.

-- ── 1. New columns (nullable first so they can be back-filled) ───────────────
ALTER TABLE public.documentation_tasks
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS stage_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- ── 2. Stage history ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.documentation_stage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.documentation_tasks(id) ON DELETE CASCADE,
  from_stage public.doc_task_stage,
  to_stage public.doc_task_stage NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  backfilled boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_doc_stage_events_task
  ON public.documentation_stage_events (task_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_doc_stage_events_changed_at
  ON public.documentation_stage_events (changed_at);

-- Back-fill one history per existing task: the assignment, plus a single jump
-- to its current stage at updated_at (the only timestamp we have). Runs before
-- the column back-fill below because that UPDATE must not be what updated_at
-- reflects.
WITH fresh AS (
  SELECT t.*
  FROM public.documentation_tasks t
  WHERE NOT EXISTS (
    SELECT 1 FROM public.documentation_stage_events e WHERE e.task_id = t.id
  )
)
INSERT INTO public.documentation_stage_events
  (task_id, from_stage, to_stage, changed_by, changed_at, backfilled)
-- Explicit casts: in a UNION the bare NULL / 'assigned' literals resolve to text.
SELECT id, NULL::public.doc_task_stage, 'assigned'::public.doc_task_stage, assigned_by, created_at, true FROM fresh
UNION ALL
SELECT id, 'assigned'::public.doc_task_stage, stage, NULL::uuid, updated_at, true FROM fresh
WHERE stage <> 'assigned';

-- Column back-fill without bumping updated_at.
ALTER TABLE public.documentation_tasks DISABLE TRIGGER trg_documentation_tasks_updated_at;
UPDATE public.documentation_tasks
SET
  due_at = COALESCE(due_at, created_at + interval '3 days'),
  stage_changed_at = COALESCE(stage_changed_at, updated_at),
  completed_at = CASE
    WHEN stage = 'completed' THEN COALESCE(completed_at, updated_at)
    ELSE NULL
  END
WHERE due_at IS NULL
   OR stage_changed_at IS NULL
   OR (stage = 'completed' AND completed_at IS NULL)
   OR (stage <> 'completed' AND completed_at IS NOT NULL);
ALTER TABLE public.documentation_tasks ENABLE TRIGGER trg_documentation_tasks_updated_at;

ALTER TABLE public.documentation_tasks
  ALTER COLUMN stage_changed_at SET DEFAULT now(),
  ALTER COLUMN stage_changed_at SET NOT NULL,
  ALTER COLUMN due_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documentation_tasks_due_at
  ON public.documentation_tasks (due_at) WHERE completed_at IS NULL;

-- ── 3. TAT setting reader ────────────────────────────────────────────────────
-- Returns app_settings.doc_tat_days clamped to 1..60, default 3.
CREATE OR REPLACE FUNCTION public.doc_tat_days()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT LEAST(60, GREATEST(1, COALESCE(
    (SELECT CASE WHEN value::text ~ '^[0-9]+$' THEN value::text::int END
       FROM public.app_settings WHERE key = 'doc_tat_days'),
    3
  )));
$$;

-- ── 4. Timestamps maintained on every write ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.documentation_tasks_track_stage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.due_at := COALESCE(NEW.due_at, COALESCE(NEW.created_at, now()) + make_interval(days => public.doc_tat_days()));
    NEW.stage_changed_at := now();
    NEW.completed_at := CASE WHEN NEW.stage = 'completed' THEN now() ELSE NULL END;
  ELSIF NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.stage_changed_at := now();
    NEW.completed_at := CASE
      WHEN NEW.stage = 'completed' THEN COALESCE(OLD.completed_at, now())
      ELSE NULL
    END;
  ELSE
    -- Clients cannot rewrite these by hand.
    NEW.due_at := OLD.due_at;
    NEW.stage_changed_at := OLD.stage_changed_at;
    NEW.completed_at := OLD.completed_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_documentation_tasks_track_stage ON public.documentation_tasks;
CREATE TRIGGER trg_documentation_tasks_track_stage
  BEFORE INSERT OR UPDATE ON public.documentation_tasks
  FOR EACH ROW EXECUTE FUNCTION public.documentation_tasks_track_stage();

-- ── 5. Stage history writer ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.documentation_tasks_log_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO public.documentation_stage_events (task_id, from_stage, to_stage, changed_by)
    VALUES (
      NEW.id,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.stage END,
      NEW.stage,
      COALESCE(auth.uid(), NEW.assigned_by)
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_documentation_tasks_log_stage ON public.documentation_tasks;
CREATE TRIGGER trg_documentation_tasks_log_stage
  AFTER INSERT OR UPDATE OF stage ON public.documentation_tasks
  FOR EACH ROW EXECUTE FUNCTION public.documentation_tasks_log_stage();

-- ── 6. Assignment notification ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_documentation_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b record;
BEGIN
  IF NEW.assigned_to IS NULL OR NEW.assigned_to = auth.uid() THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
    RETURN NULL;
  END IF;

  BEGIN
    SELECT client_name, business_name, external_booking_id, booking_code, plan_name, sp_name
      INTO b
      FROM public.bookings WHERE id = NEW.booking_id;

    INSERT INTO public.notifications (user_id, type, title, body)
    VALUES (
      NEW.assigned_to,
      'doc_assigned',
      'New documentation: ' || COALESCE(NULLIF(b.business_name, ''), NULLIF(b.client_name, ''), 'booking'),
      concat_ws(' · ',
        NULLIF(COALESCE(NULLIF(b.external_booking_id, ''), b.booking_code), ''),
        NULLIF(b.client_name, ''),
        NULLIF(b.plan_name, ''),
        CASE WHEN NULLIF(b.sp_name, '') IS NOT NULL THEN 'SP: ' || b.sp_name END,
        'Due ' || to_char(NEW.due_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon')
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- A notification failure must never block the assignment itself.
    RAISE WARNING 'notify_documentation_assignment failed: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_documentation_tasks_notify ON public.documentation_tasks;
CREATE TRIGGER trg_documentation_tasks_notify
  AFTER INSERT OR UPDATE OF assigned_to ON public.documentation_tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_documentation_assignment();

-- ── 7. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.documentation_stage_events ENABLE ROW LEVEL SECURITY;

-- Read: admin, or whoever the task is assigned to. No write policies: only the
-- SECURITY DEFINER trigger above writes history.
DROP POLICY IF EXISTS doc_stage_events_select ON public.documentation_stage_events;
CREATE POLICY doc_stage_events_select ON public.documentation_stage_events
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.documentation_tasks t
      WHERE t.id = documentation_stage_events.task_id AND t.assigned_to = auth.uid()
    )
  );

DROP POLICY IF EXISTS app_settings_read_doc_settings ON public.app_settings;
CREATE POLICY app_settings_read_doc_settings ON public.app_settings
  FOR SELECT TO authenticated
  USING (key IN ('doc_tat_days', 'doc_escalation_days'));
