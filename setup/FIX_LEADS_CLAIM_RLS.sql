-- =============================================================================
-- Fix: reps could not CLAIM an unassigned lead from the shared inbox.
--
-- The old leads_update policy only let you update a lead if it was already
-- yours (assigned_to / created_by = you), you were admin, or you had a
-- cross-team role. So when a rep clicked "Claim / Mark as mine" on an email
-- whose lead already existed but was UNASSIGNED (assigned_to IS NULL) or owned
-- by someone else, the UPDATE matched 0 rows and was SILENTLY denied — the
-- Gmail label got set to their name (so it appeared in Inbox → "My leads"),
-- but the DB row never moved, so it never showed in their Pipeline / Leads.
--
-- Now: a rep can also claim a lead that is currently UNASSIGNED. The WITH CHECK
-- still forces the new owner to be themselves, so nobody can hand a lead to
-- another rep (reassigning a lead already owned by someone else stays
-- admin-only, by design).
--
-- Run ONCE in Supabase -> SQL Editor. Safe to re-run.
-- =============================================================================

DROP POLICY IF EXISTS "leads_update" ON public.leads;

CREATE POLICY "leads_update" ON public.leads FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
    OR assigned_to IS NULL                       -- NEW: allow claiming unassigned leads
    OR public.has_role(auth.uid(),'documentation')
    OR public.has_role(auth.uid(),'accounts')
    OR public.has_role(auth.uid(),'renewals')
  ) WITH CHECK (
    public.is_admin(auth.uid())
    OR assigned_to = auth.uid()                  -- after claiming it must be theirs
    OR created_by = auth.uid()
    OR public.has_role(auth.uid(),'documentation')
    OR public.has_role(auth.uid(),'accounts')
    OR public.has_role(auth.uid(),'renewals')
  );
