// Reads booking configuration from the Google Apps Script Web App:
//   - nextBookingId : the next unused ID from your "BookingIDs" sheet
//   - plans         : the plans master list from your "Plans" sheet
//
// The caller passes { action } to choose how much work the sheet has to do:
//   "plans"     -> plans only (cached in Apps Script, fast)
//   "bookingid" -> next Booking ID only (scans the bookings column, ~2s)
//   "config"    -> both (default; what older clients send)
//
// Uses the same secrets as the booking sync:
//   BOOKINGS_SHEET_WEBHOOK_URL, BOOKINGS_SHEET_TOKEN
// The Apps Script must implement doGet (see setup/apps-script-code.gs).
// An Apps Script that predates the `action` parameter simply ignores it and
// returns both fields, so this stays compatible with an old deployment.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WEBHOOK_URL = Deno.env.get("BOOKINGS_SHEET_WEBHOOK_URL");
const TOKEN = Deno.env.get("BOOKINGS_SHEET_TOKEN") ?? "";

// Apps Script needs a couple of seconds normally but can stall indefinitely.
// Without this the request hangs and the booking form spins forever.
const FETCH_TIMEOUT_MS = 12_000;

const ALLOWED_ACTIONS = ["plans", "bookingid", "config"] as const;

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (!WEBHOOK_URL) return json({ ok: false, error: "Google Sheet not connected yet." });

    const body = await req.json().catch(() => ({}));
    const requested = typeof body?.action === "string" ? body.action.toLowerCase() : "config";
    const action = (ALLOWED_ACTIONS as readonly string[]).includes(requested) ? requested : "config";

    const url = `${WEBHOOK_URL}?action=${encodeURIComponent(action)}&token=${encodeURIComponent(TOKEN)}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow", // Apps Script /exec redirects once before responding
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (e) {
      const name = (e as Error).name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new Error(`Sheet did not respond within ${FETCH_TIMEOUT_MS / 1000}s`);
      }
      throw new Error(`Could not reach the sheet: ${(e as Error).message}`);
    }

    const text = await res.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Usually an HTML page: the deployment needs re-authorising, or the
      // "Who has access" setting is no longer "Anyone".
      throw new Error(`Bad response from sheet [${res.status}]: ${text.slice(0, 150)}`);
    }
    if (parsed.ok === false) throw new Error(String(parsed.error ?? "Sheet rejected the request"));

    return json({
      ok: true,
      action,
      nextBookingId: parsed.nextBookingId ?? null,
      plans: parsed.plans ?? [],
      // Per-part failures from doGet, so one broken half never hides the other.
      plansError: parsed.plansError ?? null,
      bookingIdError: parsed.bookingIdError ?? null,
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message });
  }
});
