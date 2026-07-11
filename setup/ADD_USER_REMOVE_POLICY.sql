-- =============================================================================
-- Allow admins to remove a team member (delete their profile row). Their roles
-- are removed via the existing 'admins manage user_roles' policy.
-- Run ONCE in Supabase -> SQL Editor. Safe to re-run.
-- =============================================================================
drop policy if exists "profiles_admin_delete" on public.profiles;
create policy "profiles_admin_delete" on public.profiles
  for delete to authenticated
  using (public.is_admin(auth.uid()));
