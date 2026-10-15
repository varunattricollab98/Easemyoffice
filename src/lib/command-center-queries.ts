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
  inRangeDate,
  bestReferralDate,
  monthKeyFromDate,
  type SalesSummary,
  type DocSummary,
  type AttendanceSummary,
  type PayrollSummary,
  type RenewalSummary,
  type CommandCenterFilter,
} from "@/lib/command-center";
import { resolvePeriod } from "@/lib/report-period";
import { DEFAULT_TAT_DAYS } from "@/lib/documentation";
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
  /**
   * Resolved-window labels so the UI can accurately caption the dashboard:
   * the selected period's human label and bounds, plus the day the Attendance
   * block actually resolved to.
   */
  meta: {
    periodLabel: string;
    fromDate: string;
    toDate: string;
    attendanceDay: string;
  };
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

/**
 * The single YYYY-MM-DD date the Attendance block is scoped to. When a `day`
 * filter is supplied we use it verbatim; otherwise we fall back to today.
 *
 * Built from LOCAL date parts (getFullYear/getMonth/getDate), NOT
 * `new Date().toISOString().slice(0, 10)` — the latter renders the UTC date,
 * which drifts to the previous/next calendar day in non-UTC timezones (the
 * bug this replaces). attendance.work_date is a plain `date` so the day string
 * must match the user's local calendar day.
 */
