-- =============================================================================
-- Removes the leftover "demo/preview mode" trigger that silently made EVERY new
-- signup an admin. After running this, the normal rule applies:
--   * the very first user is admin
--   * everyone created afterwards defaults to 'sales'
-- (Admins can still change anyone's role from the Team Users page.)
--
-- This does NOT change roles that were already granted. To fix an existing user
-- who wrongly shows "admin", use the "Set role" dropdown on the Team Users page.
--
-- Run ONCE in Supabase -> SQL Editor. Safe to re-run.
-- =============================================================================
drop trigger if exists on_auth_user_created_demo on auth.users;
drop function if exists public.handle_new_user_demo();
