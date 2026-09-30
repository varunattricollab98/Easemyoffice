-- HRMS: salary structures and monthly salary slips.
--
-- ADMIN ONLY, INCLUDING READS. Employees never see salary in V1 (owner
-- decision), so neither table has any policy for non-admins — RLS is the
-- boundary, not the sidebar. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Salary structure: the monthly amounts at full attendance.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_salary (
  employee_id       uuid PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  effective_from    date,
  basic             numeric(12,2) NOT NULL DEFAULT 0,
  hra               numeric(12,2) NOT NULL DEFAULT 0,
  conveyance        numeric(12,2) NOT NULL DEFAULT 0,
  medical           numeric(12,2) NOT NULL DEFAULT 0,
  special_allowance numeric(12,2) NOT NULL DEFAULT 0,
  other_allowance   numeric(12,2) NOT NULL DEFAULT 0,
  pf_enabled        boolean NOT NULL DEFAULT false,
  esi_enabled       boolean NOT NULL DEFAULT false,
  professional_tax  numeric(12,2) NOT NULL DEFAULT 0,
  tds               numeric(12,2) NOT NULL DEFAULT 0,
  notes             text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_employee_salary_updated_at ON public.employee_salary;
CREATE TRIGGER trg_employee_salary_updated_at BEFORE UPDATE ON public.employee_salary
  FOR EACH ROW EXECUTE FUNCTION public.hrms_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Salary slips: one per employee per month. Draft slips hold the monthly
-- adjustments and are recomputed live; finalising freezes the full computed
-- slip into `snapshot` so later attendance or salary edits never change an
-- issued slip.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.salary_slips (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  -- First day of the month.
  month            date NOT NULL,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
  incentive        numeric(12,2) NOT NULL DEFAULT 0,
  bonus            numeric(12,2) NOT NULL DEFAULT 0,
  other_earnings   numeric(12,2) NOT NULL DEFAULT 0,
  advance_recovery numeric(12,2) NOT NULL DEFAULT 0,
  other_deductions numeric(12,2) NOT NULL DEFAULT 0,
  tds_override     numeric(12,2),
  note             text,
  snapshot         jsonb,
  net_pay          numeric(12,2),
  finalized_at     timestamptz,
  finalized_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reopened_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, month),
  CHECK (EXTRACT(DAY FROM month) = 1)
);
CREATE INDEX IF NOT EXISTS salary_slips_month_idx ON public.salary_slips (month);

DROP TRIGGER IF EXISTS trg_salary_slips_updated_at ON public.salary_slips;
CREATE TRIGGER trg_salary_slips_updated_at BEFORE UPDATE ON public.salary_slips
  FOR EACH ROW EXECUTE FUNCTION public.hrms_touch_updated_at();

-- A final slip is locked: the only allowed change is an explicit reopen back
-- to draft (which is timestamped). It cannot be deleted.
CREATE OR REPLACE FUNCTION public.salary_slips_lock()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'final' THEN
      RAISE EXCEPTION 'A finalised salary slip cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'final' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'A finalised salary slip is locked; reopen it first';
    END IF;
    NEW.reopened_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_salary_slips_lock ON public.salary_slips;
CREATE TRIGGER trg_salary_slips_lock BEFORE UPDATE OR DELETE ON public.salary_slips
  FOR EACH ROW EXECUTE FUNCTION public.salary_slips_lock();

-- ---------------------------------------------------------------------------
-- RLS: admin only, for reads too.
-- ---------------------------------------------------------------------------
ALTER TABLE public.employee_salary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_slips    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_salary_admin ON public.employee_salary;
CREATE POLICY employee_salary_admin ON public.employee_salary FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS salary_slips_admin ON public.salary_slips;
CREATE POLICY salary_slips_admin ON public.salary_slips FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
