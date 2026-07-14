-- =============================================================================
-- Monthly sales target (bookings + profit) shown in the "Our Target" panel.
-- Stored once in app_settings; admins can edit it, everyone can read it.
-- Run ONCE in Supabase -> SQL Editor. Safe to re-run.
-- =============================================================================

-- Default target (only inserted if not already present).
insert into public.app_settings (key, value)
values ('sales_targets', '{"bookings":100,"profit":500000}'::jsonb)
on conflict (key) do nothing;

-- Let any signed-in user READ the target (admin insert/update policies already exist).
drop policy if exists app_settings_read_targets on public.app_settings;
create policy app_settings_read_targets on public.app_settings
  for select to authenticated using (key = 'sales_targets');
