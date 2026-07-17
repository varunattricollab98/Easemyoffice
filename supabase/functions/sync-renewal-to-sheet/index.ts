// Forwards a new renewal booking to a Google Apps Script Web App, which appends
// it as a row in the RENEWAL Google Sheet. One-way sync: CRM -> Sheet.
//
// Required Edge Function secrets (Supabase -> Edge Functions -> Secrets):
//   RENEWAL_SHEET_WEBHOOK_URL -> the Apps Script Web App URL for the renewal sheet
//   RENEWAL_SHEET_TOKEN       -> a shared secret; must match TOKEN in the Apps Script
//
// If these secrets are not set, the function returns ok:false gracefully (the
// renewal booking is still saved to the database — sheet sync is best-effort).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WEBHOOK_URL = Deno.env.get("RENEWAL_SHEET_WEBHOOK_URL");
const TOKEN = Deno.env.get("RENEWAL_SHEET_TOKEN") ?? "";

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
      return json({ ok: false, skipped: true, error: "Renewal sheet not connected yet." });
    }

    const { values } = await req.json().catch(() => ({}));
    if (!Array.isArray(values)) throw new Error("A 'values' array (the row) is required.");

    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TOKEN, values }),
      redirect: "follow",
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Sheet responded ${res.status}: ${text.slice(0, 200)}`);

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message });
  }
});
