-- ─────────────────────────────────────────────────────────────────────────
-- ADD_BOOKING_ALT_CONTACTS.sql
-- Adds two optional "alternative contact number" fields to bookings so the
-- Client Database can store more than one phone number per client.
-- Safe to run multiple times (IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS alt_contact_no   text DEFAULT '',
  ADD COLUMN IF NOT EXISTS alt_contact_no_2 text DEFAULT '';
