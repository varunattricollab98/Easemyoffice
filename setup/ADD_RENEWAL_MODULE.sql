-- =============================================================================
-- RENEWAL MODULE — Database Schema
-- Adds plan dates, renewal status tracking, and renewal-specific columns to
-- the bookings table. Run ONCE in Supabase -> SQL Editor.
-- =============================================================================

-- 1) Plan date columns (when the plan starts and when it expires)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS plan_start_date date,
  ADD COLUMN IF NOT EXISTS plan_expiry_date date;

-- 2) Renewal tracking columns
--    renewal_status: tracks the lifecycle of a renewal attempt
--    renewal_assigned_to: which renewal team member owns this renewal
--    renewal_notes: notes specific to the renewal conversation
--    renewal_stage_changed_at: when the renewal status last changed
--    renewal_followup_at: next scheduled follow-up for this renewal
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS renewal_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS renewal_assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS renewal_notes text DEFAULT '',
  ADD COLUMN IF NOT EXISTS renewal_stage_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS renewal_followup_at timestamptz,
  ADD COLUMN IF NOT EXISTS renewal_outcome text;

-- Valid renewal_status values:
--   pending        = not yet contacted (default for expiring bookings)
--   contacted      = first contact made
--   following_up   = in active follow-up
--   not_responding = client not responding after multiple attempts
--   pending_payment = client agreed, waiting for payment
--   renewed        = successfully renewed
--   not_interested = client declined
--   address_changed = client moved/changed address
--   lost           = lost renewal (various reasons)
--   cancelled      = booking was cancelled

-- 3) Indexes for renewal queries
CREATE INDEX IF NOT EXISTS idx_bookings_plan_expiry ON public.bookings(plan_expiry_date)
  WHERE plan_expiry_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_renewal_status ON public.bookings(renewal_status)
  WHERE renewal_status != 'pending';
CREATE INDEX IF NOT EXISTS idx_bookings_renewal_assigned ON public.bookings(renewal_assigned_to)
  WHERE renewal_assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_renewal_followup ON public.bookings(renewal_followup_at)
  WHERE renewal_followup_at IS NOT NULL;

-- 4) Allow renewal-role users to update bookings (for renewal fields)
--    The existing bookings RLS may not include renewals role — ensure it does.
DROP POLICY IF EXISTS "bookings_update_renewal" ON public.bookings;
CREATE POLICY "bookings_update_renewal" ON public.bookings
  FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'renewals')
    OR assigned_to = auth.uid()
    OR renewal_assigned_to = auth.uid()
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'renewals')
    OR assigned_to = auth.uid()
    OR renewal_assigned_to = auth.uid()
  );

-- 5) Ensure renewals role can SELECT all bookings (needed for the renewal dashboard)
DROP POLICY IF EXISTS "bookings_select_renewal" ON public.bookings;
CREATE POLICY "bookings_select_renewal" ON public.bookings
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'renewals')
    OR public.has_role(auth.uid(), 'sales')
    OR public.has_role(auth.uid(), 'bd')
    OR public.has_role(auth.uid(), 'accounts')
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
    OR renewal_assigned_to = auth.uid()
  );
