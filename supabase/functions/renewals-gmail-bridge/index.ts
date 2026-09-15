// Bridges the CRM to the RENEWALS Gmail (renewals@easemyoffice.in) Apps Script.
// Identical in shape to gmail-bridge (the sales contact@ mailbox), but reads its
// OWN secrets so the two mailboxes stay separate. Supabase edge-function secrets
// are project-global by name, so a second mailbox MUST use distinct names.
//
//   { action: "inbox" }                  -> recent lead emails
//   { action: "tagged", max?, start? }   -> ALL "<Name> lead"-labelled threads
//   { action: "thread", threadId }       -> full text of one thread
//   { action: "claim", threadId, label } -> label the thread + mark read
//
// Secrets (Supabase -> Edge Functions -> Secrets):
//   RENEWALS_GMAIL_WEBHOOK_URL -> the renewals@ Apps Script Web App /exec URL
//   RENEWALS_GMAIL_TOKEN       -> shared secret; must match TOKEN in that Apps Script

import { gmailFetchJson } from "../_shared/gmail-fetch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WEBHOOK_URL = Deno.env.get("RENEWALS_GMAIL_WEBHOOK_URL");
const TOKEN = Deno.env.get("RENEWALS_GMAIL_TOKEN") ?? "";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (!WEBHOOK_URL) return json({ ok: false, error: "Renewals Gmail inbox not connected yet." });
    const body = await req.json().catch(() => ({} as any));
    const action = body.action || "inbox";

    if (action === "inbox") {
      const max = Math.min(Number(body.max) || 40, 100);
      const start = Math.max(Number(body.start) || 0, 0);
      const url = `${WEBHOOK_URL}?action=inbox&max=${max}&start=${start}&token=${encodeURIComponent(TOKEN)}`;
      const result = await gmailFetchJson(url);
      if (!result.ok) throw new Error(result.error);
      const parsed = result.data;
      if (parsed.ok === false) throw new Error(parsed.error || "Gmail rejected the request");
      const emails = parsed.emails ?? [];
      return json({ ok: true, emails, hasMore: parsed.hasMore ?? emails.length >= max, start });
    }

    if (action === "tagged") {
      const max = Math.min(Number(body.max) || 25, 100);
      const start = Math.max(Number(body.start) || 0, 0);
      const url = `${WEBHOOK_URL}?action=tagged&max=${max}&start=${start}&token=${encodeURIComponent(TOKEN)}`;
      const result = await gmailFetchJson(url);
      if (!result.ok) throw new Error(result.error);
      const parsed = result.data;
      if (parsed.ok === false) throw new Error(parsed.error || "Gmail rejected the request");
      const emails = parsed.emails ?? [];
      return json({ ok: true, emails, hasMore: parsed.hasMore ?? emails.length >= max, start });
    }

    if (action === "thread") {
      if (!body.threadId) throw new Error("threadId is required");
      const url = `${WEBHOOK_URL}?action=thread&threadId=${encodeURIComponent(body.threadId)}&token=${encodeURIComponent(TOKEN)}`;
      const result = await gmailFetchJson(url);
      if (!result.ok) throw new Error(result.error);
      const parsed = result.data;
      if (!parsed.ok) throw new Error(parsed.error || "Could not load email");
      return json({ ok: true, subject: parsed.subject, url: parsed.url, messages: parsed.messages ?? [] });
    }

    if (action === "claim") {
      if (!body.threadId) throw new Error("threadId is required");
      const result = await gmailFetchJson(WEBHOOK_URL, {
        method: "POST",
        body: { token: TOKEN, action: "claim", threadId: body.threadId, label: body.label },
      });
      if (!result.ok) throw new Error(result.error);
      const parsed = result.data;
      if (!parsed.ok) throw new Error(parsed.error || "Could not label the email");
      return json({ ok: true });
    }

    throw new Error("Unknown action");
  } catch (e) {
    return json({ ok: false, error: (e as Error).message });
  }
});
