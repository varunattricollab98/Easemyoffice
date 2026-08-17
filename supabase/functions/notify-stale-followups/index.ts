// Notifies salespeople about leads stuck in the "followups" stage for 4+ days.
// Triggered daily by pg_cron. Groups stale leads by assigned salesperson and
// sends each person a summary email so they remember to act on these leads.
//
// Required Edge Function secrets:
//   RESEND_API_KEY          -> Resend API key
//   CRM_FROM_EMAIL          -> sender address (e.g. "EaseMyOffice <crm@easemyoffice.in>")
//   CRON_SECRET             -> shared secret for auth
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
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// How many days in "followups" stage before we notify the salesperson.
const STALE_DAYS = 4;

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function daysAgo(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth check
    let bodySecret = "";
    try { bodySecret = (await req.json())?.secret ?? ""; } catch { /* no body */ }
    const headerSecret = req.headers.get("x-cron-secret") ?? "";
    if (!CRON_SECRET || (bodySecret !== CRON_SECRET && headerSecret !== CRON_SECRET)) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    if (!RESEND_API_KEY) return json({ ok: false, error: "RESEND_API_KEY not set" }, 200);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Find leads in "followups" stage that have been there for STALE_DAYS+ days
    const staleCutoff = new Date(Date.now() - STALE_DAYS * 86400000).toISOString();

    const { data: staleLeads, error } = await supabase
      .from("leads")
      .select("id, client_name, company_name, mobile, email, assigned_to, last_activity_at, updated_at")
      .in("stage", ["followups", "follow_up"])
      .lt("updated_at", staleCutoff)
      .order("updated_at", { ascending: true });

    if (error) throw new Error(error.message);
    if (!staleLeads || staleLeads.length === 0) {
      return json({ ok: true, message: "No stale follow-ups found", notified: 0 });
    }

    // Get all salesperson profiles for name + email lookup
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email");

    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    // Group stale leads by assigned_to (salesperson)
    const grouped = new Map<string, typeof staleLeads>();
    for (const lead of staleLeads) {
      const assignee = lead.assigned_to ?? "unassigned";
      if (!grouped.has(assignee)) grouped.set(assignee, []);
      grouped.get(assignee)!.push(lead);
    }

    let notified = 0;
    const errors: string[] = [];

    for (const [userId, leads] of grouped) {
      if (userId === "unassigned") continue; // Skip unassigned leads

      const profile = profileMap.get(userId);
      if (!profile?.email) continue; // Can't notify without email

      const firstName = (profile.full_name ?? "").split(" ")[0] || "Hi";
      const count = leads.length;

      // Build the email body — a clean summary table
      const rows = leads.map((l: any) => {
        const days = daysAgo(l.updated_at);
        return `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${l.client_name}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${l.company_name || "—"}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${l.mobile || "—"}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#dc2626;font-weight:600">${days} days</td>
        </tr>`;
      }).join("");

      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#1e40af;padding:20px 24px;border-radius:8px 8px 0 0">
            <h2 style="margin:0;color:#fff;font-size:18px">⏰ Follow-up Reminder</h2>
          </div>
          <div style="padding:24px;background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
            <p style="margin:0 0 16px;font-size:15px;color:#334155">
              ${firstName}, you have <strong>${count} lead${count > 1 ? "s" : ""}</strong> 
              stuck in the <strong>Follow-ups</strong> stage for ${STALE_DAYS}+ days without activity.
            </p>
            <p style="margin:0 0 16px;font-size:14px;color:#64748b">
              Please review and take action — call, email, or move them forward.
            </p>
            <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e2e8f0;border-radius:6px">
              <thead>
                <tr style="background:#f8fafc">
                  <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0">Client</th>
                  <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0">Company</th>
                  <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0">Phone</th>
                  <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0">Stale</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
            <p style="margin:16px 0 0;font-size:13px;color:#94a3b8">
              This is an automated reminder from EaseMyOffice CRM. You'll receive this every ${STALE_DAYS} days until these leads are moved to another stage.
            </p>
          </div>
        </div>
      `;

      // Send the email
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: [profile.email],
            subject: `⏰ ${count} lead${count > 1 ? "s" : ""} need your attention — stuck in Follow-ups for ${STALE_DAYS}+ days`,
            html,
          }),
        });
        if (!res.ok) {
          const errText = await res.text();
          errors.push(`${profile.email}: Resend ${res.status} — ${errText}`);
        } else {
          notified++;
        }
      } catch (e) {
        errors.push(`${profile.email}: ${(e as Error).message}`);
      }
    }

    return json({
      ok: true,
      staleLeads: staleLeads.length,
      salespeopleNotified: notified,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 200);
  }
});
