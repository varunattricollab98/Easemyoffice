-- ─────────────────────────────────────────────────────────────────────────
-- ADD_ALTERNATE_EMAILS.sql
-- A client often has more than one email address — their own, their
-- accountant's, a founder's. Bookings already carry two alternative contact
-- NUMBERS (alt_contact_no, alt_contact_no_2); these are the matching email
-- columns, so a payment acknowledgment or a quotation can reach everyone who
-- needs it instead of a single address.
--
--   bookings.alt_email    -> second address for the client on that booking
--   bookings.alt_email_2  -> third address
--   leads.alt_email       -> second address for the lead
--
-- Mirrors ADD_BOOKING_ALT_CONTACTS.sql: text DEFAULT '', IF NOT EXISTS.
-- Safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS alt_email   text DEFAULT '',
  ADD COLUMN IF NOT EXISTS alt_email_2 text DEFAULT '';

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS alt_email text DEFAULT '';

-- Verify:
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND ((table_name = 'bookings' AND column_name IN ('alt_email','alt_email_2'))
--       OR (table_name = 'leads'    AND column_name = 'alt_email'))
--   ORDER BY table_name, column_name;
