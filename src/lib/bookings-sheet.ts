import { supabase } from "@/integrations/supabase/client";

// Google Sheet round trips go: browser -> Supabase edge function -> Apps Script
// Web App. Apps Script needs ~2.7s of sheet reads on a normal day and can stall
// for much longer, and `supabase.functions.invoke` has no timeout of its own.
// Without the races below a stalled hop leaves the caller pending forever, which
// is what left the booking form stuck on "Fetching plans from sheet...".
const READ_TIMEOUT_MS = 15_000;
const WRITE_TIMEOUT_MS = 20_000;

async function invokeWithTimeout<T>(
  fn: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ data: T | null; error: string | null }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      supabase.functions.invoke(fn, { body }).then(({ data, error }) => ({
        data: (data ?? null) as T | null,
        error: error ? error.message || "Function call failed" : null,
      })),
      new Promise<{ data: T | null; error: string }>((resolve) => {
        const took = timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)}s` : `${timeoutMs}ms`;
        timer = setTimeout(
          () => resolve({ data: null, error: `Timed out after ${took}` }),
          timeoutMs,
        );
      }),
    ]);
  } catch (e) {
    return { data: null, error: (e as Error).message || "Unexpected error" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Best-effort push of one booking row to the connected Google Sheet.
// Never throws — returns a status so the UI can note it without blocking saves.
// The timeout matters here: this runs *after* the booking is already in the
// database, so a hang would leave the dialog open on a spinner and tempt the
// user into submitting the same booking twice.
export async function syncBookingToSheet(
  values: (string | number)[],
): Promise<{ ok: boolean; note?: string }> {
  const { data, error } = await invokeWithTimeout<{ ok?: boolean; error?: string }>(
    "sync-booking-to-sheet",
    { values },
    WRITE_TIMEOUT_MS,
  );
  if (error) return { ok: false, note: error };
  if (data?.ok) return { ok: true };
  return { ok: false, note: data?.error || "sheet not connected" };
}

export interface PlanRow {
  code: string;
  vo_plan?: string;
  sp_name?: string;
  area?: string;
  city?: string;
  state?: string;
  sp_status?: string;
  sp_payable?: string | number;
  selling_price?: string | number;
  gst_pct?: string | number;
  service_type?: string;
}

interface RawSheetConfig {
  ok?: boolean;
  error?: string;
  nextBookingId?: string | null;
  plans?: unknown;
  plansError?: string | null;
  bookingIdError?: string | null;
}

async function readSheetConfig(action: "plans" | "bookingid" | "config"): Promise<RawSheetConfig> {
  const { data, error } = await invokeWithTimeout<RawSheetConfig>(
    "get-sheet-config",
    { action },
    READ_TIMEOUT_MS,
  );
  if (error) return { ok: false, error };
  if (!data) return { ok: false, error: "Empty response from get-sheet-config" };
  if (data.ok === false) return { ok: false, error: data.error || "Sheet rejected the request" };
  return data;
}

export interface PlansResult {
  plans: PlanRow[];
  error: string | null;
}

// Plans master list that backs the plan dropdown. Cheap on the Apps Script side
// because it is cached there, and it no longer waits on the Booking ID scan.
// Never throws: on failure it reports the reason so the UI can fall back to a
// plain text input and offer a retry instead of spinning forever.
export async function getSheetPlans(): Promise<PlansResult> {
  const raw = await readSheetConfig("plans");
  if (raw.ok === false) return { plans: [], error: raw.error ?? "Could not reach the sheet" };
  return {
    plans: Array.isArray(raw.plans) ? (raw.plans as PlanRow[]) : [],
    error: raw.plansError ?? null,
  };
}

export interface NextBookingIdResult {
  nextBookingId: string | null;
  error: string | null;
}

// Next unused Booking ID, fetched separately from the plans on purpose: Apps
// Script has to scan the entire bookings column for this (~2.2s of the ~2.7s
// total), and the plan dropdown should never be held up by it.
//
// The caller must treat a null id as a real problem, not a shrug. Saving with a
// locally generated fallback is what puts non-sequential EMO-BK-* ids into the
// sheet, which then have to be cleaned up by hand.
export async function getNextBookingIdFromSheet(): Promise<NextBookingIdResult> {
  const raw = await readSheetConfig("bookingid");
  if (raw.ok === false)
    return { nextBookingId: null, error: raw.error ?? "Could not reach the sheet" };
  if (raw.bookingIdError) return { nextBookingId: null, error: raw.bookingIdError };

  const id = typeof raw.nextBookingId === "string" ? raw.nextBookingId.trim() : "";
  // Apps Script returns "" when the BookingIDs tab is missing/empty or every id
  // in it has already been used. That is a distinct, actionable condition —
  // don't let it look like a network failure.
  if (!id) {
    return {
      nextBookingId: null,
      error: "No unused Booking ID left in the sheet's BookingIDs tab",
    };
  }
  return { nextBookingId: id, error: null };
}

// ─── Admin edits → update the existing sheet row ─────────────────────────────

/** A saved booking, as read back from the bookings table. */
export interface BookingSheetSource {
  booking_code?: string | null;
  external_booking_id?: string | null;
  booking_date?: string | null;
  sales_agent_name?: string | null;
  booking_source?: string | null;
  plan_name?: string | null;
  vo_plan?: string | null;
  sp_name?: string | null;
  area?: string | null;
  city?: string | null;
  state?: string | null;
  sp_status?: string | null;
  vo_amount?: number | string | null;
  vo_gst?: number | string | null;
  addon_services?: string | null;
  addon_amount?: number | string | null;
  addon_gst?: number | string | null;
  total_amount?: number | string | null;
  tds_pct?: number | string | null;
  tds_amount?: number | string | null;
  amount_after_tds?: number | string | null;
  payment_mode_ref?: string | null;
  payment_id_utr?: string | null;
  invoice_number?: string | null;
  sp_payable?: number | string | null;
  addon_payable?: number | string | null;
  profit?: number | string | null;
  sp_payment_status?: string | null;
  vo_status?: string | null;
  business_name?: string | null;
  client_name?: string | null;
  email_id?: string | null;
  alt_email?: string | null;
  contact_no?: string | null;
  remarks?: string | null;
  sales_month?: string | null;
  amount_received?: number | string | null;
  balance_amount?: number | string | null;
  balance_due_date?: string | null;
  plan_years?: number | string | null;
  plan_start_date?: string | null;
  plan_expiry_date?: string | null;
}

export function sheetBookingId(b: BookingSheetSource): string {
  return String(b.external_booking_id || b.booking_code || "").trim();
}

/**
 * The sheet row for a saved booking, in the SAME column order the new-booking
 * form appends (new-booking-dialog persistBooking) so an update lines up with
 * the row that was originally written.
 */
export function bookingSheetValues(b: BookingSheetSource): (string | number)[] {
  const n = (v: number | string | null | undefined) => (v == null || v === "" ? 0 : Number(v));
  const t = (v: string | null | undefined) => v ?? "";
  return [
    t(b.booking_date),
    t(b.sales_agent_name),
    sheetBookingId(b),
    t(b.booking_source),
    t(b.plan_name),
    t(b.vo_plan),
    t(b.sp_name),
    t(b.area),
    t(b.city),
    t(b.state),
    t(b.sp_status),
    n(b.vo_amount),
    n(b.vo_gst),
    t(b.addon_services),
    n(b.addon_amount),
    n(b.addon_gst),
    n(b.total_amount),
    n(b.tds_pct),
    n(b.tds_amount),
    n(b.amount_after_tds),
    t(b.payment_mode_ref),
    t(b.payment_id_utr),
    t(b.invoice_number),
    n(b.sp_payable),
    n(b.addon_payable),
    n(b.profit),
    t(b.sp_payment_status),
    t(b.vo_status),
    t(b.business_name),
    t(b.client_name),
    t(b.email_id),
    t(b.contact_no),
    t(b.remarks),
    t(b.sales_month),
    n(b.amount_received),
    n(b.balance_amount),
    t(b.balance_due_date),
    b.plan_years == null || b.plan_years === "" ? "" : Number(b.plan_years),
    t(b.plan_start_date),
    t(b.plan_expiry_date),
    // Column 41. Appended rather than placed next to Email Id (column 31),
    // because inserting there would shift columns 32-40 on every update and
    // silently corrupt rows that were written by the old layout.
    t(b.alt_email),
  ];
}

/**
 * Overwrites the booking's existing row (matched on the Booking ID column) in
 * the "Bookings" tab. Never appends: bookings that were never in the sheet
 * (e.g. the 2024/2025 bulk upload) are reported as not found. Never throws.
 */
export async function updateBookingInSheet(
  b: BookingSheetSource,
): Promise<{ ok: boolean; notFound?: boolean; note?: string }> {
  const bookingId = sheetBookingId(b);
  if (!bookingId) return { ok: false, note: "booking has no Booking ID" };
  const { data, error } = await invokeWithTimeout<{
    ok?: boolean;
    error?: string;
    notFound?: boolean;
  }>(
    "sync-booking-to-sheet",
    { action: "update", booking_id: bookingId, values: bookingSheetValues(b) },
    WRITE_TIMEOUT_MS,
  );
  if (error) return { ok: false, note: error };
  if (data?.ok) return { ok: true };
  return { ok: false, notFound: !!data?.notFound, note: data?.error || "sheet not connected" };
}
