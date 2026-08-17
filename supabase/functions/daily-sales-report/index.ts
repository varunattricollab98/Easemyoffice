// Daily Sales Performance Report — sent to all admin users each morning.
// Summarizes each salesperson's work from the previous day:
//   • Calls made, Emails sent, WhatsApp messages
//   • Leads created, Leads moved forward (stage changes)
//   • Follow-ups completed, Follow-ups scheduled
//   • Bookings closed (if any)
//
// Triggered daily by pg_cron at 9:15 AM IST (3:45 AM UTC).
//
// Required Edge Function secrets:
//   RESEND_API_KEY, CRM_FROM_EMAIL, CRON_SECRET
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

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth
    let bodySecret = "";
    try { bodySecret = (await req.json())?.secret ?? ""; } catch { /* no body */ }
    const headerSecret = req.headers.get("x-cron-secret") ?? "";
    if (!CRON_SECRET || (bodySecret !== CRON_SECRET && headerSecret !== CRON_SECRET)) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    if (!RESEND_API_KEY) return json({ ok: false, error: "RESEND_API_KEY not set" }, 200);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Time window: yesterday 00:00 to today 00:00 (UTC-based, covers a full day)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today.getTime() - 86400000);
    const startIso = yesterday.toISOString();
    const endIso = today.toISOString();

    // ─── Fetch all data for the period ─────────────────────────────────────────

    // 1. Activities (calls, emails, whatsapp, stage_change, followup, etc.)
    const { data: activities } = await supabase
      .from("lead_activities")
      .select("actor_id, type")
      .gte("created_at", startIso)
      .lt("created_at", endIso);

    // 2. Follow-ups completed
    const { data: completedFUs } = await supabase
      .from("follow_ups")
      .select("owner_id")
      .eq("status", "done")
      .gte("completed_at", startIso)
      .lt("completed_at", endIso);

    // 3. Follow-ups created
    const { data: createdFUs } = await supabase
      .from("follow_ups")
      .select("created_by")
      .gte("created_at", startIso)
      .lt("created_at", endIso);

    // 4. Leads created
    const { data: newLeads } = await supabase
      .from("leads")
      .select("created_by")
      .gte("created_at", startIso)
      .lt("created_at", endIso);

    // 5. Bookings created
    const { data: newBookings } = await supabase
      .from("bookings")
      .select("sales_agent_name")
      .gte("created_at", startIso)
      .lt("created_at", endIso);

    // 6. Get all profiles (for name/email mapping)
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email");

    // 7. Get admin users (to send the report to)
    const { data: adminRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const adminEmails = (adminRoles ?? [])
      .map((r: any) => profileMap.get(r.user_id)?.email)
      .filter(Boolean) as string[];

    if (adminEmails.length === 0) {
      return json({ ok: true, message: "No admin emails found", sent: false });
    }

    // ─── Aggregate per salesperson ─────────────────────────────────────────────

    type Stats = {
      calls: number;
      emails: number;
      whatsapp: number;
      stageChanges: number;
      notes: number;
      leadsCreated: number;
      followupsCompleted: number;
      followupsScheduled: number;
      bookings: number;
    };

    const statsMap = new Map<string, Stats>();

    const getStats = (uid: string): Stats => {
      if (!statsMap.has(uid)) {
        statsMap.set(uid, { calls: 0, emails: 0, whatsapp: 0, stageChanges: 0, notes: 0, leadsCreated: 0, followupsCompleted: 0, followupsScheduled: 0, bookings: 0 });
      }
      return statsMap.get(uid)!;
    };

    // Count activities by type
    for (const a of activities ?? []) {
      if (!a.actor_id) continue;
      const s = getStats(a.actor_id);
      if (a.type === "call") s.calls++;
      else if (a.type === "email") s.emails++;
      else if (a.type === "whatsapp") s.whatsapp++;
      else if (a.type === "stage_change") s.stageChanges++;
      else if (a.type === "note") s.notes++;
    }

    // Follow-ups completed
    for (const f of completedFUs ?? []) {
      if (f.owner_id) getStats(f.owner_id).followupsCompleted++;
    }

    // Follow-ups created
    for (const f of createdFUs ?? []) {
      if (f.created_by) getStats(f.created_by).followupsScheduled++;
    }

    // Leads created
    for (const l of newLeads ?? []) {
      if (l.created_by) getStats(l.created_by).leadsCreated++;
    }

    // Bookings (matched by name since bookings use sales_agent_name not user_id)
    const nameToId = new Map<string, string>();
    for (const p of profiles ?? []) {
      if (p.full_name) nameToId.set(p.full_name.toLowerCase(), p.id);
    }
    for (const b of newBookings ?? []) {
      if (b.sales_agent_name) {
        const uid = nameToId.get(b.sales_agent_name.toLowerCase());
        if (uid) getStats(uid).bookings++;
      }
    }

    // ─── Build HTML report ─────────────────────────────────────────────────────

    // Sort salespeople by total activity (most active first)
    const sorted = [...statsMap.entries()]
      .map(([uid, s]) => ({ uid, ...s, total: s.calls + s.emails + s.whatsapp + s.stageChanges + s.followupsCompleted + s.leadsCreated + s.bookings }))
      .sort((a, b) => b.total - a.total);

    const teamTotal = sorted.reduce((sum, s) => sum + s.total, 0);

    const rows = sorted.map((s) => {
      const p = profileMap.get(s.uid);
      const name = p?.full_name ?? p?.email ?? "Unknown";
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-weight:500">${name}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center">${s.calls}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center">${s.emails}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center">${s.whatsapp}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center">${s.stageChanges}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center">${s.followupsCompleted}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center">${s.leadsCreated}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:600;color:#16a34a">${s.bookings}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700">${s.total}</td>
      </tr>`;
    }).join("");

    // Highlight top performer
    const topPerformer = sorted[0];
    const topName = topPerformer ? (profileMap.get(topPerformer.uid)?.full_name ?? "—") : "—";

    // Inactive salespeople (profiles with sales role but 0 activity)
    const { data: salesRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .in("role", ["sales", "bd"]);

    const inactiveUsers = (salesRoles ?? [])
      .filter((r: any) => !statsMap.has(r.user_id) || (statsMap.get(r.user_id)!.calls + statsMap.get(r.user_id)!.emails + statsMap.get(r.user_id)!.whatsapp) === 0)
      .map((r: any) => profileMap.get(r.user_id)?.full_name)
      .filter(Boolean);

    const inactiveSection = inactiveUsers.length > 0
      ? `<div style="margin-top:16px;padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px">
           <strong style="color:#dc2626">⚠️ No calls/emails/WhatsApp yesterday:</strong>
           <span style="color:#7f1d1d"> ${inactiveUsers.join(", ")}</span>
         </div>`
      : "";

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:750px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#1e40af,#7c3aed);padding:20px 24px;border-radius:8px 8px 0 0">
          <h2 style="margin:0;color:#fff;font-size:18px">📊 Daily Sales Performance Report</h2>
          <p style="margin:4px 0 0;color:#e0e7ff;font-size:13px">${fmtDate(yesterday)}</p>
        </div>
        <div style="padding:24px;background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
          
          <!-- Summary cards -->
          <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
            <div style="flex:1;min-width:120px;padding:12px 16px;background:#f0f9ff;border-radius:8px;text-align:center">
              <div style="font-size:24px;font-weight:700;color:#1e40af">${teamTotal}</div>
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Total Actions</div>
            </div>
            <div style="flex:1;min-width:120px;padding:12px 16px;background:#f0fdf4;border-radius:8px;text-align:center">
              <div style="font-size:24px;font-weight:700;color:#16a34a">${sorted.reduce((s, r) => s + r.bookings, 0)}</div>
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Bookings</div>
            </div>
            <div style="flex:1;min-width:120px;padding:12px 16px;background:#fefce8;border-radius:8px;text-align:center">
              <div style="font-size:24px;font-weight:700;color:#ca8a04">🏆 ${topName}</div>
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Top Performer</div>
            </div>
          </div>

          <!-- Per-person table -->
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #e2e8f0;border-radius:6px">
              <thead>
                <tr style="background:#f8fafc">
                  <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e2e8f0">Person</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0">📞 Calls</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0">✉️ Emails</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0">💬 WA</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0">🔄 Moves</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0">✅ FU Done</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0">➕ Leads</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0">💰 Bookings</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0;font-weight:700">Total</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>

          ${inactiveSection}

          <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;text-align:center">
            Auto-generated by EaseMyOffice CRM · Sent daily at 9:15 AM IST
          </p>
        </div>
      </div>
    `;

    // Send to all admins
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: adminEmails,
        subject: `📊 Sales Report — ${fmtDate(yesterday)} | ${teamTotal} actions, ${sorted.reduce((s, r) => s + r.bookings, 0)} bookings`,
        html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Resend ${res.status}: ${errText}`);
    }

    return json({
      ok: true,
      reportDate: fmtDate(yesterday),
      adminRecipients: adminEmails.length,
      teamMembers: sorted.length,
      totalActions: teamTotal,
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 200);
  }
});
