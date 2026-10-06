// Data fetching for the Admin command-center dashboard (spec section 23).
//
// Admin-only: every query here is only ever run from the admin command center,
// which is itself gated on isAdmin. RLS is still the real boundary (admins have
// full-read policies on every module table). Each fetch is defensive — a table
// that is not deployed yet, or that an unexpected role cannot read, resolves to
// an empty result rather than throwing, mirroring how dashboard-queries.ts
// guards the optional telecmi_call_events table. That keeps the command center
// resilient and never leaks another module's data to a non-admin (the component
// is not rendered for them at all).
//
// The cross-module KPI maths lives in the pure, tested src/lib/command-center.ts
// and src/lib/b2b-analytics.ts; this module only moves data and maps rows into
// those structural shapes.

import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { b2bDb } from "@/lib/b2b";
import { hrmsDb } from "@/lib/hrms";
import {
  salesSummary,
  docSummary,
  attendanceSummary,
  payrollSummary,
  type SalesSummary,
  type DocSummary,
  type AttendanceSummary,
  type PayrollSummary,
  type RenewalSummary,
} from "@/lib/command-center";
import {
  buildFunnel,
  activityBreakdown,
  employeeLeaderboard,
  bookingValue,
  type AnalyticsActivity,
  type AnalyticsFirm,
  type AnalyticsFollowup,
  type AnalyticsLead,
  type AnalyticsReferral,
  type EmployeeRow,
} from "@/lib/b2b-analytics";

const ROW_LIMIT = 5000;

/** The B2B rollups the command center shows. */
export type CcB2BSummary = {
  prospects: number;
  contacted: number;
  contactRate: number;
  meetings: number;
  activePartners: number;
  totalPartners: number;
  referrals: number;
  convertedReferrals: number;
  b2bBookings: number;
  b2bRevenue: number;
  overdueFollowups: number;
  topEmployees: EmployeeRow[];
  topPartners: { firmId: string; firmName: string; revenue: number; referrals: number }[];
};

export type CommandCenterData = {
  businessOverview: {
    totalSalesLeads: number;
    totalB2BProspects: number;
    activeCaPartners: number;
    totalReferrals: number;
    totalBookings: number;
    totalRevenue: number;
  };
  sales: SalesSummary;
  b2b: CcB2BSummary;
  renewals: RenewalSummary;
  documentation: DocSummary;
  attendance: AttendanceSummary;
  payroll: PayrollSummary;
};

/** Run a Supabase select, returning [] (never throwing) if the table is unreadable. */
async function safeSelect<T>(
  run: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  try {
    const { data, error } = await run();
    if (error) return [];
    return (data ?? []) as T[];
  } catch {
    return [];
  }
}

