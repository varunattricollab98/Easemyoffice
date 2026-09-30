-- HRMS Phase 2: geo-tagged attendance (LOGIN / LOGOUT).
--
-- WHO WRITES WHAT
--   Only the `attendance-punch` edge function writes these tables, using the
--   service role. It resolves the employee from the caller's JWT, checks the
--   device and the office geofence SERVER-SIDE, and records every attempt.
--   Signed-in users get SELECT on their own rows and nothing else — there are
--   deliberately no INSERT / UPDATE / DELETE policies for employees, so a user
--   cannot mark themselves present by calling the REST API directly.
--
--   Admins can read everything and approve / revoke devices, but cannot edit
--   attendance rows here. Corrections arrive in Phase 4 as separate records so
--   the original punches are never overwritten.
--
-- Safe to re-run: IF NOT EXISTS everywhere, policies dropped before creation.

-- ---------------------------------------------------------------------------
-- Registered devices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  -- Random id generated once per browser and kept in localStorage. It identifies
  -- a browser profile, not hardware: clearing site data creates a "new device",
  -- which then needs approval again when approval is required.
  device_key    text NOT NULL,
  label         text,
  user_agent    text,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','revoked')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  UNIQUE (employee_id, device_key)
);

CREATE INDEX IF NOT EXISTS attendance_devices_status_idx ON public.attendance_devices (status);

-- ---------------------------------------------------------------------------
-- One row per employee per working date (India calendar day)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  work_date        date NOT NULL,
  office_id        uuid REFERENCES public.office_locations(id) ON DELETE SET NULL,
  first_login_at   timestamptz NOT NULL,
  last_logout_at   timestamptz,
  -- Start of the session currently open, NULL when logged out. Logging in again
  -- after a logout reopens the day; worked_minutes accumulates closed sessions.
  open_since       timestamptz,
  worked_minutes   integer NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'in_progress'
                     CHECK (status IN ('in_progress','present','half_day')),
  is_late          boolean NOT NULL DEFAULT false,
  late_minutes     integer NOT NULL DEFAULT 0,
  overtime_minutes integer NOT NULL DEFAULT 0,
  login_latitude   numeric(10, 7),
  login_longitude  numeric(10, 7),
  login_accuracy_m numeric,
  login_distance_m integer,
  logout_latitude   numeric(10, 7),
  logout_longitude  numeric(10, 7),
  logout_accuracy_m numeric,
  logout_distance_m integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS attendance_date_idx ON public.attendance (work_date);
CREATE INDEX IF NOT EXISTS attendance_open_idx
  ON public.attendance (employee_id) WHERE open_since IS NOT NULL;

DROP TRIGGER IF EXISTS trg_attendance_updated_at ON public.attendance;
CREATE TRIGGER trg_attendance_updated_at BEFORE UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.hrms_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Append-only audit of EVERY punch attempt, accepted or rejected
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The CRM login that pressed the button. employee_id is NULL when that login
  -- is not linked to an employee — still recorded, it is a security signal.
  profile_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  employee_id   uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  attendance_id uuid REFERENCES public.attendance(id) ON DELETE SET NULL,
  event_type    text NOT NULL CHECK (event_type IN ('login','logout')),
  outcome       text NOT NULL CHECK (outcome IN ('accepted','rejected')),
  reason        text,
  latitude      numeric(10, 7),
  longitude     numeric(10, 7),
  accuracy_m    numeric,
  distance_m    integer,
  office_id     uuid REFERENCES public.office_locations(id) ON DELETE SET NULL,
  device_key    text,
  -- Browser-side geolocation error (permission denied, timeout), if any.
  client_error  text,
  ip            text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attendance_events_created_idx  ON public.attendance_events (created_at DESC);
CREATE INDEX IF NOT EXISTS attendance_events_employee_idx ON public.attendance_events (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS attendance_events_rejected_idx
  ON public.attendance_events (created_at DESC) WHERE outcome = 'rejected';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.attendance_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_events  ENABLE ROW LEVEL SECURITY;

-- Own rows are found through employees.profile_id; that subquery is itself
-- subject to the employees policy, which already limits it to the caller.
DROP POLICY IF EXISTS attendance_select ON public.attendance;
CREATE POLICY attendance_select ON public.attendance FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR employee_id IN (SELECT id FROM public.employees WHERE profile_id = auth.uid())
  );

DROP POLICY IF EXISTS attendance_events_select ON public.attendance_events;
CREATE POLICY attendance_events_select ON public.attendance_events FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR profile_id = auth.uid());

DROP POLICY IF EXISTS attendance_devices_select ON public.attendance_devices;
CREATE POLICY attendance_devices_select ON public.attendance_devices FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR employee_id IN (SELECT id FROM public.employees WHERE profile_id = auth.uid())
  );

-- Admin approves / revokes devices from the Attendance page.
DROP POLICY IF EXISTS attendance_devices_admin_update ON public.attendance_devices;
CREATE POLICY attendance_devices_admin_update ON public.attendance_devices FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

COMMENT ON TABLE public.attendance_events IS
  'Append-only audit of every attendance punch attempt (accepted and rejected). Written only by the attendance-punch edge function; no update/delete policies exist.';
