-- =============================================================================
-- ALLOW_ALL_USERS_DELETE_LEADS.sql
-- Lets a user delete duplicate leads WITHOUT giving everyone power over every
-- lead. A signed-in user may delete a lead only if:
--   * it's assigned to them (assigned_to = auth.uid()), OR
--   * it's unassigned (assigned_to IS NULL) — a fresh/uncllaimed lead, OR
--   * they are an admin (can delete any lead).
-- So reps clean up their own / unclaimed duplicates; nobody can delete a lead
-- that belongs to someone else. Admins retain full control.
--
-- Deleting a lead still cascades to its follow-ups / timeline activities
-- (ON DELETE CASCADE on those tables' lead_id FKs).
--
-- Run ONCE in Supabase -> SQL Editor. Safe to re-run.
-- =============================================================================

DROP POLICY IF EXISTS "leads_delete_admin" ON public.leads;
DROP POLICY IF EXISTS "leads_delete_all" ON public.leads;
DROP POLICY IF EXISTS "leads_delete_own_or_admin" ON public.leads;

CREATE POLICY "leads_delete_own_or_admin" ON public.leads
  FOR DELETE TO authenticated
  USING (
    assigned_to = auth.uid()
    OR assigned_to IS NULL
    OR public.is_admin(auth.uid())
  );

-- Verify:
--   SELECT policyname, cmd FROM pg_policies
--   WHERE tablename = 'leads' AND cmd = 'DELETE';
