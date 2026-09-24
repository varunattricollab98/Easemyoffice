// Instant new-lead alerts — cuts the "keep refreshing the CRM" dependency.
//
// Runs every ~15 minutes (pg_cron). For leads created recently that haven't
// been alerted yet (first_alert_sent_at IS NULL):
//   • ASSIGNED lead   -> emails the owning salesperson: "new lead, act now".
//   • UNASSIGNED lead -> collected into one summary to LEADS_ADMIN_EMAIL so a
//                        manager assigns it before it goes cold.
// Every alerted lead is stamped with first_alert_sent_at so it's never
// re-alerted. Speed-to-lead drives conversion, so pushing beats polling.
//
// Required Edge Function secrets:
//   RESEND_API_KEY     -> Resend API key
//   CRM_FROM_EMAIL     -> sender address (e.g. "EaseMyOffice <crm@easemyoffice.in>")
//   CRON_SECRET        -> shared secret for auth
//   LEADS_ADMIN_EMAIL  -> (optional) where the unassigned-leads summary is sent
//   CRM_APP_URL        -> (optional) base URL for deep links (e.g. https://crm.easemyoffice.in)
//   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("CRM_FROM_EMAIL") ?? "EaseMyOffice CRM <onboarding@resend.dev>";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const LEADS_ADMIN_EMAIL = Deno.env.get("LEADS_ADMIN_EMAIL") ?? "";
const APP_URL = (Deno.env.get("CRM_APP_URL") ?? "").replace(/\/$/, "");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Only alert leads created within this many hours (avoids blasting a backlog of
// old NULL-first_alert_sent_at leads the first time this runs).
const LOOKBACK_HOURS = 24;

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

interface LeadRow {
  id: string;
  lead_code: string | null;
  client_name: string | null;
  company_name: string | null;
  mobile: string | null;
  email: string | null;
  source: string | null;
  assigned_to: string | null;
  created_at: string;
}

function contactLine(l: LeadRow): string {
  const bits = [l.mobile, l.email].filter(Boolean).map(esc);
  return bits.length ? bits.join(" · ") : "—";
}

function assignedEmailHtml(firstName: string, l: LeadRow): string {
  const deepLink = APP_URL ? `${APP_URL}/leads/${l.id}` : "";
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto">
      <div style="background:#1e40af;padding:20px 24px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;color:#fff;font-size:18px">🌟 New Lead Assigned to You</h2>
      </div>
      <div style="padding:24px;background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
        <p style="margin:0 0 16px;font-size:15px;color:#334155">
          ${esc(firstName)}, a new lead just landed in your queue. Leads contacted within minutes convert far better — reach out now.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e2e8f0;border-radius:6px">
          <tr><td style="padding:8px 12px;color:#64748b;border-bottom:1px solid #eef2f7">Name</td><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #eef2f7">${esc(l.client_name || "—")}</td></tr>
          <tr><td style="padding:8px 12px;color:#64748b;border-bottom:1px solid #eef2f7">Company</td><td style="padding:8px 12px;border-bottom:1px solid #eef2f7">${esc(l.company_name || "—")}</td></tr>
          <tr><td style="padding:8px 12px;color:#64748b;border-bottom:1px solid #eef2f7">Contact</td><td style="padding:8px 12px;border-bottom:1px solid #eef2f7">${contactLine(l)}</td></tr>
          <tr><td style="padding:8px 12px;color:#64748b">Source</td><td style="padding:8px 12px">${esc(l.source || "—")}</td></tr>
        </table>
        ${deepLink ? `<p style="margin:20px 0 0"><a href="${deepLink}" style="background:#1e40af;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:6px;display:inline-block">Open lead →</a></p>` : ""}
        <p style="margin:16px 0 0;font-size:12px;color:#94a3b8">Automated alert from EaseMyOffice CRM.</p>
      </div>
    </div>
  `;
}

function unassignedEmailHtml(rows: LeadRow[]): string {
  const count = rows.length;
  const tableRows = rows
    .map(
      (l) => `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${esc(l.client_name || "—")}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${esc(l.company_name || "—")}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${contactLine(l)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${esc(l.source || "—")}</td>
      </tr>`,
    )
    .join("");
  const deepLink = APP_URL ? `${APP_URL}/inbox` : "";
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto">
      <div style="background:#b45309;padding:20px 24px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;color:#fff;font-size:18px">📥 ${count} Unassigned Lead${count > 1 ? "s" : ""} Waiting</h2>
      </div>
      <div style="padding:24px;background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
        <p style="margin:0 0 16px;font-size:15px;color:#334155">
          ${count} new lead${count > 1 ? "s have" : " has"} come in without an owner. Assign ${count > 1 ? "them" : "it"} to a rep so ${count > 1 ? "they don't" : "it doesn't"} go cold.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e2e8f0;border-radius:6px">
          <thead><tr style="background:#f8fafc">
            <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0">Name</th>
            <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0">Company</th>
            <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0">Contact</th>
            <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0">Source</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
        ${deepLink ? `<p style="margin:20px 0 0"><a href="${deepLink}" style="background:#b45309;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:6px;display:inline-block">Open Lead Inbox →</a></p>` : ""}
        <p style="margin:16px 0 0;font-size:12px;color:#94a3b8">Automated alert from EaseMyOffice CRM.</p>
      </div>
    </div>
  `;
}

async function sendEmail(to: string, subject: string, html: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
    });
    if (!res.ok) return `${to}: Resend ${res.status} — ${await res.text()}`;
    return null;
  } catch (e) {
    return `${to}: ${(e as Error).message}`;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth (secret in body or x-cron-secret header)
    let bodySecret = "";
    try { bodySecret = (await req.json())?.secret ?? ""; } catch { /* no body */ }
    const headerSecret = req.headers.get("x-cron-secret") ?? "";
    if (!CRON_SECRET || (bodySecret !== CRON_SECRET && headerSecret !== CRON_SECRET)) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    if (!RESEND_API_KEY) return json({ ok: false, error: "RESEND_API_KEY not set" }, 200);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Recently-created leads that haven't been alerted yet.
    const since = new Date(Date.now() - LOOKBACK_HOURS * 3600_000).toISOString();
    const { data: leads, error } = await supabase
      .from("leads")
      .select("id, lead_code, client_name, company_name, mobile, email, source, assigned_to, created_at")
      .is("first_alert_sent_at", null)
      .gte("created_at", since)
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);
    if (!leads || leads.length === 0) {
      return json({ ok: true, message: "No new leads to alert", alerted: 0 });
    }

    const rows = leads as LeadRow[];

    // Profiles for name + email lookup (assigned alerts).
    const { data: profiles } = await supabase.from("profiles").select("id, full_name, email");
    const profileMap = new Map(
      (profiles ?? []).map((p: { id: string; full_name: string | null; email: string | null }) => [p.id, p]),
    );

    const errors: string[] = [];
    let alerted = 0;
    const stampedIds: string[] = [];

    // 1) Assigned leads -> notify each owner individually.
    const assigned = rows.filter((l) => l.assigned_to);
    for (const lead of assigned) {
      const profile = profileMap.get(lead.assigned_to as string);
      // Even if we can't email (no profile/email), stamp it so we don't retry forever.
      stampedIds.push(lead.id);
      if (!profile?.email) continue;
      const firstName = (profile.full_name ?? "").split(" ")[0] || "Hi";
      const err = await sendEmail(
        profile.email,
        `🌟 New lead assigned: ${lead.client_name || "New enquiry"}`,
        assignedEmailHtml(firstName, lead),
      );
      if (err) errors.push(err);
      else alerted++;
    }

    // 2) Unassigned leads -> one summary to the leads admin (if configured).
    const unassigned = rows.filter((l) => !l.assigned_to);
    if (unassigned.length > 0) {
      if (LEADS_ADMIN_EMAIL) {
        const err = await sendEmail(
          LEADS_ADMIN_EMAIL,
          `📥 ${unassigned.length} unassigned lead${unassigned.length > 1 ? "s" : ""} waiting`,
          unassignedEmailHtml(unassigned),
        );
        if (err) errors.push(err);
        else alerted++;
        // Stamp regardless of send outcome so the summary isn't repeated every run.
        for (const l of unassigned) stampedIds.push(l.id);
      }
      // If no admin email is set, DO NOT stamp — leave them so they're picked up
      // once LEADS_ADMIN_EMAIL is configured.
    }

    // Mark everything we've handled so it's never alerted again.
    if (stampedIds.length > 0) {
      const { error: upErr } = await supabase
        .from("leads")
        .update({ first_alert_sent_at: new Date().toISOString() })
        .in("id", stampedIds);
      if (upErr) errors.push(`stamp: ${upErr.message}`);
    }

    return json({
      ok: true,
      newLeads: rows.length,
      assigned: assigned.length,
      unassigned: unassigned.length,
      emailsSent: alerted,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 200);
  }
});
