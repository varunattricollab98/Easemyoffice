// Forwards a new renewal booking to the Google Apps Script Web App, which
// appends it to the "Renewals" subsheet in the same Google Sheet used for
// sales bookings. One-way sync: CRM -> Sheet.
//
// Uses the SAME secrets as the sales booking sync:
//   BOOKINGS_SHEET_WEBHOOK_URL -> the Apps Script Web App URL (ends in /exec)
//   BOOKINGS_SHEET_TOKEN       -> shared secret
//
// The difference: this sends { sheet: "Renewals" } so the Apps Script writes
// to the "Renewals" tab instead of the default "Bookings" tab.

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
    if (req.method !== "POST") throw new Error("Use POST");
    if (!WEBHOOK_URL) {
      return json({ ok: false, skipped: true, error: "Google Sheet not connected yet." });
    }

    const { values } = await req.json().catch(() => ({}));
    if (!Array.isArray(values)) throw new Error("A 'values' array (the row) is required.");

    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TOKEN, values, sheet: "Renewals" }),
      redirect: "follow",
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Sheet responded ${res.status}: ${text.slice(0, 200)}`);

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message });
  }
});
