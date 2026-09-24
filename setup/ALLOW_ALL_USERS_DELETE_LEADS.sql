-- =============================================================================
-- ALLOW_ALL_USERS_DELETE_LEADS.sql
-- Lets EVERY signed-in user delete leads (so anyone can clean up duplicate
-- leads, not just admins). Replaces the previous admin-only delete policy
-- (leads_delete_admin from ADD_LEAD_DELETE_POLICY.sql).
--
-- Deleting a lead still cascades to its follow-ups / timeline activities
-- (ON DELETE CASCADE on those tables' lead_id FKs).
--
-- NOTE: this intentionally allows any authenticated user to delete ANY lead.
-- Run ONCE in Supabase -> SQL Editor. Safe to re-run.
-- =============================================================================

DROP POLICY IF EXISTS "leads_delete_admin" ON public.leads;
DROP POLICY IF EXISTS "leads_delete_all" ON public.leads;

CREATE POLICY "leads_delete_all" ON public.leads
  FOR DELETE TO authenticated
  USING (true);

-- Verify:
--   SELECT policyname, cmd FROM pg_policies
--   WHERE tablename = 'leads' AND cmd = 'DELETE';
