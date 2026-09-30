-- HRMS Phase 1: employee master, departments, office location, working-hours
-- settings and holidays. No attendance, leave or payroll yet — those land in
-- later phases on top of this.
--
-- TWO STRUCTURAL DECISIONS WORTH KNOWING BEFORE READING ON:
--
-- 1. Sensitive PII (bank account, PAN, Aadhaar) lives in a SEPARATE table,
--    employee_private, not as columns on employees. Postgres RLS is row-level,
--    not column-level — there is no way to let an employee read their own
--    employees row while hiding the bank columns on that same row. Splitting the
--    table is the only clean way to get "employee sees their own profile, only
--    admin ever sees bank details" without routing every read through a view.
--
-- 2. `department` is a lookup table (employees are grouped and filtered by it,
--    so a typo would split a department in reports) while `designation` is plain
--    text on the employee (display only). A designations lookup can be added
--    later if it ever needs to drive logic.

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.departments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.departments (name) VALUES
  ('Sales'), ('Operations'), ('Documentation'), ('Accounts'),
  ('Business Development'), ('Renewals'), ('Compliance'), ('HR/Admin')
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Office locations (the geofence anchor used by Phase 2 attendance)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.office_locations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  latitude        numeric(10, 7) NOT NULL,
  longitude       numeric(10, 7) NOT NULL,
  -- How far from the pin a login still counts as "at the office".
  radius_m        integer NOT NULL DEFAULT 100,
  -- Readings vaguer than this are rejected outright: a 2km-accurate fix that
  -- happens to centre on the office proves nothing about where the phone is.
  max_accuracy_m  integer NOT NULL DEFAULT 50,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employees (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Links to the CRM login. Nullable so HR can record someone who has no CRM
  -- account yet; ON DELETE SET NULL keeps the employment record if the login is
  -- removed, because attendance and payroll history must survive it.
  profile_id          uuid UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
  employee_code       text NOT NULL UNIQUE,
  first_name          text NOT NULL,
  last_name           text,
  photo_url           text,
  phone               text,
  email               text,
  personal_email      text,
  department_id       uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  designation         text,
  reporting_manager_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  joining_date        date,
  -- Kept as CHECKed text rather than enums: these lists are policy, not
  -- structure, and adding an enum value needs a migration while a CHECK can be
  -- widened in place.
  employment_type     text NOT NULL DEFAULT 'full_time'
                        CHECK (employment_type IN ('full_time','part_time','intern','contract','consultant')),
  employment_status   text NOT NULL DEFAULT 'active'
                        CHECK (employment_status IN ('active','probation','notice_period','resigned','terminated')),
  office_id           uuid REFERENCES public.office_locations(id) ON DELETE SET NULL,
  exit_date           date,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employees_profile_idx    ON public.employees (profile_id);
CREATE INDEX IF NOT EXISTS employees_department_idx ON public.employees (department_id);
CREATE INDEX IF NOT EXISTS employees_status_idx     ON public.employees (employment_status);

-- Sensitive PII, admin-only. See decision (1) at the top of this file.
CREATE TABLE IF NOT EXISTS public.employee_private (
  employee_id      uuid PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  pan              text,
  aadhaar          text,
  bank_name        text,
  bank_account_name text,
  bank_account_no  text,
  bank_ifsc        text,
  uan              text,
  esi_number       text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- HR settings — single row, working hours and week-offs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hr_settings (
  -- Enforced singleton: a second row would silently create two competing
  -- policies with no way to tell which one attendance used.
  id                    boolean PRIMARY KEY DEFAULT true CHECK (id),
  work_start            time NOT NULL DEFAULT '09:30',
  grace_minutes         integer NOT NULL DEFAULT 15,
  -- Full working day in minutes (8h 30m).
  required_minutes      integer NOT NULL DEFAULT 510,
  -- Half-day threshold, used by Phase 2 to decide present vs half-day.
  half_day_minutes      integer NOT NULL DEFAULT 240,
  -- 0 = Sunday … 6 = Saturday, matching JS getDay().
  week_offs             integer[] NOT NULL DEFAULT '{0,6}',
  default_office_id     uuid REFERENCES public.office_locations(id) ON DELETE SET NULL,
  -- Phase 2 switch: when false, attendance is accepted without a geofence check.
  require_geofence      boolean NOT NULL DEFAULT true,
  require_device_approval boolean NOT NULL DEFAULT false,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.hr_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Holidays
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.holidays (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  date       date NOT NULL,
  holiday_type text NOT NULL DEFAULT 'company'
               CHECK (holiday_type IN ('company','optional','regional')),
  office_id  uuid REFERENCES public.office_locations(id) ON DELETE SET NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (date, name)
);

CREATE INDEX IF NOT EXISTS holidays_date_idx ON public.holidays (date);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hrms_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_employees_updated_at ON public.employees;
CREATE TRIGGER trg_employees_updated_at BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.hrms_touch_updated_at();

DROP TRIGGER IF EXISTS trg_employee_private_updated_at ON public.employee_private;
CREATE TRIGGER trg_employee_private_updated_at BEFORE UPDATE ON public.employee_private
  FOR EACH ROW EXECUTE FUNCTION public.hrms_touch_updated_at();

DROP TRIGGER IF EXISTS trg_office_locations_updated_at ON public.office_locations;
CREATE TRIGGER trg_office_locations_updated_at BEFORE UPDATE ON public.office_locations
  FOR EACH ROW EXECUTE FUNCTION public.hrms_touch_updated_at();

DROP TRIGGER IF EXISTS trg_hr_settings_updated_at ON public.hr_settings;
CREATE TRIGGER trg_hr_settings_updated_at BEFORE UPDATE ON public.hr_settings
  FOR EACH ROW EXECUTE FUNCTION public.hrms_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
--
-- The UI hides HR pages from non-admins, but that is cosmetic — anyone can type
-- a URL or call the REST API directly. These policies are the actual boundary,
-- which matters because salary lands on top of this schema in Phase 5.
-- ---------------------------------------------------------------------------
ALTER TABLE public.departments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays         ENABLE ROW LEVEL SECURITY;

-- Reference data every employee legitimately needs (their own shift timing, the
-- holiday list, which office they report to): readable by any signed-in user,
-- writable only by admin.
DROP POLICY IF EXISTS departments_select ON public.departments;
CREATE POLICY departments_select ON public.departments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS departments_write ON public.departments;
CREATE POLICY departments_write ON public.departments FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS office_locations_select ON public.office_locations;
CREATE POLICY office_locations_select ON public.office_locations FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS office_locations_write ON public.office_locations;
CREATE POLICY office_locations_write ON public.office_locations FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS hr_settings_select ON public.hr_settings;
CREATE POLICY hr_settings_select ON public.hr_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS hr_settings_write ON public.hr_settings;
CREATE POLICY hr_settings_write ON public.hr_settings FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS holidays_select ON public.holidays;
CREATE POLICY holidays_select ON public.holidays FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS holidays_write ON public.holidays;
CREATE POLICY holidays_write ON public.holidays FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- An employee may read their OWN record (Phase 2 needs it to resolve which
-- office they belong to) and nobody else's. Only admin can read the roster or
-- change anything.
DROP POLICY IF EXISTS employees_select ON public.employees;
CREATE POLICY employees_select ON public.employees FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR profile_id = auth.uid());
DROP POLICY IF EXISTS employees_write ON public.employees;
CREATE POLICY employees_write ON public.employees FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- Bank/PAN/Aadhaar: admin only, including reads. Deliberately NOT readable by
-- the employee it belongs to — nothing in the app needs to show it back to them,
-- and not exposing it at all is the safer default.
DROP POLICY IF EXISTS employee_private_admin ON public.employee_private;
CREATE POLICY employee_private_admin ON public.employee_private FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

COMMENT ON TABLE public.employee_private IS
  'Sensitive employee PII (bank, PAN, Aadhaar). Admin-only by RLS; kept out of public.employees because Postgres RLS cannot hide individual columns.';
