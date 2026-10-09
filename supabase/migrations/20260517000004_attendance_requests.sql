-- HRMS: employee-initiated attendance requests.
--
-- Lets an employee ask an admin to (a) work from home for a day or range,
-- (b) clarify an absence, or (c) regularize a missed login/logout. Modeled on
-- public.leave_requests (migration 000007): the same request+decision shape
-- (status pending/approved/rejected/cancelled, decided_by/at, admin_note) and
-- the same write model — employees only ever SELECT their own rows; the
-- hr-requests edge function is the sole writer, using the service role.
--
-- Applied manually by the owner. Safe to re-run (fully idempotent).

-- ---------------------------------------------------------------------------
-- Attendance requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id        uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  type               text NOT NULL
                       CHECK (type IN ('work_from_home','absence_clarification','missed_login_regularization')),
  -- The day the request concerns. For a WFH range this mirrors from_date; a
  -- single-day request (the common case) has work_date = from_date = to_date.
  work_date          date NOT NULL,
  from_date          date NOT NULL DEFAULT CURRENT_DATE,
  to_date            date NOT NULL DEFAULT CURRENT_DATE,
  reason             text NOT NULL,
  -- Only meaningful for missed_login_regularization.
  requested_login_at  timestamptz,
  requested_logout_at timestamptz,
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at         timestamptz,
  admin_note         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (to_date >= from_date)
);

CREATE INDEX IF NOT EXISTS attendance_requests_employee_idx
  ON public.attendance_requests (employee_id, work_date);
CREATE INDEX IF NOT EXISTS attendance_requests_pending_idx
  ON public.attendance_requests (created_at) WHERE status = 'pending';

DROP TRIGGER IF EXISTS trg_attendance_requests_updated_at ON public.attendance_requests;
CREATE TRIGGER trg_attendance_requests_updated_at BEFORE UPDATE ON public.attendance_requests
  FOR EACH ROW EXECUTE FUNCTION public.hrms_touch_updated_at();

ALTER TABLE public.attendance_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_requests_select ON public.attendance_requests;
CREATE POLICY attendance_requests_select ON public.attendance_requests FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR employee_id IN (SELECT id FROM public.employees WHERE profile_id = auth.uid())
  );

-- No INSERT/UPDATE/DELETE policy on purpose: like leave_requests and attendance,
-- this table is written only by the hr-requests edge function via the service
-- role. Employees can never self-approve — a decision (status/decided_by/
-- decided_at/admin_note) is only ever set server-side after an admin check.
COMMENT ON TABLE public.attendance_requests IS
  'Employee-initiated WFH / absence-clarification / missed-login requests. Written only by the hr-requests edge function (service role); employees SELECT their own rows and can never self-approve.';
