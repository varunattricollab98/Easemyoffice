// Fresh vs renewal bookings, and friendly names for plan codes.
//
// Owner's convention (Sep 2026): a renewal booking's Booking ID ends in R<n>,
// where n is the renewal year — R1 = first renewal (year 1), R2 = year 2,
// R3 = year 3, … Renewals are uploaded separately with that suffix. Kept pure
// so every screen agrees.

export type BookingKindFields = {
  external_booking_id?: string | null;
  booking_source?: string | null;
  renewal_status?: string | null;
};

const RENEWAL_ID = /R(\d+)$/i;

/** Renewal year from the Booking ID suffix (…R2 → 2), or null. */
export function renewalYear(externalBookingId: string | null | undefined): number | null {
  const m = RENEWAL_ID.exec(String(externalBookingId ?? "").trim());
  return m ? Number(m[1]) : null;
}

/**
 * A booking is a renewal when:
 * - its Booking ID ends in R<number> (R1, R2 …) — the primary rule; or
 * - its source is "Renewal"; or
 * - it was made through the in-CRM renewal form: that form sets
 *   renewal_status renewed / pending_payment and never gets a sheet Booking ID.
 *   Requiring the missing ID matters: the renewal pipeline also marks an
 *   ORIGINAL fresh booking "renewed", and that booking has a Booking ID.
 */
export function isRenewalBooking(b: BookingKindFields): boolean {
  const id = String(b.external_booking_id ?? "").trim();
  if (id && RENEWAL_ID.test(id)) return true;
  if (
    String(b.booking_source ?? "")
      .trim()
      .toLowerCase() === "renewal"
  )
    return true;
  if (!id && ["renewed", "pending_payment"].includes(String(b.renewal_status ?? ""))) return true;
  return false;
}

/** Plan-code prefixes (BR_SPMukherji_kolkata → BR) and what they mean. */
export const PLAN_CODE_LABELS: Record<string, string> = {
  BR: "Business Registration",
  MA: "Mailing Address",
  GST: "GST",
};

export const planCodeLabel = (code: string) => PLAN_CODE_LABELS[code.trim().toUpperCase()] ?? code;
