-- =============================================================================
-- Editable bookings + partial payments + shared update history.
--   * booking_payments : one row per payment installment (mode, reference,
--                        payment link, amount, date).
--   * booking_updates  : an audit trail of every change/payment on a booking.
--   * a policy so ANY signed-in team member can update a booking (shared edits).
-- Run ONCE in Supabase -> SQL Editor. Safe to re-run.
-- =============================================================================

-- ---- payments ----
create table if not exists public.booking_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  amount numeric not null default 0,
  mode text default '',
  reference text default '',
  payment_link text default '',
  note text default '',
  paid_at date not null default current_date,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_booking_payments_booking on public.booking_payments(booking_id, created_at);
alter table public.booking_payments enable row level security;

drop policy if exists booking_payments_select on public.booking_payments;
create policy booking_payments_select on public.booking_payments
  for select to authenticated using (true);
drop policy if exists booking_payments_insert on public.booking_payments;
create policy booking_payments_insert on public.booking_payments
  for insert to authenticated with check (auth.uid() is not null);
drop policy if exists booking_payments_delete on public.booking_payments;
create policy booking_payments_delete on public.booking_payments
  for delete to authenticated using (public.is_admin(auth.uid()) or created_by = auth.uid());

-- ---- update history ----
create table if not exists public.booking_updates (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  actor_id uuid,
  action text not null,
  detail text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_booking_updates_booking on public.booking_updates(booking_id, created_at desc);
alter table public.booking_updates enable row level security;

drop policy if exists booking_updates_select on public.booking_updates;
create policy booking_updates_select on public.booking_updates
  for select to authenticated using (true);
drop policy if exists booking_updates_insert on public.booking_updates;
create policy booking_updates_insert on public.booking_updates
  for insert to authenticated with check (auth.uid() is not null);

-- ---- allow any signed-in team member to update a booking (shared editing) ----
drop policy if exists bookings_update_team on public.bookings;
create policy bookings_update_team on public.bookings
  for update to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);
