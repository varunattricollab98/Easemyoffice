-- ─────────────────────────────────────────────────────────────────────────
-- ADD_BOOKING_DELETE_POLICY.sql
-- Ensures ADMINS can delete bookings (the Bookings page shows a Delete button
-- to admins). This policy already ships in COMBINED_DATABASE_SETUP.sql, but this
-- standalone, idempotent version guarantees it exists on databases that were
-- set up before it was added. Safe to run multiple times.
--
-- Child rows are cleaned up automatically:
--   booking_payments, booking_updates -> ON DELETE CASCADE
--   email_log, reminders              -> ON DELETE SET NULL
-- (see ADD_BOOKING_PAYMENTS_HISTORY.sql / ADD_EMAIL_LOG.sql / ADD_REMINDERS.sql)
-- ─────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS bookings_delete ON public.bookings;
CREATE POLICY bookings_delete ON public.bookings
  FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));
