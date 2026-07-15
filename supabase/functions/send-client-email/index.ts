// Sends a one-off client-facing email from the CRM via Resend.
// Called from the browser via supabase.functions.invoke("send-client-email", { body }).
// Supabase verifies the caller's JWT automatically, so only logged-in users can send.
//
// Required Edge Function secrets (set in Supabase -> Edge Functions -> Secrets):
//   RESEND_API_KEY   -> your Resend API key
//   CRM_FROM_EMAIL   -> e.g. "EaseMyOffice <crm@easemyoffice.in>" (must be a
//                        verified domain in Resend to email real clients)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL =
  Deno.env.get("CRM_FROM_EMAIL") ??
  Deno.env.get("REPORTS_FROM_EMAIL") ??
  "EaseMyOffice CRM <onboarding@resend.dev>";
// Optional: BCC a copy of every send here (e.g. your shared inbox) so sent
// mail is visible in Gmail and replies thread there.
const BCC_EMAIL = Deno.env.get("CRM_BCC_EMAIL") ?? "";

function isEmail(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const at = v.indexOf("@");
  const dot = v.lastIndexOf(".");
  return at > 0 && dot > at + 1 && dot < v.length - 1 && v.indexOf(" ") === -1;
}

// Accept a single address, a comma-separated string, or an array — return valid emails.
function toEmailList(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : String(v ?? "").split(",");
  return raw.map((s) => String(s).trim()).filter(isEmail);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (req.method !== "POST") throw new Error("Use POST");
    const { to, subject, html, text, replyTo, cc, bcc, attachments } = await req.json().catch(() => ({}));

    const toList = toEmailList(to);
    if (!toList.length) throw new Error("A valid recipient email ('to') is required.");
    if (!subject || typeof subject !== "string") throw new Error("A subject is required.");
    if ((!html || typeof html !== "string") && (!text || typeof text !== "string"))
      throw new Error("An email body is required.");
    if (!RESEND_API_KEY)
      throw new Error("Email is not configured yet. Add RESEND_API_KEY in Supabase Edge Function secrets.");

    const payload: Record<string, unknown> = { from: FROM_EMAIL, to: toList, subject };
    if (html) payload.html = html;
    if (text) payload.text = text;
    if (isEmail(replyTo)) payload.reply_to = replyTo;
    if (isEmail(cc)) payload.cc = [cc];
    const bccList = [...toEmailList(bcc), ...toEmailList(BCC_EMAIL)];
    if (bccList.length) payload.bcc = Array.from(new Set(bccList));
    if (Array.isArray(attachments) && attachments.length) {
      payload.attachments = attachments
        .filter((a: any) => a && a.filename && a.path)
        .map((a: any) => ({ filename: a.filename, path: a.path }));
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const bodyText = await res.text();
    if (!res.ok) {
      // Surface Resend's error message so the UI can show something useful.
      throw new Error(`Email provider rejected the send (${res.status}): ${bodyText}`);
    }

    let id: string | null = null;
    try { id = JSON.parse(bodyText)?.id ?? null; } catch { /* ignore */ }

    return new Response(JSON.stringify({ ok: true, id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    // Return 200 with an ok:false flag so the browser client can read the
    // actual error message (Supabase's invoke() hides the body on non-2xx).
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
