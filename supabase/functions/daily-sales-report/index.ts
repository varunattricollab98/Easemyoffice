// Daily Sales Performance Report — sent to all admin users each morning.
// Summarizes each salesperson's work from the previous day:
//   • Calls made, Emails sent, WhatsApp messages
//   • Leads created, Leads moved forward (stage changes)
//   • Follow-ups completed, Follow-ups scheduled
//   • Bookings closed (if any)
//   • Revenue from bookings (profit column)
//   • Closing rate % (bookings / new_leads)
//   • Improvement % vs previous day
//   • Ranking by total score
//   • CSV attachment with all data
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

function fmtDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Aggregation helper: fetches activity counts, followups, leads, bookings for a given time window
async function fetchDayStats(
  supabase: any,
  startIso: string,
  endIso: string,
  profileMap: Map<string, any>,
  nameToId: Map<string, string>
) {
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

  // 3. Leads created
  const { data: newLeads } = await supabase
    .from("leads")
    .select("created_by")
    .gte("created_at", startIso)
    .lt("created_at", endIso);

  // 4. Bookings created (with profit for revenue)
  const { data: newBookings } = await supabase
    .from("bookings")
    .select("sales_agent_name, profit")
    .gte("created_at", startIso)
    .lt("created_at", endIso);

  // Aggregate per person
  type Stats = {
    calls: number;
    emails: number;
    whatsapp: number;
    stageChanges: number;
    notes: number;
    leadsCreated: number;
    followupsCompleted: number;
    bookings: number;
    revenue: number;
  };

  const statsMap = new Map<string, Stats>();

  const getStats = (uid: string): Stats => {
    if (!statsMap.has(uid)) {
      statsMap.set(uid, { calls: 0, emails: 0, whatsapp: 0, stageChanges: 0, notes: 0, leadsCreated: 0, followupsCompleted: 0, bookings: 0, revenue: 0 });
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

  // Leads created
  for (const l of newLeads ?? []) {
    if (l.created_by) getStats(l.created_by).leadsCreated++;
  }

  // Bookings (matched by name since bookings use sales_agent_name not user_id)
  for (const b of newBookings ?? []) {
    if (b.sales_agent_name) {
      const uid = nameToId.get(b.sales_agent_name.trim().toLowerCase());
      if (uid) {
        const s = getStats(uid);
        s.bookings++;
        s.revenue += Number(b.profit) || 0;
      }
    }
  }

  return statsMap;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth
    let bodySecret = "";
    try { bodySecret = (await req.json())?.secret ?? ""; } catch { /* no body */ }
    const headerSecret = req.headers.get("x-cron-secret") ?? "";
    if (!CRON_SECRET) {
      return json({ ok: false, error: "CRON_SECRET not configured" }, 401);
    }
    if (bodySecret !== CRON_SECRET && headerSecret !== CRON_SECRET) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    if (!RESEND_API_KEY) return json({ ok: false, error: "RESEND_API_KEY not set" }, 200);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Time windows:
    // "Yesterday" = day being reported on (previous day)
    // "Day before yesterday" = the day before that (for improvement % calculation)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today.getTime() - 86400000);
    const dayBeforeYesterday = new Date(today.getTime() - 2 * 86400000);

    const startIso = yesterday.toISOString();
    const endIso = today.toISOString();
    const prevStartIso = dayBeforeYesterday.toISOString();
    const prevEndIso = yesterday.toISOString();

    // Get all profiles (for name/email mapping)
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email");

    // Get admin users (to send the report to)
    const { data: adminRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const nameToId = new Map<string, string>();
    for (const p of profiles ?? []) {
      if (p.full_name) nameToId.set(p.full_name.trim().toLowerCase(), p.id);
    }

    const adminEmails = (adminRoles ?? [])
      .map((r: any) => profileMap.get(r.user_id)?.email)
      .filter(Boolean) as string[];

    if (adminEmails.length === 0) {
      return json({ ok: true, message: "No admin emails found", sent: false });
    }

    // Fetch current day and previous day stats in parallel
    const [currentStats, previousStats] = await Promise.all([
      fetchDayStats(supabase, startIso, endIso, profileMap, nameToId),
      fetchDayStats(supabase, prevStartIso, prevEndIso, profileMap, nameToId),
    ]);

    // Also fetch follow-ups created (for the report's followups scheduled column)
    const { data: createdFUs } = await supabase
      .from("follow_ups")
      .select("created_by")
      .gte("created_at", startIso)
      .lt("created_at", endIso);

    // Track followups scheduled per person
    const followupsScheduledMap = new Map<string, number>();
    for (const f of createdFUs ?? []) {
      if (f.created_by) {
        followupsScheduledMap.set(f.created_by, (followupsScheduledMap.get(f.created_by) ?? 0) + 1);
      }
    }

    // Build enhanced report data with improvement %, closing rate, and ranking
    type EnhancedRow = {
      uid: string;
      name: string;
      calls: number;
      emails: number;
      whatsapp: number;
      stageChanges: number;
      followupsCompleted: number;
      followupsScheduled: number;
      leadsCreated: number;
      bookings: number;
      revenue: number;
      closingRate: string;
      improvement: string;
      totalScore: number;
      rank: number;
    };

    const rows: EnhancedRow[] = [];

    // Merge all user IDs from both current and previous stats
    const allUserIds = new Set<string>([...currentStats.keys(), ...previousStats.keys()]);

    for (const uid of allUserIds) {
      const curr = currentStats.get(uid) ?? { calls: 0, emails: 0, whatsapp: 0, stageChanges: 0, notes: 0, leadsCreated: 0, followupsCompleted: 0, bookings: 0, revenue: 0 };
      const prev = previousStats.get(uid);

      const totalScore = curr.calls + curr.emails + curr.whatsapp + curr.stageChanges + curr.followupsCompleted + curr.leadsCreated + curr.bookings;

      // Closing rate: bookings / new_leads * 100
      let closingRate: string;
      if (curr.leadsCreated === 0) {
        closingRate = curr.bookings > 0 ? "N/A" : "N/A";
      } else {
        closingRate = ((curr.bookings / curr.leadsCreated) * 100).toFixed(1) + "%";
      }

      // Improvement vs previous day
      let improvement: string;
      if (!prev) {
        improvement = "NEW";
      } else {
        const prevTotal = prev.calls + prev.emails + prev.whatsapp + prev.stageChanges + prev.followupsCompleted + prev.leadsCreated + prev.bookings;
        if (prevTotal === 0) {
          improvement = totalScore > 0 ? "+100%" : "0%";
        } else {
          const pct = ((totalScore - prevTotal) / prevTotal) * 100;
          improvement = (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
        }
      }

      const p = profileMap.get(uid);
      const name = p?.full_name ?? p?.email ?? "Unknown";

      rows.push({
        uid,
        name,
        calls: curr.calls,
        emails: curr.emails,
        whatsapp: curr.whatsapp,
        stageChanges: curr.stageChanges,
        followupsCompleted: curr.followupsCompleted,
        followupsScheduled: followupsScheduledMap.get(uid) ?? 0,
        leadsCreated: curr.leadsCreated,
        bookings: curr.bookings,
        revenue: curr.revenue,
        closingRate,
        improvement,
        totalScore,
        rank: 0, // will be assigned after sorting
      });
    }

    // Sort by total score descending and assign rank
    rows.sort((a, b) => b.totalScore - a.totalScore);
    rows.forEach((row, idx) => { row.rank = idx + 1; });

    const teamTotal = rows.reduce((sum, r) => sum + r.totalScore, 0);
    const totalBookings = rows.reduce((sum, r) => sum + r.bookings, 0);
    const totalRevenue = rows.reduce((sum, r) => sum + r.revenue, 0);

    // ─── Generate CSV ───────────────────────────────────────────────────────────

    const csvHeader = "Person,Calls,Emails,WhatsApp,Stage_Moves,Followups_Done,New_Leads,Bookings,Revenue,Closing_Rate_Percent,Improvement_vs_Previous,Total_Score,Rank";
    const csvRows = rows.map((r) => {
      // Quote all string fields for RFC 4180 compliance
      const quotedName = `"${r.name.replace(/"/g, '""')}"`;
      const quotedClosingRate = `"${r.closingRate}"`;
      const quotedImprovement = `"${r.improvement}"`;
      return [
        quotedName,
        r.calls,
        r.emails,
        r.whatsapp,
        r.stageChanges,
        r.followupsCompleted,
        r.leadsCreated,
        r.bookings,
        r.revenue,
        quotedClosingRate,
        quotedImprovement,
        r.totalScore,
        r.rank,
      ].join(",");
    });

    const csvContent = [csvHeader, ...csvRows].join("\n");
    const base64CSV = btoa(unescape(encodeURIComponent(csvContent)));
    const reportDateStr = fmtDateISO(yesterday);

    // ─── Build HTML report ─────────────────────────────────────────────────────

    // Highlight top performer
    const topPerformer = rows[0];
    const topName = topPerformer ? topPerformer.name : "-";

    const htmlRows = rows.map((r) => {
      const improvementColor = r.improvement.startsWith("+") ? "#16a34a" : r.improvement.startsWith("-") ? "#dc2626" : "#64748b";
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-weight:500">${r.name}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center">${r.calls}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center">${r.emails}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center">${r.whatsapp}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center">${r.stageChanges}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center">${r.followupsCompleted}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center">${r.leadsCreated}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:600;color:#16a34a">${r.bookings}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:600;color:#7c3aed">${r.revenue.toLocaleString("en-IN")}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center">${r.closingRate}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center;color:${improvementColor};font-weight:500">${r.improvement}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700">${r.totalScore}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;color:#1e40af">#${r.rank}</td>
      </tr>`;
    }).join("");

    // Inactive salespeople (profiles with sales role but 0 activity)
    const { data: salesRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .in("role", ["sales", "bd"]);

    const inactiveUsers = (salesRoles ?? [])
      .filter((r: any) => !currentStats.has(r.user_id) || (() => {
        const s = currentStats.get(r.user_id)!;
        return (s.calls + s.emails + s.whatsapp) === 0;
      })())
      .map((r: any) => profileMap.get(r.user_id)?.full_name)
      .filter(Boolean);

    const inactiveSection = inactiveUsers.length > 0
      ? `<div style="margin-top:16px;padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px">
           <strong style="color:#dc2626">&#9888;&#65039; No calls/emails/WhatsApp yesterday:</strong>
           <span style="color:#7f1d1d"> ${inactiveUsers.join(", ")}</span>
         </div>`
      : "";

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:900px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#1e40af,#7c3aed);padding:20px 24px;border-radius:8px 8px 0 0">
          <h2 style="margin:0;color:#fff;font-size:18px">&#128202; Daily Sales Performance Report</h2>
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
              <div style="font-size:24px;font-weight:700;color:#16a34a">${totalBookings}</div>
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Bookings</div>
            </div>
            <div style="flex:1;min-width:120px;padding:12px 16px;background:#faf5ff;border-radius:8px;text-align:center">
              <div style="font-size:24px;font-weight:700;color:#7c3aed">&#8377;${totalRevenue.toLocaleString("en-IN")}</div>
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Revenue</div>
            </div>
            <div style="flex:1;min-width:120px;padding:12px 16px;background:#fefce8;border-radius:8px;text-align:center">
              <div style="font-size:24px;font-weight:700;color:#ca8a04">&#127942; ${topName}</div>
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Top Performer</div>
            </div>
          </div>

          <!-- Per-person table -->
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #e2e8f0;border-radius:6px">
              <thead>
                <tr style="background:#f8fafc">
                  <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e2e8f0">Person</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0">&#128222; Calls</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0">&#9993;&#65039; Emails</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0">&#128172; WA</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0">&#128260; Moves</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0">&#9989; FU Done</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0">&#10133; Leads</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0">&#128176; Bookings</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0">&#128178; Revenue</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0">&#127919; Close %</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0">&#128200; vs Prev</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0;font-weight:700">Total</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0;font-weight:700">&#127941; Rank</th>
                </tr>
              </thead>
              <tbody>${htmlRows}</tbody>
            </table>
          </div>

          ${inactiveSection}

          <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;text-align:center">
            Auto-generated by EaseMyOffice CRM &middot; Sent daily at 9:15 AM IST &middot; CSV report attached
          </p>
        </div>
      </div>
    `;

    // Send to all admins with CSV attachment
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: adminEmails,
        subject: `📊 Sales Report — ${fmtDate(yesterday)} | ${teamTotal} actions, ${totalBookings} bookings, ₹${totalRevenue.toLocaleString("en-IN")} revenue`,
        html,
        attachments: [
          {
            filename: `daily-sales-report-${reportDateStr}.csv`,
            content: base64CSV,
          },
        ],
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
      teamMembers: rows.length,
      totalActions: teamTotal,
      totalRevenue,
      totalBookings,
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 200);
  }
});