function todayRange(): { start: string; end: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

async function fetchCommandCenter(): Promise<CommandCenterData> {
  const now = Date.now();

  // --- Sales + Business Overview (leads + bookings) -----------------------
  const [leadRows, bookingRows] = await Promise.all([
    safeSelect<{ stage: string | null; created_at: string | null }>(() =>
      supabase.from("leads").select("stage, created_at").limit(ROW_LIMIT),
    ),
    safeSelect<{
      amount_after_tds: number | string | null;
      total_amount: number | string | null;
      booking_source: string | null;
    }>(() =>
      supabase
        .from("bookings")
        .select("amount_after_tds, total_amount, booking_source")
        .limit(ROW_LIMIT),
    ),
  ]);
  const sales = salesSummary(leadRows, bookingRows);

  // --- B2B rollups (reuse the analytics dataset shapes) -------------------
  const db = b2bDb();
  const [b2bLeads, b2bActivities, b2bReferrals, b2bFirms, b2bFollowups] = await Promise.all([
    safeSelect<AnalyticsLead>(() =>
      db
        .from("b2b_leads")
        .select(
          "id, firm_id, assigned_to, lead_status, lead_source, city, state, firm_type, created_at, last_contacted_at",
        )
        .limit(ROW_LIMIT),
    ),
    safeSelect<AnalyticsActivity>(() =>
      db
        .from("b2b_activities")
        .select("firm_id, lead_id, type, created_by, happened_at")
        .limit(ROW_LIMIT),
    ),
    safeSelect<AnalyticsReferral & { firm_id: string | null }>(() =>
      db
        .from("referrals")
        .select(
          "firm_id, assigned_salesperson, converted, booking_id, revenue, referral_date, date_received, created_at",
        )
        .limit(ROW_LIMIT),
    ),
    safeSelect<AnalyticsFirm>(() =>
      db
        .from("ca_firms")
        .select(
          "id, firm_name, assigned_to, partner_status, partner_since, lead_source, firm_type, city, state, created_at",
        )
        .limit(ROW_LIMIT),
    ),
    safeSelect<AnalyticsFollowup>(() =>
      db.from("b2b_followups").select("assigned_to, status, due_at, completed_at").limit(ROW_LIMIT),
    ),
  ]);

  // Revenue of the bookings the referrals actually link to (single source of
  // truth: amount_after_tds || total_amount).
  const bookingIds = Array.from(
    new Set(b2bReferrals.map((r) => r.booking_id).filter((id): id is string => !!id)),
  );
  const bookingRevenue = new Map<string, number>();
  if (bookingIds.length > 0) {
    const linked = await safeSelect<{
      id: string;
      amount_after_tds: number | string | null;
      total_amount: number | string | null;
    }>(() => db.from("bookings").select("id, amount_after_tds, total_amount").in("id", bookingIds));
    for (const b of linked) bookingRevenue.set(b.id, bookingValue(b));
  }

  const funnel = buildFunnel(b2bLeads);
  const topOrder = (id: string) => funnel.find((s) => s.id === id)?.count ?? 0;
  const contacted = topOrder("contacted");
  const meetings = topOrder("meeting_discussion");
  const activity = activityBreakdown(b2bActivities, b2bFollowups, now);
  const activePartners = b2bFirms.filter((f) =>
    ["strategic", "active"].includes(f.partner_status ?? ""),
  ).length;
  const totalPartners = b2bFirms.filter((f) => !!f.partner_status).length;
  const convertedReferrals = b2bReferrals.filter((r) => r.converted || r.booking_id).length;
  const b2bBookings = b2bReferrals.filter((r) => !!r.booking_id).length;
  const b2bRevenue = Math.round(
    b2bReferrals.reduce(
      (s, r) =>
        s + (r.booking_id ? (bookingRevenue.get(r.booking_id) ?? (Number(r.revenue) || 0)) : 0),
      0,
    ),
  );
  const topEmployees = employeeLeaderboard({
    leads: b2bLeads,
    activities: b2bActivities,
    referrals: b2bReferrals,
    firms: b2bFirms,
    followups: b2bFollowups,
    bookingRevenue,
  }).slice(0, 5);

  // Top CA partners by linked-booking revenue.
  const firmName = new Map<string, string>();
  for (const f of b2bFirms) if (f.id) firmName.set(f.id, f.firm_name ?? "Unknown firm");
  const perFirm = new Map<string, { revenue: number; referrals: number }>();
  for (const r of b2bReferrals) {
    if (!r.firm_id) continue;
    let bucket = perFirm.get(r.firm_id);
    if (!bucket) {
      bucket = { revenue: 0, referrals: 0 };
      perFirm.set(r.firm_id, bucket);
    }
    bucket.referrals++;
    bucket.revenue += r.booking_id
      ? (bookingRevenue.get(r.booking_id) ?? (Number(r.revenue) || 0))
      : 0;
  }
  const topPartners = Array.from(perFirm.entries())
    .map(([firmId, v]) => ({
      firmId,
      firmName: firmName.get(firmId) ?? "Unknown firm",
      revenue: Math.round(v.revenue),
      referrals: v.referrals,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.referrals - a.referrals)
    .slice(0, 5);

  const b2b: CcB2BSummary = {
    prospects: b2bLeads.length,
    contacted,
    contactRate: b2bLeads.length > 0 ? Math.round((contacted / b2bLeads.length) * 100) : 0,
    meetings,
    activePartners,
    totalPartners,
    referrals: b2bReferrals.length,
    convertedReferrals,
    b2bBookings,
    b2bRevenue,
    overdueFollowups: activity.overdueFollowups,
    topEmployees,
    topPartners,
  };

  // --- Renewals (stored on bookings, same definitions as the renewal dash) -
  const renewalRows = await safeSelect<{
    renewal_status: string | null;
    plan_expiry_date: string | null;
    renewal_followup_at: string | null;
  }>(() =>
    supabase
      .from("bookings")
      .select("renewal_status, plan_expiry_date, renewal_followup_at")
      .not("plan_expiry_date", "is", null)
      .limit(ROW_LIMIT),
  );
  const renewals = renewalRows.reduce<RenewalSummary>(
    (acc, r) => {
      const status = r.renewal_status ?? "pending";
      const isDone = status === "renewed";
      if (isDone) acc.completed++;
      else if (status === "pending") acc.pending++;
      if (!isDone && r.plan_expiry_date && new Date(r.plan_expiry_date).getTime() <= now) acc.due++;
      if (!["renewed", "cancelled", "lost", "not_interested"].includes(status)) {
        // Dormant: no scheduled follow-up and overdue / unattended.
        if (!r.renewal_followup_at) acc.dormant++;
      }
      return acc;
    },
    { due: 0, pending: 0, completed: 0, dormant: 0 },
  );

  // --- Documentation ------------------------------------------------------
  const docRows = await safeSelect<{
    stage: string | null;
    escalated: boolean | null;
    created_at: string | null;
    updated_at: string | null;
  }>(() =>
    supabase
      .from("documentation_tasks")
      .select("stage, escalated, created_at, updated_at")
      .limit(ROW_LIMIT),
  );
  const documentation = docSummary(docRows, now);

  // --- Attendance (today) -------------------------------------------------
  const { start, end } = todayRange();
  const attendanceRows = await safeSelect<{
    status: string | null;
    first_login_at: string | null;
    last_logout_at: string | null;
    is_late: boolean | null;
    worked_minutes: number | null;
  }>(() =>
    hrmsDb()
      .from("attendance")
      .select("status, first_login_at, last_logout_at, is_late, worked_minutes")
      .gte("work_date", start)
      .lte("work_date", end)
      .limit(ROW_LIMIT),
  );
  const leaveToday = await safeSelect<{ status: string | null }>(() =>
    hrmsDb()
      .from("leave_requests")
      .select("status")
      .eq("status", "approved")
      .lte("from_date", end)
      .gte("to_date", start)
      .limit(ROW_LIMIT),
  );
  // Map HRMS attendance columns into the structural shape the pure summary wants.
  const attendance = attendanceSummary(
    attendanceRows.map((r) => ({
      status: r.status,
      check_in_at: r.first_login_at,
      check_out_at: r.last_logout_at,
      late: r.is_late,
      work_minutes: r.worked_minutes,
    })),
  );
  attendance.onLeave += leaveToday.length;

  // --- Payroll (current month salary slips) -------------------------------
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthKey = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}-01`;
  const payrollRows = await safeSelect<{
    status: string | null;
    net_pay: number | string | null;
  }>(() =>
    hrmsDb().from("salary_slips").select("status, net_pay").eq("month", monthKey).limit(ROW_LIMIT),
  );
  const payroll = payrollSummary(
    payrollRows.map((r) => ({
      // salary_slips.status is 'draft' | 'final'; map 'final' to processed.
      status: r.status === "final" ? "processed" : "pending",
      net_pay: r.net_pay,
    })),
  );

  return {
    businessOverview: {
      totalSalesLeads: sales.totalLeads,
      totalB2BProspects: b2b.prospects,
      activeCaPartners: b2b.activePartners,
      totalReferrals: b2b.referrals,
      totalBookings: sales.totalBookings,
      totalRevenue: sales.totalRevenue,
    },
    sales,
    b2b,
    renewals,
    documentation,
    attendance,
    payroll,
  };
}

/** TanStack query for the whole admin command-center dataset. */
export const commandCenterQuery = () =>
  queryOptions({
    queryKey: ["admin-command-center"] as const,
    staleTime: 60_000,
    queryFn: fetchCommandCenter,
  });
