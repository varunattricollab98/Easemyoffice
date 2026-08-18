// Weekly Sales Performance Report
// Sent every Monday morning:
//   - Admin users receive a full team comparison table with CSV attachment
//   - Each salesperson (sales/bd role) receives their individual summary
//
// Covers the previous full week (Monday 00:00 UTC to Sunday 23:59 UTC).
// Also fetches the week before that for week-over-week comparison.
//
// Triggered by pg_cron at Monday 9:00 AM IST (3:30 AM UTC).
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

function fmtDateRange(start: Date, end: Date): string {
  return `${fmtDate(start)} - ${fmtDate(end)}`;
}

/**
 * Returns the previous Monday 00:00 UTC.
 * If today is Monday, returns the Monday 7 days ago.
 */
function getPreviousMonday(today: Date): Date {
  const d = new Date(today);
  d.setUTCHours(0, 0, 0, 0);
  // day: 0=Sun, 1=Mon, ...
  const day = d.getUTCDay();
  // Days since last Monday (if today is Monday, go back 7 days so we get the PREVIOUS full week)
  const daysBack = day === 1 ? 7 : ((day + 6) % 7);
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d;
}

// Aggregation helper: fetches activity counts, followups, leads, bookings for a given time window
async function fetchWeekStats(
  supabase: any,
  startIso: string,
  endIso: string,
  nameToId: Map<string, string>
) {
  // 1. Activities (calls, emails, whatsapp, stage_change)
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
    followupsCompleted: number;
    leadsCreated: number;
    bookings: number;
    revenue: number;
  };

  const statsMap = new Map<string, Stats>();

  const getStats = (uid: string): Stats => {
    if (!statsMap.has(uid)) {
      statsMap.set(uid, { calls: 0, emails: 0, whatsapp: 0, stageChanges: 0, followupsCompleted: 0, leadsCreated: 0, bookings: 0, revenue: 0 });
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
    // "This week" = previous full week (Mon-Sun)
    // "Last week" = the week before that (for WoW comparison)
    const now = new Date();
    const thisWeekStart = getPreviousMonday(now); // Monday 00:00 UTC
    const thisWeekEnd = new Date(thisWeekStart.getTime() + 7 * 86400000); // Next Monday 00:00 UTC

    const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 86400000);
    const lastWeekEnd = new Date(thisWeekStart.getTime()); // = thisWeekStart

    const thisWeekStartIso = thisWeekStart.toISOString();
    const thisWeekEndIso = thisWeekEnd.toISOString();
    const lastWeekStartIso = lastWeekStart.toISOString();
    const lastWeekEndIso = lastWeekEnd.toISOString();

    // Get all profiles (for name/email mapping)
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email");

    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const nameToId = new Map<string, string>();
    for (const p of profiles ?? []) {
      if (p.full_name) nameToId.set(p.full_name.trim().toLowerCase(), p.id);
    }

    // Get admin users (to send the full team report to)
    const { data: adminRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    const adminEmails = (adminRoles ?? [])
      .map((r: any) => profileMap.get(r.user_id)?.email)
      .filter(Boolean) as string[];

    // Get sales/bd users (to send individual reports to)
    const { data: salesBdRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .in("role", ["sales", "bd"]);

    const salesBdUsers = (salesBdRoles ?? [])
      .map((r: any) => {
        const p = profileMap.get(r.user_id);
        return p ? { id: r.user_id, name: p.full_name, email: p.email } : null;
      })
      .filter(Boolean) as { id: string; name: string; email: string }[];

    if (adminEmails.length === 0 && salesBdUsers.length === 0) {
      return json({ ok: true, message: "No recipients found", sent: false });
    }

    // Fetch current week and previous week stats in parallel
    const [currentStats, previousStats] = await Promise.all([
      fetchWeekStats(supabase, thisWeekStartIso, thisWeekEndIso, nameToId),
      fetchWeekStats(supabase, lastWeekStartIso, lastWeekEndIso, nameToId),
    ]);

    // Build enhanced report data with improvement %, closing rate, and ranking
    type EnhancedRow = {
      uid: string;
      name: string;
      calls: number;
      emails: number;
      whatsapp: number;
      stageChanges: number;
      followupsCompleted: number;
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
      const curr = currentStats.get(uid) ?? { calls: 0, emails: 0, whatsapp: 0, stageChanges: 0, followupsCompleted: 0, leadsCreated: 0, bookings: 0, revenue: 0 };
      const prev = previousStats.get(uid);

      const totalScore = curr.calls + curr.emails + curr.whatsapp + curr.stageChanges + curr.followupsCompleted + curr.leadsCreated + curr.bookings;

      // Closing rate: bookings / new_leads * 100
      let closingRate: string;
      if (curr.leadsCreated === 0) {
        closingRate = "N/A";
      } else {
        closingRate = ((curr.bookings / curr.leadsCreated) * 100).toFixed(1) + "%";
      }

      // Improvement vs previous week
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
        leadsCreated: curr.leadsCreated,
        bookings: curr.bookings,
        revenue: curr.revenue,
        closingRate,
        improvement,
        totalScore,
        rank: 0, // assigned after sorting
      });
    }

    // Sort by total score descending and assign rank
    rows.sort((a, b) => b.totalScore - a.totalScore);
    rows.forEach((row, idx) => { row.rank = idx + 1; });

    const teamTotal = rows.reduce((sum, r) => sum + r.totalScore, 0);
    const totalBookings = rows.reduce((sum, r) => sum + r.bookings, 0);
    const totalRevenue = rows.reduce((sum, r) => sum + r.revenue, 0);
    const topPerformer = rows[0];
    const topName = topPerformer ? topPerformer.name : "-";

    // Identify Top 3 and Bottom 3
    const top3Ids = new Set(rows.slice(0, 3).map(r => r.uid));
    const bottom3Ids = new Set(rows.length > 3 ? rows.slice(-3).map(r => r.uid) : []);

    // Team averages (for individual reports)
    const teamAvg = {
      calls: rows.length > 0 ? rows.reduce((s, r) => s + r.calls, 0) / rows.length : 0,
      emails: rows.length > 0 ? rows.reduce((s, r) => s + r.emails, 0) / rows.length : 0,
      whatsapp: rows.length > 0 ? rows.reduce((s, r) => s + r.whatsapp, 0) / rows.length : 0,
      stageChanges: rows.length > 0 ? rows.reduce((s, r) => s + r.stageChanges, 0) / rows.length : 0,
      followupsCompleted: rows.length > 0 ? rows.reduce((s, r) => s + r.followupsCompleted, 0) / rows.length : 0,
      leadsCreated: rows.length > 0 ? rows.reduce((s, r) => s + r.leadsCreated, 0) / rows.length : 0,
      bookings: rows.length > 0 ? rows.reduce((s, r) => s + r.bookings, 0) / rows.length : 0,
      revenue: rows.length > 0 ? rows.reduce((s, r) => s + r.revenue, 0) / rows.length : 0,
      totalScore: rows.length > 0 ? rows.reduce((s, r) => s + r.totalScore, 0) / rows.length : 0,
    };

    // Week date range for display
    const weekEndDisplay = new Date(thisWeekEnd.getTime() - 86400000); // Sunday
    const weekRangeStr = fmtDateRange(thisWeekStart, weekEndDisplay);

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
    const reportDateStr = fmtDateISO(thisWeekStart);

    // ─── Build ADMIN HTML ──────────────────────────────────────────────────────

    const htmlRows = rows.map((r) => {
      const improvementColor = r.improvement.startsWith("+") ? "#16a34a" : r.improvement.startsWith("-") ? "#dc2626" : "#64748b";
      let rowBg = "";
      if (top3Ids.has(r.uid)) rowBg = "background-color:#f0fdf4;"; // green for top 3
      if (bottom3Ids.has(r.uid)) rowBg = "background-color:#fef2f2;"; // red/pink for bottom 3
      return `<tr style="${rowBg}">
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

    const adminHtml = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:960px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#1e40af,#7c3aed);padding:20px 24px;border-radius:8px 8px 0 0">
          <h2 style="margin:0;color:#fff;font-size:18px">&#128202; Weekly Sales Performance Report</h2>
          <p style="margin:4px 0 0;color:#e0e7ff;font-size:13px">${weekRangeStr}</p>
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

          <!-- Top 3 / Bottom 3 Legend -->
          <div style="margin-bottom:16px;font-size:12px;color:#64748b">
            <span style="display:inline-block;width:14px;height:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:3px;vertical-align:middle;margin-right:4px"></span> Top 3 Performers
            &nbsp;&nbsp;
            <span style="display:inline-block;width:14px;height:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:3px;vertical-align:middle;margin-right:4px"></span> Bottom 3 Performers
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
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0">&#128200; WoW</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0;font-weight:700">Total</th>
                  <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #e2e8f0;font-weight:700">&#127941; Rank</th>
                </tr>
              </thead>
              <tbody>${htmlRows}</tbody>
            </table>
          </div>

          <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;text-align:center">
            Auto-generated by EaseMyOffice CRM &middot; Sent weekly on Mondays at 9:00 AM IST &middot; CSV report attached
          </p>
        </div>
      </div>
    `;

    // ─── Build INDIVIDUAL HTML (one per salesperson) ────────────────────────────

    function buildIndividualHtml(row: EnhancedRow): string {
      const improvementColor = row.improvement.startsWith("+") ? "#16a34a" : row.improvement.startsWith("-") ? "#dc2626" : "#64748b";
      const rankSuffix = row.rank === 1 ? "st" : row.rank === 2 ? "nd" : row.rank === 3 ? "rd" : "th";

      // Comparison to team average
      const compareToAvg = (val: number, avg: number) => {
        if (avg === 0) return val > 0 ? '<span style="color:#16a34a">&#9650; Above avg</span>' : '<span style="color:#64748b">-</span>';
        const diff = ((val - avg) / avg) * 100;
        if (diff > 5) return `<span style="color:#16a34a">&#9650; ${diff.toFixed(0)}% above avg</span>`;
        if (diff < -5) return `<span style="color:#dc2626">&#9660; ${Math.abs(diff).toFixed(0)}% below avg</span>`;
        return '<span style="color:#64748b">&#8776; At avg</span>';
      };

      return `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:700px;margin:0 auto">
          <div style="background:linear-gradient(135deg,#1e40af,#7c3aed);padding:20px 24px;border-radius:8px 8px 0 0">
            <h2 style="margin:0;color:#fff;font-size:18px">&#128202; Your Weekly Performance Summary</h2>
            <p style="margin:4px 0 0;color:#e0e7ff;font-size:13px">${weekRangeStr}</p>
          </div>
          <div style="padding:24px;background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
            
            <h3 style="margin:0 0 16px;color:#1e293b">Hi ${row.name}! Here's how your week went:</h3>

            <!-- Rank & WoW -->
            <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
              <div style="flex:1;min-width:140px;padding:12px 16px;background:#f0f9ff;border-radius:8px;text-align:center">
                <div style="font-size:28px;font-weight:700;color:#1e40af">#${row.rank}</div>
                <div style="font-size:11px;color:#64748b;text-transform:uppercase">Rank (of ${rows.length})</div>
              </div>
              <div style="flex:1;min-width:140px;padding:12px 16px;background:#faf5ff;border-radius:8px;text-align:center">
                <div style="font-size:28px;font-weight:700;color:${improvementColor}">${row.improvement}</div>
                <div style="font-size:11px;color:#64748b;text-transform:uppercase">Week-over-Week</div>
              </div>
              <div style="flex:1;min-width:140px;padding:12px 16px;background:#f0fdf4;border-radius:8px;text-align:center">
                <div style="font-size:28px;font-weight:700;color:#16a34a">${row.totalScore}</div>
                <div style="font-size:11px;color:#64748b;text-transform:uppercase">Total Score</div>
              </div>
            </div>

            <!-- Stats table with team comparison -->
            <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e2e8f0;border-radius:6px">
              <thead>
                <tr style="background:#f8fafc">
                  <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e2e8f0">Metric</th>
                  <th style="padding:10px 12px;text-align:center;border-bottom:2px solid #e2e8f0">Your Score</th>
                  <th style="padding:10px 12px;text-align:center;border-bottom:2px solid #e2e8f0">Team Avg</th>
                  <th style="padding:10px 12px;text-align:center;border-bottom:2px solid #e2e8f0">Comparison</th>
                </tr>
              </thead>
              <tbody>
                <tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">&#128222; Calls</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0;font-weight:600">${row.calls}</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0">${teamAvg.calls.toFixed(1)}</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0;font-size:11px">${compareToAvg(row.calls, teamAvg.calls)}</td></tr>
                <tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">&#9993;&#65039; Emails</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0;font-weight:600">${row.emails}</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0">${teamAvg.emails.toFixed(1)}</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0;font-size:11px">${compareToAvg(row.emails, teamAvg.emails)}</td></tr>
                <tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">&#128172; WhatsApp</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0;font-weight:600">${row.whatsapp}</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0">${teamAvg.whatsapp.toFixed(1)}</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0;font-size:11px">${compareToAvg(row.whatsapp, teamAvg.whatsapp)}</td></tr>
                <tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">&#128260; Stage Moves</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0;font-weight:600">${row.stageChanges}</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0">${teamAvg.stageChanges.toFixed(1)}</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0;font-size:11px">${compareToAvg(row.stageChanges, teamAvg.stageChanges)}</td></tr>
                <tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">&#9989; Followups Done</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0;font-weight:600">${row.followupsCompleted}</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0">${teamAvg.followupsCompleted.toFixed(1)}</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0;font-size:11px">${compareToAvg(row.followupsCompleted, teamAvg.followupsCompleted)}</td></tr>
                <tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">&#10133; New Leads</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0;font-weight:600">${row.leadsCreated}</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0">${teamAvg.leadsCreated.toFixed(1)}</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0;font-size:11px">${compareToAvg(row.leadsCreated, teamAvg.leadsCreated)}</td></tr>
                <tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">&#128176; Bookings</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0;font-weight:600;color:#16a34a">${row.bookings}</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0">${teamAvg.bookings.toFixed(1)}</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0;font-size:11px">${compareToAvg(row.bookings, teamAvg.bookings)}</td></tr>
                <tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">&#128178; Revenue</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0;font-weight:600;color:#7c3aed">&#8377;${row.revenue.toLocaleString("en-IN")}</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0">&#8377;${teamAvg.revenue.toFixed(0)}</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0;font-size:11px">${compareToAvg(row.revenue, teamAvg.revenue)}</td></tr>
                <tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">&#127919; Closing Rate</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0;font-weight:600" colspan="3">${row.closingRate}</td></tr>
              </tbody>
            </table>

            <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;text-align:center">
              You ranked <strong>${row.rank}${rankSuffix}</strong> out of ${rows.length} team members this week. Keep pushing! &#128170;
            </p>
          </div>
        </div>
      `;
    }

    // ─── Send Emails ───────────────────────────────────────────────────────────

    const emailResults: { type: string; to: string; ok: boolean; error?: string }[] = [];

    // 1. Send admin email with CSV attachment
    if (adminEmails.length > 0) {
      try {
        const adminRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: adminEmails,
            subject: `📊 Weekly Sales Report | ${weekRangeStr} | ${teamTotal} actions, ${totalBookings} bookings, ₹${totalRevenue.toLocaleString("en-IN")} revenue`,
            html: adminHtml,
            attachments: [
              {
                filename: `weekly-sales-report-${reportDateStr}.csv`,
                content: base64CSV,
              },
            ],
          }),
        });

        if (!adminRes.ok) {
          const errText = await adminRes.text();
          emailResults.push({ type: "admin", to: adminEmails.join(","), ok: false, error: `Resend ${adminRes.status}: ${errText}` });
        } else {
          emailResults.push({ type: "admin", to: adminEmails.join(","), ok: true });
        }
      } catch (adminErr) {
        emailResults.push({ type: "admin", to: adminEmails.join(","), ok: false, error: `Network error: ${(adminErr as Error).message}` });
      }
    }

    // 2. Send individual emails to each salesperson
    for (const user of salesBdUsers) {
      const row = rows.find(r => r.uid === user.id);
      if (!row) continue; // No data for this person this week
      if (!user.email) continue;

      const individualHtml = buildIndividualHtml(row);
      const firstName = user.name ? user.name.split(" ")[0] : "there";

      try {
        const indRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: [user.email],
            subject: `📊 ${firstName}, your weekly performance summary | Rank #${row.rank} of ${rows.length}`,
            html: individualHtml,
          }),
        });

        if (!indRes.ok) {
          const errText = await indRes.text();
          emailResults.push({ type: "individual", to: user.email, ok: false, error: `Resend ${indRes.status}: ${errText}` });
        } else {
          emailResults.push({ type: "individual", to: user.email, ok: true });
        }
      } catch (fetchErr) {
        emailResults.push({ type: "individual", to: user.email, ok: false, error: `fetch failed: ${(fetchErr as Error).message}` });
      }
    }

    return json({
      ok: true,
      reportWeek: weekRangeStr,
      adminRecipients: adminEmails.length,
      individualRecipients: salesBdUsers.length,
      teamMembers: rows.length,
      totalActions: teamTotal,
      totalRevenue,
      totalBookings,
      emailResults,
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 200);
  }
});