function dayRange(day?: string | null): string {
  if (day) return day;
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Conditionally apply an inclusive window to a Supabase query builder. When
// `unbounded` is true (period 'all') NO bounds are applied, so the read is a
// true all-time read that matches every row — including future-dated business
// dates such as a forward-dated bookings.booking_date — reproducing the
// pre-change dashboard numbers exactly. resolvePeriod's 'all' window still caps
// its upper bound at end-of-today (correct for the sales-reports / b2b-analytics
// captions that render period.toDate), so we deliberately skip the bounds HERE
// rather than widen resolvePeriod and risk misleading those shared callers.
function withWindow<Q extends { gte: (c: string, v: string) => Q; lte: (c: string, v: string) => Q }>(
  q: Q,
  column: string,
  from: string,
  to: string,
  unbounded: boolean,
): Q {
  if (unbounded) return q;
  return q.gte(column, from).lte(column, to);
}

async function fetchCommandCenter(
  filter: CommandCenterFilter = { period: "all" },
): Promise<CommandCenterData> {
  const now = Date.now();

  // Resolve the selected window ONCE. fromISO/toISO filter timestamptz columns;
  // fromDate/toDate filter plain `date` columns.
  const period = resolvePeriod(filter.period, { from: filter.from, to: filter.to });

  // Period 'all' means a truly unbounded, all-time read on BOTH ends. We skip
  // the ranged bounds entirely here (rather than relying on resolvePeriod's
  // epoch→end-of-today window) so that a legitimately future-dated row — e.g. a
  // forward-dated bookings.booking_date contract — is counted exactly as the
  // pre-change unbounded dashboard counted it. resolvePeriod stays untouched so
  // the sales-reports / b2b-analytics pages that render period.toDate are not
  // affected.
  const isAll = filter.period === "all";

  // --- Sales + Business Overview (leads + bookings) -----------------------
  // leads.created_at is timestamptz -> fromISO/toISO. bookings.booking_date is
  // the business-meaningful `date` column (consistent with the bookings page
  // filter) -> fromDate/toDate.
  const [leadRows, bookingRows] = await Promise.all([
    safeSelect<{ stage: string | null; created_at: string | null }>(() =>
      withWindow(
        supabase.from("leads").select("stage, created_at"),
        "created_at",
        period.fromISO,
        period.toISO,
        isAll,
      ).limit(ROW_LIMIT),
    ),
    safeSelect<{
      amount_after_tds: number | string | null;
      total_amount: number | string | null;
      booking_source: string | null;
    }>(() =>
      withWindow(
        supabase.from("bookings").select("amount_after_tds, total_amount, booking_source"),
        "booking_date",
        period.fromDate,
        period.toDate,
        isAll,
      ).limit(ROW_LIMIT),
    ),
  ]);
  const sales = salesSummary(leadRows, bookingRows);

  // POINT-IN-TIME: Open Pipeline is a current-state count of leads that are
  // still open right now, so it must NOT shift with the selected range. Read
  // the open-lead count from an unfiltered current-state query and overwrite
  // the range-scoped pipelineOpen that salesSummary computed above.
  const openLeadRows = await safeSelect<{ stage: string | null }>(() =>
    supabase.from("leads").select("stage").limit(ROW_LIMIT),
  );
  sales.pipelineOpen = salesSummary(openLeadRows, []).pipelineOpen;

  // --- B2B rollups (reuse the analytics dataset shapes) -------------------
  const db = b2bDb();
  const [b2bLeads, b2bActivities, b2bReferralsRaw, b2bFirms, b2bFollowups] = await Promise.all([
    // b2b_leads.created_at is timestamptz.
    safeSelect<AnalyticsLead>(() =>
      withWindow(
        db
          .from("b2b_leads")
          .select(
            "id, firm_id, assigned_to, lead_status, lead_source, city, state, firm_type, created_at, last_contacted_at",
          ),
        "created_at",
        period.fromISO,
        period.toISO,
        isAll,
      ).limit(ROW_LIMIT),
    ),
    // b2b_activities.happened_at is timestamptz.
    safeSelect<AnalyticsActivity>(() =>
      withWindow(
        db.from("b2b_activities").select("firm_id, lead_id, type, created_by, happened_at"),
        "happened_at",
        period.fromISO,
        period.toISO,
        isAll,
      ).limit(ROW_LIMIT),
    ),
    // referrals carry referral_date / date_received / created_at. Fetch
    // leniently on the primary referral_date column but also pull rows whose
    // referral_date is null (they may still fall in range via date_received /
    // created_at), then do the AUTHORITATIVE range check in JS below on the
    // best available date so no referral is wrongly dropped.
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
    // b2b_followups.due_at is timestamptz. We scope the FETCH window to the
    // selected range so range-aware consumers see the right rows, but the
    // overdue computation inside activityBreakdown still measures against real
    // `now` (see the POINT-IN-TIME note at the activity breakdown below).
    safeSelect<AnalyticsFollowup>(() =>
      withWindow(
        db.from("b2b_followups").select("assigned_to, status, due_at, completed_at"),
        "due_at",
        period.fromISO,
        period.toISO,
        isAll,
      ).limit(ROW_LIMIT),
    ),
  ]);

  // Authoritative referral range filter on the best available date so rows
  // that only carry date_received / created_at are not lost (referral_date is
  // a plain `date`, so compare on fromDate/toDate). Under 'all' the window is
  // unbounded, so keep every referral (including any future-dated one) to match
  // the pre-change all-time count.
  const b2bReferrals = isAll
    ? b2bReferralsRaw
    : b2bReferralsRaw.filter((r) =>
        inRangeDate(bestReferralDate(r), period.fromDate, period.toDate),
      );

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
  // The range-scoped follow-ups feed the activity rollup (calls/emails/etc.).
  const activity = activityBreakdown(b2bActivities, b2bFollowups, now);

  // POINT-IN-TIME: overdue follow-ups is an operational "what's late right
  // now" count measured against real `now`, so it must NOT shift with the
  // selected range (a past window would hide today's overdue items). Compute
  // it from an UNFILTERED current-state read of pending follow-ups and
  // override the range-scoped overdue the activity rollup produced above.
  const allFollowups = await safeSelect<AnalyticsFollowup>(() =>
    db
      .from("b2b_followups")
      .select("assigned_to, status, due_at, completed_at")
      .limit(ROW_LIMIT),
  );
  activity.overdueFollowups = allFollowups.filter(
    (f) => f.status === "pending" && f.due_at && new Date(f.due_at).getTime() < now,
  ).length;

  // POINT-IN-TIME: Active CA Partners and total Partners come from
  // ca_firms.partner_status, which is a current-state snapshot of the
  // partnership, not an event in the window. They stay unfiltered so the tiles
  // reflect the live partner book regardless of the selected period.
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
  // POINT-IN-TIME: the whole renewals block is a forward-looking current-state
  // view — due/pending/completed/dormant are all defined relative to real
  // `now`. Scoping it to an arbitrary past window would make "due" meaningless,
  // so this stays unfiltered and is measured against `now`, independent of the
  // selected period.
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
  // documentation_tasks.created_at is timestamptz -> fromISO/toISO. The counted
  // task set respects the window (completed/pending/delayed then reflect tasks
  // CREATED in the window), while docSummary still receives real `now` so TAT
  // breaches are measured against the present, not the window edge.
  const docRows = await safeSelect<{
    stage: string | null;
    escalated: boolean | null;
    created_at: string | null;
    updated_at: string | null;
  }>(() =>
    withWindow(
      supabase.from("documentation_tasks").select("stage, escalated, created_at, updated_at"),
      "created_at",
      period.fromISO,
      period.toISO,
      isAll,
    ).limit(ROW_LIMIT),
  );
  // Same 3-day TAT as the Documentation pipeline (src/lib/documentation.ts).
  const documentation = docSummary(docRows, now, DEFAULT_TAT_DAYS);

  // --- Attendance (driven by the Day filter, not the period range) --------
  // Attendance is a day-level view: it is scoped by filter.day (a single
  // YYYY-MM-DD) and falls back to today when no day is chosen. attendance.
  // work_date is a plain `date`, so we compare a single local-date string on
  // both bounds; the approved-leave overlap uses the same day.
  const attendanceDay = dayRange(filter.day);
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
      .gte("work_date", attendanceDay)
      .lte("work_date", attendanceDay)
      .limit(ROW_LIMIT),
  );
  const leaveToday = await safeSelect<{ status: string | null }>(() =>
    hrmsDb()
      .from("leave_requests")
      .select("status")
      .eq("status", "approved")
      .lte("from_date", attendanceDay)
      .gte("to_date", attendanceDay)
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

  // --- Payroll (monthly salary slips) -------------------------------------
  // Payroll is intentionally a MONTHLY view. When a period is selected we show
  // the month at the end of the window (period.toDate -> YYYY-MM-01); with no
  // explicit period ('all' resolves toDate to the end of today) this naturally
  // lands on the current month, preserving the pre-change behavior.
  const monthStart = new Date();
  monthStart.setDate(1);
  const currentMonthKey = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}-01`;
  const monthKey = monthKeyFromDate(period.toDate) ?? currentMonthKey;
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
    meta: {
      periodLabel: period.label,
      fromDate: period.fromDate,
      toDate: period.toDate,
      attendanceDay,
    },
  };
}

/**
 * TanStack query for the whole admin command-center dataset. The filter is part
 * of the query key (period + custom bounds + day) so changing any filter
 * refetches and caches independently. Defaults to period 'all' so the existing
 * (FEAT-004-pending) call site keeps compiling and reproduces the all-time
 * dashboard until the component threads a real filter through.
 */
export const commandCenterQuery = (filter: CommandCenterFilter = { period: "all" }) =>
  queryOptions({
    queryKey: [
      "admin-command-center",
      filter.period,
      filter.from ?? null,
      filter.to ?? null,
      filter.day ?? null,
    ] as const,
    staleTime: 60_000,
    queryFn: () => fetchCommandCenter(filter),
  });
