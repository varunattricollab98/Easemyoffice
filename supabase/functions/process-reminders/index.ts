// Sends any scheduled client reminders whose send_at has passed, via Resend.
// Triggered every 2 minutes by pg_cron (see setup/SCHEDULE_REMINDERS_CRON.sql).
//
// ─── RATE LIMITING ───────────────────────────────────────────────────────────
// To prevent bulk-sending that could get our domain/IP blocked:
//   • MAX 1 email per invocation (cron fires every 2 min → natural 2-min gap)
//   • MAX 50 emails per rolling hour (checked before sending)
// If the hourly cap is reached, the function exits early; remaining reminders
// will be picked up once the window slides.
// ─────────────────────────────────────────────────────────────────────────────
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
const BCC_EMAIL = Deno.env.get("CRM_BCC_EMAIL") ?? "";

// ─── Rate Limit Configuration ────────────────────────────────────────────────
// Max emails to send per single invocation (cron runs every 2 min, so this
// naturally enforces a 2-minute minimum gap between consecutive emails).
const MAX_PER_INVOCATION = 1;
// Max emails allowed in a rolling 60-minute window.
const MAX_PER_HOUR = 50;
// ─────────────────────────────────────────────────────────────────────────────

// Invisible marker embedded in every CRM-sent email (hidden-preheader style,
// which Gmail indexes for its preview snippet). Set a Gmail filter
// (Has the words: EMO-CRM-SENT) to reliably label these as "CRM-Sent" — call
// notifications and inbound leads never contain it, so they won't be mislabelled.
const CRM_MARKER = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">EMO-CRM-SENT</div>`;

// Split a single/comma-separated recipient string into a clean list.
function recipients(v: unknown): string[] {
  return String(v ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Allow a per-reminder sender override (e.g. renewals@easemyoffice.in), but
// only for our own verified domain so it can't be abused. Accepts a bare
// address or a "Display Name <addr@easemyoffice.in>" form.
function safeFrom(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const m = v.match(/<([^>]+)>/);
  const addr = (m ? m[1] : v).trim().toLowerCase();
  const at = addr.indexOf("@");
  return at > 0 && addr.endsWith("@easemyoffice.in") ? v.trim() : null;
}

async function sendEmail(toList: string[], subject: string, message: string, isHtml: boolean, attachments: { filename: string; path: string }[], fromOverride?: unknown) {
  // Rich HTML bodies are sent as-is; plain ones are wrapped with pre-wrap so
  // typed line breaks survive (no newline regex, which breaks on copy-paste).
  const bodyHtml = isHtml
    ? message
    : `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;white-space:pre-wrap;color:#0f172a">${esc(message)}</div>`;
  const html = bodyHtml + CRM_MARKER;
  const from = safeFrom(fromOverride) ?? FROM_EMAIL;
  const payload: Record<string, unknown> = { from, to: toList, subject, html };
  if (!isHtml) payload.text = message;
  if (BCC_EMAIL) payload.bcc = [BCC_EMAIL];
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

    // ─── RATE LIMIT CHECK: Hourly cap ──────────────────────────────────────────
    // Count how many reminders were successfully sent in the last 60 minutes.
    // If we've hit MAX_PER_HOUR, exit early — the queue will drain as the
    // rolling window advances.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: sentLastHour, error: countErr } = await supabase
      .from("reminders")
      .select("id", { count: "exact", head: true })
      .gte("sent_at", oneHourAgo)
      .not("sent_at", "is", null);

    if (countErr) throw new Error(`Rate limit check failed: ${countErr.message}`);

    const hourlyUsed = sentLastHour ?? 0;
    const remaining = Math.max(0, MAX_PER_HOUR - hourlyUsed);

    if (remaining === 0) {
      return json({
        ok: true,
        processed: 0,
        sent: 0,
        failed: 0,
        skipped_reason: `Hourly limit reached (${MAX_PER_HOUR}/hr). Will resume when window slides.`,
      });
    }
    // ────────────────────────────────────────────────────────────────────────────

    // Fetch only as many reminders as we're allowed to send this invocation.
    // MAX_PER_INVOCATION = 1 ensures a natural 2-minute gap (cron interval).
    const batchSize = Math.min(MAX_PER_INVOCATION, remaining);

    const { data: due, error } = await supabase
      .from("reminders")
      .select("id, to_email, subject, message, send_at, repeat_interval_days, repeat_until, occurrences_sent, is_html, attachments, from_email")
      .eq("status", "scheduled")
      .lte("send_at", nowIso)
      .order("send_at", { ascending: true })
      .limit(batchSize);
    if (error) throw new Error(error.message);

    if (!due || due.length === 0) {
      return json({ ok: true, processed: 0, sent: 0, failed: 0 });
    }

    const DAY = 86400000;
    let sent = 0, failed = 0;
    for (const r of due) {
      try {
        // Turn stored attachment paths into signed URLs Resend can fetch.
        const attList: { filename: string; path: string }[] = [];
        for (const a of (r.attachments ?? []) as any[]) {
          if (!a?.path || !a?.name) continue;
          const { data: signed } = await supabase.storage.from("reminder-attachments").createSignedUrl(a.path, 3600);
          if (signed?.signedUrl) attList.push({ filename: a.name, path: signed.signedUrl });
        }
        await sendEmail(recipients(r.to_email), r.subject, r.message, !!r.is_html, attList, r.from_email);
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

    return json({
      ok: true,
      processed: due.length,
      sent,
      failed,
      hourly_used: hourlyUsed + sent,
      hourly_remaining: remaining - sent,
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 200);
  }
});
