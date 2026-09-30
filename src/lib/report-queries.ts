// Data fetching for the Sales Reports panel.
//
// One TanStack query per period: every row needed for the whole page is pulled
// in a single Promise.all, then handed to the pure aggregation in
// report-metrics.ts. Filtering is done SERVER-side on the period bounds — the
// legacy reports.tsx pulls entire tables and filters in the browser, which does
// not scale and is what this deliberately avoids.
//
// Scoping mirrors dashboard-queries.ts: admin and cross-team roles see
// everything, a sales/bd rep sees only their own rows. `scopeKey` is folded into
// the query key so one user's numbers can never be served from another's cache.

import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DashboardScope } from "@/lib/dashboard-queries";
import { buildReport, bookingRevenue } from "@/lib/report-metrics";
import type { ReportResult, BookingRow, LeadRow } from "@/lib/report-metrics";
import { isRenewalBooking, type BookingKindFields } from "@/lib/booking-kind";
import type { ResolvedPeriod } from "@/lib/report-period";

// Matches the ceiling used elsewhere in the app. Reports surface when they hit
// it (see `truncated`) rather than silently under-reporting.
const ROW_LIMIT = 5000;

const scopeKey = (s: DashboardScope) => (s.scoped && s.uid ? `mine:${s.uid}` : "all");

/** Bookings are owned via any of three columns, none of which is guaranteed set. */
const BOOKING_SCOPE_COLS = (uid: string) =>
  `sales_agent_id.eq.${uid},assigned_to.eq.${uid},created_by.eq.${uid}`;

const LEAD_SCOPE_COLS = (uid: string) => `assigned_to.eq.${uid},created_by.eq.${uid}`;

type WithOr<Q> = Q & { or: (f: string) => Q };
const applyOr = <Q>(q: Q, scope: DashboardScope, cols: (uid: string) => string): Q => {
  if (scope.scoped && scope.uid) return (q as WithOr<Q>).or(cols(scope.uid));
  return q;
};

async function fetchLeads(
  scope: DashboardScope,
  fromISO: string,
  toISO: string,
): Promise<{ rows: LeadRow[]; truncated: boolean }> {
  let q = supabase
    .from("leads")
    .select("id, assigned_to, stage, created_at, source")
    .gte("created_at", fromISO)
    .lte("created_at", toISO);
  q = applyOr(q, scope, LEAD_SCOPE_COLS);
  const { data } = await q.limit(ROW_LIMIT);
  const rows = (data ?? []) as LeadRow[];
  return { rows, truncated: rows.length >= ROW_LIMIT };
}

async function fetchBookings(
  scope: DashboardScope,
  fromDate: string,
  toDate: string,
): Promise<{ rows: BookingRow[]; truncated: boolean }> {
  let q = supabase
    .from("bookings")
    .select(
      "id, sales_agent_id, sales_agent_name, booking_date, total_amount, amount_after_tds, amount_received, lead_id, booking_source, external_booking_id, renewal_status",
    )
    // booking_date is a `date` column, so compare with YYYY-MM-DD, not an
    // instant — passing an ISO timestamp here silently drops the last day.
    .gte("booking_date", fromDate)
    .lte("booking_date", toDate);
  q = applyOr(q, scope, BOOKING_SCOPE_COLS);
  const { data } = await q.limit(ROW_LIMIT);
  const all = (data ?? []) as (BookingRow & BookingKindFields)[];
  // Renewals are not new-business closures (Booking ID …R1 etc., see
  // isRenewalBooking). Filtered after the fetch so truncation still reflects
  // the raw row count.
  const rows = all.filter((b) => !isRenewalBooking(b));
  return { rows, truncated: all.length >= ROW_LIMIT };
}

export type SalesReport = ReportResult & {
  /** Same metrics for the preceding equal-length window, for growth deltas. */
  previous: {
    closures: number;
    revenue: number;
    leadsAssigned: number;
    conversionPct: number;
    byAgent: Map<string, { closures: number; revenue: number }>;
  };
  /** True when any underlying query hit the row ceiling. */
  truncated: boolean;
};

