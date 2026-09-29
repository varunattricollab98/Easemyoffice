-- Links a booking back to the lead it was converted from.
--
-- "Convert to Booking" (#154) already carried the lead's details into the
-- booking form, but there was nowhere to store WHICH lead it came from: the
-- provenance lived only in a lead_activities note and a free-text line in
-- bookings.remarks. Neither is queryable, so questions the sales team actually
-- asks — how many leads converted this month, conversion rate per agent, which
-- sources produce paying clients — could not be answered by a join.
--
-- Nullable with ON DELETE SET NULL, deliberately:
--   * nullable because the overwhelming majority of existing rows predate the
--     conversion flow, and a booking can still be created directly from the
--     Bookings page with no lead behind it;
--   * SET NULL rather than CASCADE because deleting a lead must never destroy
--     the booking — the booking is the revenue record and is also mirrored into
--     the Google Sheet. leads has ON DELETE CASCADE on its dependent tables
--     (lead_activities, follow_ups), so CASCADE here would be quietly
--     destructive.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL;

-- Supports the conversion-reporting direction (given a lead, find its bookings)
-- and keeps the FK check cheap when a lead is deleted. Partial, because only
-- converted bookings carry a value and a NULL-heavy index would be mostly dead
-- weight.
CREATE INDEX IF NOT EXISTS bookings_lead_id_idx
  ON public.bookings (lead_id)
  WHERE lead_id IS NOT NULL;

COMMENT ON COLUMN public.bookings.lead_id IS
  'The lead this booking was converted from via "Convert to Booking". NULL for bookings created directly on the Bookings page.';
