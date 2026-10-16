// Forwards a new booking to a Google Apps Script Web App, which appends it as a
// row in your Google Sheet. One-way sync: CRM -> Sheet.
//
// Body: { values }                                   -> append a new row
//       { action: "update", booking_id, values }     -> overwrite the row whose
//         Booking ID matches (admin edits). Needs the updated Apps Script
//         (setup/apps-script-code.gs); older scripts just append.
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

    const { values, action, booking_id } = await req.json().catch(() => ({}));
    if (!Array.isArray(values)) throw new Error("A 'values' array (the row) is required.");
    const isUpdate = action === "update";
    if (isUpdate && (typeof booking_id !== "string" || !booking_id.trim())) {
      throw new Error("booking_id is required for an update.");
    }

    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isUpdate ? { token: TOKEN, values, action: "update", booking_id } : { token: TOKEN, values },
      ),
      redirect: "follow", // Apps Script /exec redirects once before responding
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Sheet responded ${res.status}: ${text.slice(0, 200)}`);

    // Pass the Apps Script verdict through (an update can report notFound).
    let script: { ok?: boolean; error?: string; notFound?: boolean } = {};
    try {
      script = JSON.parse(text);
    } catch {
      /* older script / non-JSON body: treat as success */
    }
    if (script.ok === false) return json({ ok: false, error: script.error, notFound: !!script.notFound });
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message });
  }
});