export const salesReportQuery = (scope: DashboardScope, period: ResolvedPeriod) =>
  queryOptions({
    queryKey: ["sales-report", scopeKey(scope), period.id, period.fromISO, period.toISO] as const,
    staleTime: 60_000,
    queryFn: async (): Promise<SalesReport> => {
      const [
        leadsRes,
        bookingsRes,
        activitiesRes,
        doneRes,
        overdueRes,
        profilesRes,
        prevLeadsRes,
        prevBookingsRes,
      ] = await Promise.all([
        fetchLeads(scope, period.fromISO, period.toISO),
        fetchBookings(scope, period.fromDate, period.toDate),

        // Activity is credited to the ACTOR, so a scoped rep filters on
        // actor_id rather than on lead ownership — "calls I made", not "calls
        // on my leads".
        (async () => {
          let q = supabase
            .from("lead_activities")
            .select("actor_id, type, title, payload, created_at")
            .gte("created_at", period.fromISO)
            .lte("created_at", period.toISO);
          if (scope.scoped && scope.uid) q = q.eq("actor_id", scope.uid);
          const { data } = await q.limit(ROW_LIMIT);
          return { rows: data ?? [], truncated: (data ?? []).length >= ROW_LIMIT };
        })(),

        // Follow-ups completed WITHIN the period.
        (async () => {
          let q = supabase
            .from("follow_ups")
            .select("owner_id, status, due_at, completed_at")
            .eq("status", "done")
            .gte("completed_at", period.fromISO)
            .lte("completed_at", period.toISO);
          if (scope.scoped && scope.uid) q = q.eq("owner_id", scope.uid);
          const { data } = await q.limit(ROW_LIMIT);
          return data ?? [];
        })(),

        // Overdue is a CURRENT state, not a period event: a follow-up that is
        // late right now matters regardless of which window is being viewed,
        // so this one is deliberately not period-filtered.
        (async () => {
          let q = supabase
            .from("follow_ups")
            .select("owner_id, status, due_at, completed_at")
            .eq("status", "pending")
            .lt("due_at", new Date().toISOString());
          if (scope.scoped && scope.uid) q = q.eq("owner_id", scope.uid);
          const { data } = await q.limit(ROW_LIMIT);
          return data ?? [];
        })(),

        // profiles is readable by everyone (profiles_select_all), so the
        // leaderboard can always resolve display names.
        (async () => {
          const { data } = await supabase.from("profiles").select("id, full_name, email");
          return data ?? [];
        })(),

        fetchLeads(scope, period.previous.fromISO, period.previous.toISO),
        fetchBookings(scope, period.previous.fromDate, period.previous.toDate),
      ]);

      const report = buildReport({
        leads: leadsRes.rows,
        bookings: bookingsRes.rows,
        activities: activitiesRes.rows,
        followUps: [...doneRes, ...overdueRes],
        profiles: profilesRes,
        period,
      });

      // Previous window: only what growth is displayed on, so no activity or
      // follow-up queries are repeated.
      const byAgent = new Map<string, { closures: number; revenue: number }>();
      for (const b of prevBookingsRes.rows) {
        const id = b.sales_agent_id;
        if (!id) continue;
        const cur = byAgent.get(id) ?? { closures: 0, revenue: 0 };
        cur.closures++;
        cur.revenue += bookingRevenue(b);
        byAgent.set(id, cur);
      }
      const prevClosures = prevBookingsRes.rows.length;
      const prevLeads = prevLeadsRes.rows.filter((l) => !!l.assigned_to).length;

      return {
        ...report,
        previous: {
          closures: prevClosures,
          revenue: Math.round(prevBookingsRes.rows.reduce((s, b) => s + bookingRevenue(b), 0)),
          leadsAssigned: prevLeads,
          conversionPct: prevLeads > 0 ? Math.round((prevClosures / prevLeads) * 100) : 0,
          byAgent,
        },
        truncated:
          leadsRes.truncated ||
          bookingsRes.truncated ||
          activitiesRes.truncated ||
          prevBookingsRes.truncated,
      };
    },
  });
