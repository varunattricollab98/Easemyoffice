// Reads booking configuration from the Google Apps Script Web App:
//   - nextBookingId : the next unused ID from your "BookingIDs" sheet
//   - plans         : the plans master list from your "Plans" sheet
//
// Uses the same secrets as the booking sync:
//   BOOKINGS_SHEET_WEBHOOK_URL, BOOKINGS_SHEET_TOKEN
// The Apps Script must implement doGet (see setup/apps-script-code.gs).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WEBHOOK_URL = Deno.env.get("BOOKINGS_SHEET_WEBHOOK_URL");
const TOKEN = Deno.env.get("BOOKINGS_SHEET_TOKEN") ?? "";

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
    const url = `${WEBHOOK_URL}?action=config&token=${encodeURIComponent(TOKEN)}`;
    const res = await fetch(url, { method: "GET", redirect: "follow" });
    const text = await res.text();
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch { throw new Error(`Bad response from sheet: ${text.slice(0, 150)}`); }
    if (parsed.ok === false) throw new Error(parsed.error || "Sheet rejected the request");
    return json({ ok: true, nextBookingId: parsed.nextBookingId ?? null, plans: parsed.plans ?? [] });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message });
  }
});
