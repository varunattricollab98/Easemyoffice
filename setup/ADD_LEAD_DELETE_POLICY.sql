-- =============================================================================
-- Only admins may DELETE leads. Salespeople/other roles can still read & update
-- their leads via the existing policies — they just can't delete.
-- Deleting a lead also removes its follow-ups and timeline activities
-- automatically (ON DELETE CASCADE on those tables' lead_id foreign keys).
-- Run ONCE in Supabase -> SQL Editor. Safe to re-run.
-- (Your base setup already includes this policy; this file just guarantees it.)
-- =============================================================================
drop policy if exists "leads_delete_admin" on public.leads;
create policy "leads_delete_admin" on public.leads
  for delete to authenticated
  using (public.is_admin(auth.uid()));
