// Sends any scheduled client reminders whose send_at has passed, via Resend.
// Triggered every few minutes by pg_cron (see setup/SCHEDULE_REMINDERS_CRON.sql).
//
// Required Edge Function secrets (Supabase -> Edge Functions -> Secrets):
//   RESEND_API_KEY   -> your Resend API key (same one used by send-client-email)
//   CRM_FROM_EMAIL   -> "EaseMyOffice <crm@easemyoffice.in>" (verified domain) —
//                        falls back to onboarding@resend.dev for testing
//   CRON_SECRET      -> a secret word; the cron job must send the same word
//   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL =
  Deno.env.get("CRM_FROM_EMAIL") ??
  Deno.env.get("REPORTS_FROM_EMAIL") ??
  "EaseMyOffice CRM <onboarding@resend.dev>";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function esc(s: unknown) {
  // Build the HTML entities from char codes so no literal "&amp;" text exists
  // in the source (which can get mangled when copy-pasted through chat/markdown).
  const amp = String.fromCharCode(38);
  return String(s ?? "").split(amp).join(amp + "amp;").split("<").join(amp + "lt;").split(">").join(amp + "gt;");
}

async function sendEmail(to: string, subject: string, message: string, isHtml: boolean, attachments: { filename: string; path: string }[]) {
  // Rich HTML bodies are sent as-is; plain ones are wrapped with pre-wrap so
  // typed line breaks survive (no newline regex, which breaks on copy-paste).
  const html = isHtml
    ? message
    : `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;white-space:pre-wrap;color:#0f172a">${esc(message)}</div>`;
  const payload: Record<string, unknown> = { from: FROM_EMAIL, to: [to], subject, html };
  if (!isHtml) payload.text = message;
  if (attachments && attachments.length) payload.attachments = attachments;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Resend ${res.status}: ${body}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // Auth: the cron job must present the shared secret (body.secret or header).
    let bodySecret = "";
    try { bodySecret = (await req.json())?.secret ?? ""; } catch { /* no body */ }
    const headerSecret = req.headers.get("x-cron-secret") ?? "";
    if (!CRON_SECRET || (bodySecret !== CRON_SECRET && headerSecret !== CRON_SECRET)) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    if (!RESEND_API_KEY) return json({ ok: false, error: "RESEND_API_KEY not set" }, 200);
    if (!SUPABASE_URL || !SERVICE_ROLE) return json({ ok: false, error: "Supabase env missing" }, 200);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const nowIso = new Date().toISOString();

    const { data: due, error } = await supabase
      .from("reminders")
      .select("id, to_email, subject, message, send_at, repeat_interval_days, repeat_until, occurrences_sent, is_html, attachments")
      .eq("status", "scheduled")
      .lte("send_at", nowIso)
      .order("send_at", { ascending: true })
      .limit(50);
    if (error) throw new Error(error.message);

    const DAY = 86400000;
    let sent = 0, failed = 0;
    for (const r of due ?? []) {
      try {
        // Turn stored attachment paths into signed URLs Resend can fetch.
        const attList: { filename: string; path: string }[] = [];
        for (const a of (r.attachments ?? []) as any[]) {
          if (!a?.path || !a?.name) continue;
          const { data: signed } = await supabase.storage.from("reminder-attachments").createSignedUrl(a.path, 3600);
          if (signed?.signedUrl) attList.push({ filename: a.name, path: signed.signedUrl });
        }
        await sendEmail(r.to_email, r.subject, r.message, !!r.is_html, attList);
        const occ = (r.occurrences_sent ?? 0) + 1;
        const interval = Number(r.repeat_interval_days ?? 0);

        if (interval > 0) {
          // Advance to the next occurrence strictly in the future.
          let next = new Date(r.send_at).getTime();
          const now = Date.now();
          do { next += interval * DAY; } while (next <= now);
          const untilMs = r.repeat_until ? new Date(r.repeat_until).getTime() : null;

          if (untilMs !== null && next > untilMs) {
            // Recurrence finished.
            await supabase.from("reminders").update({ status: "sent", sent_at: new Date().toISOString(), occurrences_sent: occ, error: null }).eq("id", r.id);
          } else {
            // Keep it scheduled for the next run.
            await supabase.from("reminders").update({ send_at: new Date(next).toISOString(), sent_at: new Date().toISOString(), occurrences_sent: occ, error: null }).eq("id", r.id);
          }
        } else {
          await supabase.from("reminders").update({ status: "sent", sent_at: new Date().toISOString(), occurrences_sent: occ, error: null }).eq("id", r.id);
        }
        sent++;
      } catch (e) {
        await supabase.from("reminders").update({ status: "failed", error: (e as Error).message }).eq("id", r.id);
        failed++;
      }
    }

    return json({ ok: true, processed: (due ?? []).length, sent, failed });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 200);
  }
});
