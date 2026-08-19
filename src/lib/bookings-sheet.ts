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
        timer = setTimeout(() => resolve({ data: null, error: `Timed out after ${took}` }), timeoutMs);
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
// total), and the plan dropdown should never be held up by it. The booking form
// already shows a locally generated fallback ID, so failing here is harmless.
export async function getNextBookingIdFromSheet(): Promise<NextBookingIdResult> {
  const raw = await readSheetConfig("bookingid");
  if (raw.ok === false) return { nextBookingId: null, error: raw.error ?? "Could not reach the sheet" };
  return {
    nextBookingId: raw.nextBookingId ?? null,
    error: raw.bookingIdError ?? null,
  };
}
