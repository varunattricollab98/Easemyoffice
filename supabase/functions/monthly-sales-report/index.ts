// Monthly Sales Performance Report
// Sent on the 1st of every month at 9:00 AM IST (3:30 AM UTC).
//
// Covers the previous full month (1st 00:00 UTC to last day 23:59 UTC).
// Also fetches the month before that for month-over-month comparison.
//
// Features:
//   - Target vs Actual from user_targets table
//   - Average deal size per person
//   - Approximate time to close (days)
//   - Revenue contribution percentage
//   - Month-over-month improvement trend
//   - Ranking by total score
//   - Admin email with full team HTML + CSV attachment
//   - Individual emails to each salesperson with personal summary
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
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function fmtMonthYear(d: Date): string {
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function fmtDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Returns the start and end of the previous full month.
 * Start: 1st of prev month 00:00:00 UTC
 * End: 1st of current month 00:00:00 UTC (exclusive upper bound)
 */
function getPreviousMonth(today: Date): { start: Date; end: Date } {
  const d = new Date(today);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  const end = new Date(d); // 1st of current month
  d.setUTCMonth(d.getUTCMonth() - 1);
  const start = new Date(d); // 1st of previous month
  return { start, end };
}

/**
 * Returns the start and end of two months ago.
 */
function getTwoMonthsAgo(today: Date): { start: Date; end: Date } {
  const d = new Date(today);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  const end = new Date(d);
  end.setUTCMonth(end.getUTCMonth() - 1); // 1st of previous month = end of 2 months ago
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 1); // 1st of 2 months ago
  return { start, end };
}

