-- =============================================================================
-- Only admins may DELETE tasks. Everyone else can still UPDATE (e.g. mark a task
-- done) via the existing tasks_update policy — they just can't delete.
-- Run ONCE in Supabase -> SQL Editor. Safe to re-run.
-- =============================================================================
drop policy if exists "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks
  for delete to authenticated
  using (public.is_admin(auth.uid()));
