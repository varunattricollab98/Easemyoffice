// Bridges the CRM to the shared Gmail (contact@easemyoffice.in) Apps Script.
//   { action: "inbox" }                       -> recent lead emails
//   { action: "claim", threadId, label }      -> label the thread + mark read
//
// Secrets (Supabase -> Edge Functions -> Secrets):
//   GMAIL_WEBHOOK_URL  -> the Gmail Apps Script Web App /exec URL
//   GMAIL_TOKEN        -> shared secret; must match TOKEN in the Apps Script

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WEBHOOK_URL = Deno.env.get("GMAIL_WEBHOOK_URL");
const TOKEN = Deno.env.get("GMAIL_TOKEN") ?? "";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (!WEBHOOK_URL) return json({ ok: false, error: "Gmail inbox not connected yet." });
    const body = await req.json().catch(() => ({} as any));
    const action = body.action || "inbox";

    if (action === "inbox") {
      const max = Math.min(Number(body.max) || 30, 60);
      const url = `${WEBHOOK_URL}?action=inbox&max=${max}&token=${encodeURIComponent(TOKEN)}`;
      const res = await fetch(url, { method: "GET", redirect: "follow" });
      const text = await res.text();
      let parsed: any = {};
      try { parsed = JSON.parse(text); } catch { throw new Error(`Bad response from Gmail: ${text.slice(0, 150)}`); }
      if (parsed.ok === false) throw new Error(parsed.error || "Gmail rejected the request");
      return json({ ok: true, emails: parsed.emails ?? [] });
    }

    if (action === "thread") {
      if (!body.threadId) throw new Error("threadId is required");
      const url = `${WEBHOOK_URL}?action=thread&threadId=${encodeURIComponent(body.threadId)}&token=${encodeURIComponent(TOKEN)}`;
      const res = await fetch(url, { method: "GET", redirect: "follow" });
      const text = await res.text();
      let parsed: any = {};
      try { parsed = JSON.parse(text); } catch { throw new Error(`Bad response from Gmail: ${text.slice(0, 150)}`); }
      if (!parsed.ok) throw new Error(parsed.error || "Could not load email");
      return json({ ok: true, subject: parsed.subject, url: parsed.url, messages: parsed.messages ?? [] });
    }

    if (action === "claim") {
      if (!body.threadId) throw new Error("threadId is required");
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN, action: "claim", threadId: body.threadId, label: body.label }),
        redirect: "follow",
      });
      const text = await res.text();
      let parsed: any = {};
      try { parsed = JSON.parse(text); } catch { throw new Error(`Bad response from Gmail: ${text.slice(0, 150)}`); }
      if (!parsed.ok) throw new Error(parsed.error || "Could not label the email");
      return json({ ok: true });
    }

    throw new Error("Unknown action");
  } catch (e) {
    return json({ ok: false, error: (e as Error).message });
  }
});
