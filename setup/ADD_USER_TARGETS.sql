-- =============================================================================
-- Per-salesperson monthly targets (bookings + profit).
-- Admins assign them; everyone can read (so each person sees their own on their
-- dashboard). Run ONCE in Supabase -> SQL Editor. Safe to re-run.
-- Requires ADD_SALES_TARGETS.sql (the cumulative/team target) too.
-- =============================================================================
create table if not exists public.user_targets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  bookings integer not null default 0,
  profit numeric not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.user_targets enable row level security;

drop policy if exists user_targets_select on public.user_targets;
create policy user_targets_select on public.user_targets
  for select to authenticated using (true);

drop policy if exists user_targets_admin_write on public.user_targets;
create policy user_targets_admin_write on public.user_targets
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
