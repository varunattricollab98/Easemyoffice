-- HRMS: flexible schedules, work-from-home approval, flexible leave and CRM
-- idle tracking. Builds on Phase 1 (000005) and Phase 2 attendance (000006).
--
-- Policy encoded by default (owner, Sep 2026):
--   Mon–Fri  flexible — 9 hours anywhere between 09:00 and 19:30
--   Saturday fixed    — 10:00 to 17:00, mandatory
--   Sunday   off
--   Leave    2 per month; up to 1 unused carries into the next month
--   Idle     60 minutes without any CRM activity while logged in is recorded
--
-- Write model is unchanged: employees only ever SELECT their own rows. Punches,
-- leave requests and approvals go through edge functions (service role); the
-- idle heartbeat goes through a SECURITY DEFINER function that trusts nothing
-- from the caller except who they are. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
ALTER TABLE public.hr_settings
  -- Index = weekday (0 = Sunday). Each entry: {mode, start, end, required_minutes}
  -- where mode is off | flexible | fixed. Replaces work_start / required_minutes
  -- / week_offs, which stay only for backwards compatibility.
  ADD COLUMN IF NOT EXISTS day_schedules jsonb NOT NULL DEFAULT '[
    {"mode":"off","start":"10:00","end":"17:00","required_minutes":0},
    {"mode":"flexible","start":"09:00","end":"19:30","required_minutes":540},
    {"mode":"flexible","start":"09:00","end":"19:30","required_minutes":540},
    {"mode":"flexible","start":"09:00","end":"19:30","required_minutes":540},
    {"mode":"flexible","start":"09:00","end":"19:30","required_minutes":540},
    {"mode":"flexible","start":"09:00","end":"19:30","required_minutes":540},
    {"mode":"fixed","start":"10:00","end":"17:00","required_minutes":420}
  ]'::jsonb,
  ADD COLUMN IF NOT EXISTS idle_threshold_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS monthly_leave_quota numeric(4,1) NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS leave_carry_cap numeric(4,1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS leave_policy_start date NOT NULL DEFAULT '2026-10-01',
  ADD COLUMN IF NOT EXISTS allow_remote_requests boolean NOT NULL DEFAULT true;

-- Saturday is now a working day; keep the legacy column consistent.
UPDATE public.hr_settings SET week_offs = '{0}' WHERE id;

-- ---------------------------------------------------------------------------
-- Attendance: schedule snapshot, in-window minutes, WFH, idle
-- ---------------------------------------------------------------------------
ALTER TABLE public.attendance
  -- The day's rule is copied onto the row at first login, so changing the
  -- settings later never rewrites history.
  ADD COLUMN IF NOT EXISTS schedule_mode     text,
  ADD COLUMN IF NOT EXISTS window_start      time,
  ADD COLUMN IF NOT EXISTS window_end        time,
  ADD COLUMN IF NOT EXISTS required_minutes  integer,
  -- Minutes inside the window — what counts toward the requirement.
  ADD COLUMN IF NOT EXISTS window_minutes    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS work_mode         text NOT NULL DEFAULT 'office',
  ADD COLUMN IF NOT EXISTS remote_status     text,
  ADD COLUMN IF NOT EXISTS remote_reason     text,
  ADD COLUMN IF NOT EXISTS remote_decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS remote_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS remote_note       text,
  ADD COLUMN IF NOT EXISTS idle_minutes      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_activity_at  timestamptz;

ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_status_check;
ALTER TABLE public.attendance ADD CONSTRAINT attendance_status_check
  CHECK (status IN ('in_progress','present','short','half_day'));
ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_work_mode_check;
ALTER TABLE public.attendance ADD CONSTRAINT attendance_work_mode_check
  CHECK (work_mode IN ('office','remote'));
ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_remote_status_check;
ALTER TABLE public.attendance ADD CONSTRAINT attendance_remote_status_check
  CHECK (remote_status IS NULL OR remote_status IN ('pending','approved','rejected'));

CREATE INDEX IF NOT EXISTS attendance_remote_pending_idx
  ON public.attendance (work_date) WHERE remote_status = 'pending';

-- ---------------------------------------------------------------------------
-- Idle periods: stretches of >= idle_threshold_minutes with no CRM activity
-- while logged in.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_idle_periods (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id uuid NOT NULL REFERENCES public.attendance(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  started_at    timestamptz NOT NULL,
  ended_at      timestamptz NOT NULL,
  minutes       integer NOT NULL,
  -- 'activity' = ended by using the CRM again, 'logout' = ended at logout.
  ended_by      text NOT NULL DEFAULT 'activity' CHECK (ended_by IN ('activity','logout')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_idle_attendance_idx ON public.attendance_idle_periods (attendance_id);
CREATE INDEX IF NOT EXISTS attendance_idle_employee_idx ON public.attendance_idle_periods (employee_id, started_at DESC);

ALTER TABLE public.attendance_idle_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_idle_select ON public.attendance_idle_periods;
CREATE POLICY attendance_idle_select ON public.attendance_idle_periods FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR employee_id IN (SELECT id FROM public.employees WHERE profile_id = auth.uid())
  );

-- Called by the browser every few minutes while the user is actively using the
-- CRM. Uses the server clock and the caller's identity only. If the gap since
-- the previous activity reaches the threshold, that gap is recorded as idle.
CREATE OR REPLACE FUNCTION public.attendance_heartbeat()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid;
  v_row public.attendance%ROWTYPE;
  v_threshold integer;
  v_last timestamptz;
  v_gap integer;
BEGIN
  SELECT id INTO v_emp FROM public.employees WHERE profile_id = auth.uid();
  IF v_emp IS NULL THEN
    RETURN jsonb_build_object('tracking', false);
  END IF;

  SELECT * INTO v_row FROM public.attendance
   WHERE employee_id = v_emp AND open_since IS NOT NULL
   ORDER BY work_date DESC LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('tracking', false);
  END IF;

  SELECT COALESCE(idle_threshold_minutes, 60) INTO v_threshold FROM public.hr_settings WHERE id;
  v_threshold := COALESCE(v_threshold, 60);
  v_last := GREATEST(COALESCE(v_row.last_activity_at, v_row.open_since), v_row.open_since);
  v_gap := FLOOR(EXTRACT(EPOCH FROM (now() - v_last)) / 60);

  IF v_gap >= v_threshold THEN
    INSERT INTO public.attendance_idle_periods (attendance_id, employee_id, started_at, ended_at, minutes, ended_by)
    VALUES (v_row.id, v_emp, v_last, now(), v_gap, 'activity');
    UPDATE public.attendance
       SET idle_minutes = idle_minutes + v_gap, last_activity_at = now()
     WHERE id = v_row.id;
  ELSE
    UPDATE public.attendance SET last_activity_at = now() WHERE id = v_row.id;
  END IF;

  RETURN jsonb_build_object('tracking', true, 'idle_recorded', CASE WHEN v_gap >= v_threshold THEN v_gap ELSE 0 END);
END;
$$;

REVOKE ALL ON FUNCTION public.attendance_heartbeat() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_heartbeat() TO authenticated;

-- ---------------------------------------------------------------------------
-- Leave requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  from_date   date NOT NULL,
  to_date     date NOT NULL,
  half_day    boolean NOT NULL DEFAULT false,
  -- Working days covered, computed when applied (week-offs/holidays excluded).
  days        numeric(5,1) NOT NULL,
  reason      text,
  status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at  timestamptz,
  admin_note  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (to_date >= from_date),
  CHECK (NOT half_day OR from_date = to_date)
);
CREATE INDEX IF NOT EXISTS leave_requests_employee_idx ON public.leave_requests (employee_id, from_date);
CREATE INDEX IF NOT EXISTS leave_requests_pending_idx ON public.leave_requests (created_at) WHERE status = 'pending';

DROP TRIGGER IF EXISTS trg_leave_requests_updated_at ON public.leave_requests;
CREATE TRIGGER trg_leave_requests_updated_at BEFORE UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.hrms_touch_updated_at();

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leave_requests_select ON public.leave_requests;
CREATE POLICY leave_requests_select ON public.leave_requests FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR employee_id IN (SELECT id FROM public.employees WHERE profile_id = auth.uid())
  );
