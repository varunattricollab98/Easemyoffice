-- ─────────────────────────────────────────────────────────────────────────
-- ADD_BOOKING_PLAN_YEARS.sql
-- Adds multi-year booking support to bookings:
--   plan_years = the plan duration in years the client paid for (1, 2, 3, ...).
--                Defaults to 1 so every existing single-year booking stays valid.
-- Amounts (vo_amount, total_amount, sp_payable, etc.) are still entered manually
-- by the sales team — plan_years does NOT auto-multiply them, because the price
-- for multi-year deals often includes negotiated discounts from the space.
-- plan_years only records the term and is used to auto-compute plan_expiry_date
-- (plan_start_date + plan_years) so the renewal module fires at the right time.
-- Safe to run multiple times (IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS plan_years integer NOT NULL DEFAULT 1;