// Aggregation helper: fetches activity counts, followups, leads, bookings for a given time window
async function fetchMonthStats(
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
    .select("sales_agent_name, profit, created_at")
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
    bookingDates: Date[];
  };

  const statsMap = new Map<string, Stats>();

  const getStats = (uid: string): Stats => {
    if (!statsMap.has(uid)) {
      statsMap.set(uid, { calls: 0, emails: 0, whatsapp: 0, stageChanges: 0, followupsCompleted: 0, leadsCreated: 0, bookings: 0, revenue: 0, bookingDates: [] });
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
        if (b.created_at) s.bookingDates.push(new Date(b.created_at));
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

    // Time windows
    const now = new Date();
    const thisMonth = getPreviousMonth(now);
    const lastMonth = getTwoMonthsAgo(now);

    const thisMonthStartIso = thisMonth.start.toISOString();
    const thisMonthEndIso = thisMonth.end.toISOString();
    const lastMonthStartIso = lastMonth.start.toISOString();
    const lastMonthEndIso = lastMonth.end.toISOString();

    // Get all profiles (for name/email mapping)
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email");

    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const nameToId = new Map<string, string>();
    for (const p of profiles ?? []) {
      if (p.full_name) nameToId.set(p.full_name.trim().toLowerCase(), p.id);
    }

    // Get admin users
    const { data: adminRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    const adminEmails = (adminRoles ?? [])
      .map((r: any) => profileMap.get(r.user_id)?.email)
      .filter(Boolean) as string[];

    // Get sales/bd users
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

    // Fetch user_targets for monthly targets
    const { data: userTargets } = await supabase
      .from("user_targets")
      .select("user_id, bookings, profit");

    const targetMap = new Map<string, { bookings: number; profit: number }>();
    for (const t of userTargets ?? []) {
      targetMap.set(t.user_id, { bookings: Number(t.bookings) || 0, profit: Number(t.profit) || 0 });
    }

    // Fetch leads assigned_to for time-to-close approximation
    // Scope to leads created within the last 180 days to avoid misleading matches with old leads
    const timeToCloseWindowStart = new Date(now.getTime() - 180 * 86400000).toISOString();
    const { data: closedLeads } = await supabase
      .from("leads")
      .select("assigned_to, created_at, stage")
      .in("stage", ["Booking Done", "booking_done", "Booked", "booked", "Won", "won", "Closed Won", "closed_won"])
      .gte("created_at", timeToCloseWindowStart);

    // Map: userId -> array of lead creation dates (for time-to-close calc)
    const closedLeadsByUser = new Map<string, Date[]>();
    for (const l of closedLeads ?? []) {
      if (!l.assigned_to || !l.created_at) continue;
      if (!closedLeadsByUser.has(l.assigned_to)) closedLeadsByUser.set(l.assigned_to, []);
      closedLeadsByUser.get(l.assigned_to)!.push(new Date(l.created_at));
    }

    // Fetch current month and previous month stats in parallel
    const [currentStats, previousStats] = await Promise.all([
      fetchMonthStats(supabase, thisMonthStartIso, thisMonthEndIso, nameToId),
      fetchMonthStats(supabase, lastMonthStartIso, lastMonthEndIso, nameToId),
    ]);

    // Build enhanced report data
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
      targetBookings: number;
      targetProfit: number;
      achievementBookingsPercent: string;
      achievementRevenuePercent: string;
      avgDealSize: string;
      timeToCloseDays: string;
      revenueContributionPercent: string;
    };

    const rows: EnhancedRow[] = [];

    // Merge all user IDs from both current and previous stats
    const allUserIds = new Set<string>([...currentStats.keys(), ...previousStats.keys()]);

    // Calculate total team revenue first (needed for revenue contribution)
    let totalTeamRevenue = 0;
    for (const uid of allUserIds) {
      const curr = currentStats.get(uid);
      totalTeamRevenue += curr?.revenue ?? 0;
    }

    for (const uid of allUserIds) {
      const curr = currentStats.get(uid) ?? { calls: 0, emails: 0, whatsapp: 0, stageChanges: 0, followupsCompleted: 0, leadsCreated: 0, bookings: 0, revenue: 0, bookingDates: [] as Date[] };
      const prev = previousStats.get(uid);

      const totalScore = curr.calls + curr.emails + curr.whatsapp + curr.stageChanges + curr.followupsCompleted + curr.leadsCreated + curr.bookings;

      // Closing rate: bookings / new_leads * 100
      let closingRate: string;
      if (curr.leadsCreated === 0) {
        closingRate = "N/A";
      } else {
        closingRate = ((curr.bookings / curr.leadsCreated) * 100).toFixed(1) + "%";
      }

      // Month-over-month improvement
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

      // Target vs Actual
      const targets = targetMap.get(uid);
      const targetBookings = targets?.bookings ?? 0;
      const targetProfit = targets?.profit ?? 0;

      const achievementBookingsPercent = targetBookings > 0
        ? ((curr.bookings / targetBookings) * 100).toFixed(1) + "%"
        : "N/A";
      const achievementRevenuePercent = targetProfit > 0
        ? ((curr.revenue / targetProfit) * 100).toFixed(1) + "%"
        : "N/A";

      // Average deal size
      const avgDealSize = curr.bookings > 0
        ? (curr.revenue / curr.bookings).toFixed(0)
        : "N/A";

      // Time to close approximation
      let timeToCloseDays = "N/A";
      if (curr.bookingDates.length > 0) {
        const leadDates = closedLeadsByUser.get(uid) ?? [];
        if (leadDates.length > 0 && curr.bookingDates.length > 0) {
          // Average: (booking date - lead creation date) across bookings
          let totalDays = 0;
          let count = 0;
          for (const bookingDate of curr.bookingDates) {
            // Find the closest lead date before this booking
            let bestLead: Date | null = null;
            let bestDiff = Infinity;
            for (const ld of leadDates) {
              const diff = bookingDate.getTime() - ld.getTime();
              if (diff >= 0 && diff < bestDiff) {
                bestDiff = diff;
                bestLead = ld;
              }
            }
            if (bestLead) {
              totalDays += bestDiff / (1000 * 60 * 60 * 24);
              count++;
            }
          }
          if (count > 0) {
            timeToCloseDays = (totalDays / count).toFixed(1);
          }
        }
      }

      // Revenue contribution
      const revenueContributionPercent = totalTeamRevenue > 0
        ? ((curr.revenue / totalTeamRevenue) * 100).toFixed(1) + "%"
        : "N/A";

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
        rank: 0,
        targetBookings,
        targetProfit,
        achievementBookingsPercent,
        achievementRevenuePercent,
        avgDealSize,
        timeToCloseDays,
        revenueContributionPercent,
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

    // Overall target achievement
    const totalTargetBookings = rows.reduce((sum, r) => sum + r.targetBookings, 0);
    const overallTargetAchievement = totalTargetBookings > 0
      ? ((totalBookings / totalTargetBookings) * 100).toFixed(1) + "%"
      : "N/A";

    // Team averages
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

    // Month display strings
    const monthDisplayStr = fmtMonthYear(thisMonth.start);
    const monthRangeStr = `${fmtDate(thisMonth.start)} - ${fmtDate(new Date(thisMonth.end.getTime() - 86400000))}`;
    const reportMonthStr = `${thisMonth.start.getFullYear()}-${String(thisMonth.start.getMonth() + 1).padStart(2, "0")}`;

    // ─── Generate CSV ───────────────────────────────────────────────────────────

    const csvHeader = "Person,Calls,Emails,WhatsApp,Stage_Moves,Followups_Done,New_Leads,Bookings,Revenue,Closing_Rate_Percent,Improvement_vs_Previous,Total_Score,Rank,Target_Bookings,Target_Profit,Achievement_Percent,Avg_Deal_Size,Time_To_Close_Days,Revenue_Contribution_Percent";
    const csvRows = rows.map((r) => {
      // Quote all string fields for RFC 4180 compliance
      const quotedName = `"${r.name.replace(/"/g, '""')}"`;
      const quotedClosingRate = `"${r.closingRate}"`;
      const quotedImprovement = `"${r.improvement}"`;
      const quotedAchievement = `"${r.achievementBookingsPercent}"`;
      const quotedAvgDealSize = `"${r.avgDealSize}"`;
      const quotedTimeToClose = `"${r.timeToCloseDays}"`;
      const quotedRevenueContrib = `"${r.revenueContributionPercent}"`;
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
        r.targetBookings,
        r.targetProfit,
        quotedAchievement,
        quotedAvgDealSize,
        quotedTimeToClose,
        quotedRevenueContrib,
      ].join(",");
    });

    const csvContent = [csvHeader, ...csvRows].join("\n");
    const base64CSV = btoa(unescape(encodeURIComponent(csvContent)));

    // ─── Build ADMIN HTML ──────────────────────────────────────────────────────

    const htmlRows = rows.map((r) => {
      const improvementColor = r.improvement.startsWith("+") ? "#16a34a" : r.improvement.startsWith("-") ? "#dc2626" : "#64748b";
      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-weight:500">${r.name}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center">${r.calls}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center">${r.emails}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center">${r.whatsapp}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center">${r.stageChanges}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center">${r.followupsCompleted}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center">${r.leadsCreated}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:600;color:#16a34a">${r.bookings}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:600;color:#7c3aed">&#8377;${r.revenue.toLocaleString("en-IN")}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center">${r.targetBookings}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center">&#8377;${r.targetProfit.toLocaleString("en-IN")}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:500">${r.achievementBookingsPercent}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center">${r.avgDealSize === "N/A" ? "N/A" : "&#8377;" + Number(r.avgDealSize).toLocaleString("en-IN")}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center">${r.closingRate}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center">${r.revenueContributionPercent}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center;color:${improvementColor};font-weight:500">${r.improvement}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;color:#1e40af">#${r.rank}</td>
      </tr>`;
    }).join("");

    const adminHtml = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:1100px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#1e40af,#7c3aed);padding:20px 24px;border-radius:8px 8px 0 0">
          <h2 style="margin:0;color:#fff;font-size:18px">&#128202; Monthly Sales Performance Report</h2>
          <p style="margin:4px 0 0;color:#e0e7ff;font-size:13px">${monthDisplayStr} (${monthRangeStr})</p>
        </div>
        <div style="padding:24px;background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
          
          <!-- Summary cards -->
          <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
            <div style="flex:1;min-width:130px;padding:12px 16px;background:#faf5ff;border-radius:8px;text-align:center">
              <div style="font-size:22px;font-weight:700;color:#7c3aed">&#8377;${totalRevenue.toLocaleString("en-IN")}</div>
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Total Revenue</div>
            </div>
            <div style="flex:1;min-width:130px;padding:12px 16px;background:#f0f9ff;border-radius:8px;text-align:center">
              <div style="font-size:22px;font-weight:700;color:#1e40af">${overallTargetAchievement}</div>
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Target Achievement</div>
            </div>
            <div style="flex:1;min-width:130px;padding:12px 16px;background:#f0fdf4;border-radius:8px;text-align:center">
              <div style="font-size:22px;font-weight:700;color:#16a34a">${totalBookings}</div>
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Bookings</div>
            </div>
            <div style="flex:1;min-width:130px;padding:12px 16px;background:#fefce8;border-radius:8px;text-align:center">
              <div style="font-size:22px;font-weight:700;color:#ca8a04">&#127942; ${topName}</div>
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Top Performer</div>
            </div>
          </div>

          <!-- Per-person table -->
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:11px;border:1px solid #e2e8f0;border-radius:6px">
              <thead>
                <tr style="background:#f8fafc">
                  <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #e2e8f0">Person</th>
                  <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #e2e8f0">&#128222; Calls</th>
                  <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #e2e8f0">&#9993;&#65039; Emails</th>
                  <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #e2e8f0">&#128172; WA</th>
                  <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #e2e8f0">&#128260; Moves</th>
                  <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #e2e8f0">&#9989; FU</th>
                  <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #e2e8f0">&#10133; Leads</th>
                  <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #e2e8f0">&#128176; Bookings</th>
                  <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #e2e8f0">&#128178; Revenue</th>
                  <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #e2e8f0">&#127919; Tgt Bkgs</th>
                  <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #e2e8f0">&#127919; Tgt Profit</th>
                  <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #e2e8f0">Achievement %</th>
                  <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #e2e8f0">Avg Deal</th>
                  <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #e2e8f0">Close %</th>
                  <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #e2e8f0">Rev Contrib %</th>
                  <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #e2e8f0">&#128200; MoM</th>
                  <th style="padding:6px 8px;text-align:center;border-bottom:2px solid #e2e8f0">&#127941; Rank</th>
                </tr>
              </thead>
              <tbody>${htmlRows}</tbody>
            </table>
          </div>

          <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;text-align:center">
            Auto-generated by EaseMyOffice CRM &middot; Sent on 1st of every month at 9:00 AM IST &middot; CSV report attached
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
            <h2 style="margin:0;color:#fff;font-size:18px">&#128202; Your Monthly Performance Summary</h2>
            <p style="margin:4px 0 0;color:#e0e7ff;font-size:13px">${monthDisplayStr} (${monthRangeStr})</p>
          </div>
          <div style="padding:24px;background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
            
            <h3 style="margin:0 0 16px;color:#1e293b">Hi ${row.name}! Here's your monthly performance:</h3>

            <!-- Rank, MoM, and Score cards -->
            <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
              <div style="flex:1;min-width:120px;padding:12px 16px;background:#f0f9ff;border-radius:8px;text-align:center">
                <div style="font-size:28px;font-weight:700;color:#1e40af">#${row.rank}</div>
                <div style="font-size:11px;color:#64748b;text-transform:uppercase">Rank (of ${rows.length})</div>
              </div>
              <div style="flex:1;min-width:120px;padding:12px 16px;background:#faf5ff;border-radius:8px;text-align:center">
                <div style="font-size:28px;font-weight:700;color:${improvementColor}">${row.improvement}</div>
                <div style="font-size:11px;color:#64748b;text-transform:uppercase">Month-over-Month</div>
              </div>
              <div style="flex:1;min-width:120px;padding:12px 16px;background:#f0fdf4;border-radius:8px;text-align:center">
                <div style="font-size:28px;font-weight:700;color:#16a34a">${row.totalScore}</div>
                <div style="font-size:11px;color:#64748b;text-transform:uppercase">Total Score</div>
              </div>
            </div>

            <!-- Target vs Actual -->
            <div style="margin-bottom:20px;padding:16px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px">
              <h4 style="margin:0 0 12px;color:#92400e;font-size:14px">&#127919; Target vs Actual</h4>
              <div style="display:flex;gap:16px;flex-wrap:wrap">
                <div style="flex:1;min-width:150px">
                  <div style="font-size:12px;color:#64748b">Bookings Target</div>
                  <div style="font-size:16px;font-weight:600">${row.bookings} / ${row.targetBookings || "N/A"}</div>
                  <div style="font-size:12px;color:#1e40af;font-weight:500">${row.achievementBookingsPercent} achieved</div>
                </div>
                <div style="flex:1;min-width:150px">
                  <div style="font-size:12px;color:#64748b">Profit Target</div>
                  <div style="font-size:16px;font-weight:600">&#8377;${row.revenue.toLocaleString("en-IN")} / ${row.targetProfit > 0 ? "&#8377;" + row.targetProfit.toLocaleString("en-IN") : "N/A"}</div>
                  <div style="font-size:12px;color:#1e40af;font-weight:500">${row.achievementRevenuePercent} achieved</div>
                </div>
              </div>
            </div>

            <!-- Key metrics -->
            <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
              <div style="flex:1;min-width:120px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;text-align:center">
                <div style="font-size:18px;font-weight:700;color:#7c3aed">${row.avgDealSize === "N/A" ? "N/A" : "&#8377;" + Number(row.avgDealSize).toLocaleString("en-IN")}</div>
                <div style="font-size:10px;color:#64748b;text-transform:uppercase">Avg Deal Size</div>
              </div>
              <div style="flex:1;min-width:120px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;text-align:center">
                <div style="font-size:18px;font-weight:700;color:#7c3aed">${row.timeToCloseDays === "N/A" ? "N/A" : row.timeToCloseDays + " days"}</div>
                <div style="font-size:10px;color:#64748b;text-transform:uppercase">Avg Time to Close</div>
              </div>
              <div style="flex:1;min-width:120px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;text-align:center">
                <div style="font-size:18px;font-weight:700;color:#7c3aed">${row.revenueContributionPercent}</div>
                <div style="font-size:10px;color:#64748b;text-transform:uppercase">Revenue Contribution</div>
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
              You ranked <strong>${row.rank}${rankSuffix}</strong> out of ${rows.length} team members this month. Keep pushing! &#128170;
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
            subject: `📊 Monthly Sales Report | ${monthDisplayStr} | ${totalBookings} bookings, ₹${totalRevenue.toLocaleString("en-IN")} revenue`,
            html: adminHtml,
            attachments: [
              {
                filename: `monthly-sales-report-${reportMonthStr}.csv`,
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
      if (!row) continue;
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
            subject: `📊 ${firstName}, your monthly performance | ${monthDisplayStr} | Rank #${row.rank} of ${rows.length}`,
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
      reportMonth: monthDisplayStr,
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
