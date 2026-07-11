// Forwards a new booking to a Google Apps Script Web App, which appends it as a
// row in your Google Sheet. One-way sync: CRM -> Sheet.
//
// Required Edge Function secrets (Supabase -> Edge Functions -> Secrets):
//   BOOKINGS_SHEET_WEBHOOK_URL -> the Apps Script Web App URL (ends in /exec)
//   BOOKINGS_SHEET_TOKEN       -> a shared secret; must match the TOKEN in the
//                                 Apps Script (prevents random posts to your sheet)
//
// Supabase verifies the caller's JWT automatically, so only logged-in CRM users
// can trigger a sync.

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
      // Not configured yet — treat as a no-op so booking saving is never blocked.
      return json({ ok: false, skipped: true, error: "Google Sheet not connected yet." });
    }

    const { values } = await req.json().catch(() => ({}));
    if (!Array.isArray(values)) throw new Error("A 'values' array (the row) is required.");

    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TOKEN, values }),
      redirect: "follow", // Apps Script /exec redirects once before responding
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Sheet responded ${res.status}: ${text.slice(0, 200)}`);

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message });
  }
});
