
CREATE SEQUENCE IF NOT EXISTS public.booking_code_seq START 1001;

CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_code text NOT NULL UNIQUE DEFAULT ('EMO-BK-' || nextval('public.booking_code_seq')),
  external_booking_id text,
  booking_date date NOT NULL DEFAULT CURRENT_DATE,
  sales_agent_id uuid,
  sales_agent_name text NOT NULL,
  booking_source text NOT NULL DEFAULT 'Website',
  plan_name text NOT NULL,
  vo_plan text DEFAULT '',
  sp_name text DEFAULT '',
  area text DEFAULT '',
  city text DEFAULT '',
  state text DEFAULT '',
  sp_status text DEFAULT 'Active',
  vo_amount numeric NOT NULL DEFAULT 0,
  vo_gst numeric NOT NULL DEFAULT 0,
  addon_services text DEFAULT '',
  addon_amount numeric NOT NULL DEFAULT 0,
  addon_gst numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  tds_pct numeric NOT NULL DEFAULT 0,
  tds_amount numeric NOT NULL DEFAULT 0,
  amount_after_tds numeric NOT NULL DEFAULT 0,
  payment_mode_ref text DEFAULT '',
  payment_id_utr text DEFAULT '',
  invoice_number text DEFAULT '',
  sp_payable numeric NOT NULL DEFAULT 0,
  addon_payable numeric NOT NULL DEFAULT 0,
  profit numeric NOT NULL DEFAULT 0,
  sp_payment_status text NOT NULL DEFAULT 'Pending',
  vo_status text NOT NULL DEFAULT 'Pending',
  business_name text DEFAULT '',
  client_name text NOT NULL,
  email_id text DEFAULT '',
  contact_no text NOT NULL,
  remarks text DEFAULT '',
  sales_month text DEFAULT '',
  -- partial payment tracking
  amount_received numeric NOT NULL DEFAULT 0,
  balance_amount numeric NOT NULL DEFAULT 0,
  balance_due_date date,
  balance_paid_at timestamptz,
  last_reminder_sent_at timestamptz,
  -- ownership
  assigned_to uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bookings_created_by ON public.bookings(created_by);
CREATE INDEX IF NOT EXISTS idx_bookings_assigned_to ON public.bookings(assigned_to);
CREATE INDEX IF NOT EXISTS idx_bookings_balance_due ON public.bookings(balance_due_date) WHERE balance_paid_at IS NULL AND balance_amount > 0;

CREATE TRIGGER trg_bookings_updated_at
BEFORE UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY bookings_select ON public.bookings
FOR SELECT TO authenticated
USING (
  public.is_admin(auth.uid())
  OR assigned_to = auth.uid()
  OR created_by = auth.uid()
  OR public.has_role(auth.uid(), 'accounts')
  OR public.has_role(auth.uid(), 'documentation')
);

CREATE POLICY bookings_insert ON public.bookings
FOR INSERT TO authenticated
WITH CHECK (
  public.is_admin(auth.uid())
  OR public.has_role(auth.uid(), 'sales')
  OR public.has_role(auth.uid(), 'bd')
);

CREATE POLICY bookings_update ON public.bookings
FOR UPDATE TO authenticated
USING (
  public.is_admin(auth.uid())
  OR assigned_to = auth.uid()
  OR created_by = auth.uid()
  OR public.has_role(auth.uid(), 'accounts')
)
WITH CHECK (
  public.is_admin(auth.uid())
  OR assigned_to = auth.uid()
  OR created_by = auth.uid()
  OR public.has_role(auth.uid(), 'accounts')
);

CREATE POLICY bookings_delete ON public.bookings
FOR DELETE TO authenticated
USING (public.is_admin(auth.uid()));
