-- =============================================================================
-- Fix: Sales/BD users couldn't update leads they created if assigned_to was
-- NULL or set to someone else. The update policy only checked assigned_to but
-- not created_by. This was causing the "Updated" toast to fire but zero rows
-- actually being changed (silent RLS denial).
--
-- Now: a user can update a lead if they are:
--   - admin, OR
--   - assigned_to = them, OR
--   - created_by = them (NEW), OR
--   - cross-team role (documentation/accounts/renewals)
--
-- Run ONCE in Supabase -> SQL Editor. Safe to re-run.
-- =============================================================================

DROP POLICY IF EXISTS "leads_update" ON public.leads;

CREATE POLICY "leads_update" ON public.leads FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
    OR public.has_role(auth.uid(),'documentation')
    OR public.has_role(auth.uid(),'accounts')
    OR public.has_role(auth.uid(),'renewals')
  ) WITH CHECK (
    public.is_admin(auth.uid())
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
    OR public.has_role(auth.uid(),'documentation')
    OR public.has_role(auth.uid(),'accounts')
    OR public.has_role(auth.uid(),'renewals')
  );
