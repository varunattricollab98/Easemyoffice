-- ─────────────────────────────────────────────────────────────────────────
-- ADD_BOOKING_DISCOUNT.sql
-- Adds discount-tracking fields to bookings:
--   quoted_amount   = the price originally quoted to the client (before negotiation)
--   discount_amount = how much discount was given to close the deal (quoted − final)
-- Safe to run multiple times (IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS quoted_amount   numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0;
