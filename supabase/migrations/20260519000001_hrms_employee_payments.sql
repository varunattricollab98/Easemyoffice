-- HRMS: standalone employee payments / expenses ledger.
--
-- ADMIN ONLY, INCLUDING READS. Employees never see these records (owner
-- decision), so the table has a single admin-only policy — RLS is the
-- boundary, not the sidebar. Separate from salary slips: this records
-- incentives, bonuses, reimbursements, advances and other expenses paid
-- towards an employee, with free-text details. Safe to re-run; the owner
-- applies this migration manually after deploy.

-- ---------------------------------------------------------------------------
-- Payments ledger: one row per payment/expense towards an employee.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  paid_on     date NOT NULL DEFAULT CURRENT_DATE,
  type        text NOT NULL CHECK (type IN ('incentive','bonus','reimbursement','advance','other')),
  amount      numeric(12,2) NOT NULL CHECK (amount >= 0),
  note        text,
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_payments_paid_on_idx ON public.employee_payments (paid_on);
CREATE INDEX IF NOT EXISTS employee_payments_employee_id_idx ON public.employee_payments (employee_id);

DROP TRIGGER IF EXISTS trg_employee_payments_updated_at ON public.employee_payments;
CREATE TRIGGER trg_employee_payments_updated_at BEFORE UPDATE ON public.employee_payments
  FOR EACH ROW EXECUTE FUNCTION public.hrms_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: admin only, for reads too.
-- ---------------------------------------------------------------------------
ALTER TABLE public.employee_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_payments_admin ON public.employee_payments;
CREATE POLICY employee_payments_admin ON public.employee_payments FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
