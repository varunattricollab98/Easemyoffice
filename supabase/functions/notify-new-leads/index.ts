// Instant new-lead alerts — IN-CRM notifications (no per-user email needed).
//
// Runs every ~15 minutes (pg_cron). For leads created recently that haven't
// been alerted yet (first_alert_sent_at IS NULL):
//   • ASSIGNED lead   -> one in-CRM notification to the owning salesperson.
//   • UNASSIGNED lead -> an in-CRM notification to EVERY user:
//                        "New lead arrived — claim as yours".
// These land in the app's notifications bell (no email dependency), so the
// team is nudged the moment a lead comes in. Every alerted lead is stamped
// with first_alert_sent_at so it's never re-alerted (prevents flooding).
//
// Email is OFF by default. It only sends per-rep emails when the edge secret
// LEADS_ALERT_EMAIL_ENABLED = "true" AND profiles have correct emails.
//
// Required Edge Function secrets:
//   CRON_SECRET  -> shared secret for auth
//   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected)
// Optional (email path, default off):
//   LEADS_ALERT_EMAIL_ENABLED -> "true" to also email assigned reps
//   RESEND_API_KEY, CRM_FROM_EMAIL, LEADS_ADMIN_EMAIL, CRM_APP_URL

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Email path is opt-in only (kept off so the CRM never bombards inboxes while
// profiles lack correct individual emails).
const EMAIL_ENABLED = (Deno.env.get("LEADS_ALERT_EMAIL_ENABLED") ?? "").toLowerCase() === "true";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("CRM_FROM_EMAIL") ?? "EaseMyOffice CRM <onboarding@resend.dev>";
const LEADS_ADMIN_EMAIL = Deno.env.get("LEADS_ADMIN_EMAIL") ?? "";
const APP_URL = (Deno.env.get("CRM_APP_URL") ?? "").replace(/\/$/, "");

// Only alert leads created within this many hours (avoids blasting a backlog of
// old NULL-first_alert_sent_at leads the first time this runs).
const LOOKBACK_HOURS = 24;

// Hard cap on how many leads one run will process, as a flood safety-net even
// if something upstream misbehaves.
const MAX_PER_RUN = 40;

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

function contactBits(l: LeadRow): string {
  const bits = [l.client_name, l.company_name].filter(Boolean).join(" · ");
  return bits || l.mobile || "New enquiry";
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

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Recently-created leads that haven't been alerted yet.
    const since = new Date(Date.now() - LOOKBACK_HOURS * 3600_000).toISOString();
    const { data: leads, error } = await supabase
      .from("leads")
      .select("id, lead_code, client_name, company_name, mobile, email, source, assigned_to, created_at")
      .is("first_alert_sent_at", null)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(MAX_PER_RUN);

    if (error) throw new Error(error.message);
    if (!leads || leads.length === 0) {
      return json({ ok: true, message: "No new leads to alert", alerted: 0 });
    }

    const rows = leads as LeadRow[];
    const notes: string[] = [];

    // Build in-CRM notification rows.
    const notifRows: Array<{
      user_id: string;
      type: string;
      title: string;
      body: string;
      lead_id: string | null;
    }> = [];

    // 1) Assigned leads -> one notification to the owner.
    const assigned = rows.filter((l) => l.assigned_to);
    for (const lead of assigned) {
      notifRows.push({
        user_id: lead.assigned_to as string,
        type: "new_lead_assigned",
        title: "New lead assigned to you",
        body: `${contactBits(lead)} — reach out soon.`,
        lead_id: lead.id,
      });
    }

    // 2) Unassigned leads -> notify EVERY user to claim.
    const unassigned = rows.filter((l) => !l.assigned_to);
    if (unassigned.length > 0) {
      const { data: everyone } = await supabase.from("profiles").select("id");
      const userIds = (everyone ?? []).map((p) => (p as { id: string }).id);
      for (const lead of unassigned) {
        for (const uid of userIds) {
          notifRows.push({
            user_id: uid,
            type: "new_lead_unclaimed",
            title: "New lead arrived — claim as yours",
            body: `${contactBits(lead)} is unassigned. Open the Lead Inbox to claim it.`,
            lead_id: lead.id,
          });
        }
      }
    }

    if (notifRows.length > 0) {
      const { error: nErr } = await supabase.from("notifications").insert(notifRows);
      if (nErr) throw new Error(`notifications insert: ${nErr.message}`);
    }
    notes.push(`in-CRM notifications: ${notifRows.length}`);

    // 3) OPTIONAL email path (off unless LEADS_ALERT_EMAIL_ENABLED = "true").
    let emailsSent = 0;
    const emailErrors: string[] = [];
    if (EMAIL_ENABLED && RESEND_API_KEY) {
      const { data: profiles } = await supabase.from("profiles").select("id, full_name, email");
      const pMap = new Map(
        (profiles ?? []).map((p: { id: string; full_name: string | null; email: string | null }) => [p.id, p]),
      );
      for (const lead of assigned) {
        const prof = pMap.get(lead.assigned_to as string);
        if (!prof?.email) continue;
        const first = (prof.full_name ?? "").split(" ")[0] || "Hi";
        const link = APP_URL ? `${APP_URL}/leads/${lead.id}` : "";
        const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#334155">
          <p>${esc(first)}, a new lead was assigned to you:</p>
          <p><strong>${esc(contactBits(lead))}</strong>${lead.mobile ? " · " + esc(lead.mobile) : ""}</p>
          ${link ? `<p><a href="${link}">Open lead →</a></p>` : ""}
        </div>`;
        const err = await sendEmail(prof.email, `New lead: ${lead.client_name || "enquiry"}`, html);
        if (err) emailErrors.push(err);
        else emailsSent++;
      }
      if (unassigned.length > 0 && LEADS_ADMIN_EMAIL) {
        const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#334155">
          <p>${unassigned.length} new unassigned lead(s) waiting to be claimed.</p>
        </div>`;
        const err = await sendEmail(LEADS_ADMIN_EMAIL, `${unassigned.length} unassigned lead(s)`, html);
        if (err) emailErrors.push(err);
        else emailsSent++;
      }
    }

    // Stamp every handled lead so it's never alerted again.
    const stampedIds = rows.map((l) => l.id);
    const { error: upErr } = await supabase
      .from("leads")
      .update({ first_alert_sent_at: new Date().toISOString() })
      .in("id", stampedIds);
    if (upErr) notes.push(`stamp error: ${upErr.message}`);

    return json({
      ok: true,
      newLeads: rows.length,
      assigned: assigned.length,
      unassigned: unassigned.length,
      notificationsCreated: notifRows.length,
      emailsSent,
      emailErrors: emailErrors.length ? emailErrors : undefined,
      notes,
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 200);
  }
});
