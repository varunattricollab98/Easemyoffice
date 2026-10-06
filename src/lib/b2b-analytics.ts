// Aggregation maths for the B2B Dashboard + Analytics screens.
//
// Pure functions over already-fetched rows: no Supabase, no React, no date-fns
// clock reads that are not injectable. The dashboard and the analytics routes
// fetch the raw B2B rows (leads, activities, referrals, firms, bookings,
// follow-ups, partnerships) once and every number on screen — the funnel, the
// activity counts, the per-employee leaderboard, the per-source roll-up, the
// per-month trends, revenue-per-partner — is derived here. Keeping it here (the
// booking-math.ts / report-metrics.ts convention) means the definitions live in
// one auditable place and the scoring is unit-tested (see b2b-analytics.test.ts)
// without touching the database.
//
// Row shapes are structural so they accept the hand-written B2B row types from
// src/lib/b2b.ts without importing them, and so a query can select fewer columns
// than the full table.

import { B2B_PIPELINE_STAGES, PARTNER_HEALTH } from "@/lib/b2b";

/** A `numeric` column from PostgREST can arrive as number or string. */
type Num = number | string | null | undefined;

const n = (v: Num): number => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
};

/** Integer percentage of `part` out of `whole`, 0 when there is no base. */
export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

// ---------------------------------------------------------------------------
// Structural row shapes.
// ---------------------------------------------------------------------------

export type AnalyticsLead = {
  id?: string | null;
  firm_id?: string | null;
  assigned_to?: string | null;
  lead_status?: string | null;
  lead_source?: string | null;
  city?: string | null;
  state?: string | null;
  firm_type?: string | null;
  created_at?: string | null;
  last_contacted_at?: string | null;
};

export type AnalyticsActivity = {
  firm_id?: string | null;
  lead_id?: string | null;
  type?: string | null;
  created_by?: string | null;
  happened_at?: string | null;
};

export type AnalyticsReferral = {
  firm_id?: string | null;
  assigned_salesperson?: string | null;
  converted?: boolean | null;
  booking_id?: string | null;
  revenue?: Num;
  referral_date?: string | null;
  date_received?: string | null;
  created_at?: string | null;
};

export type AnalyticsFirm = {
  id?: string | null;
  firm_name?: string | null;
  assigned_to?: string | null;
  partner_status?: string | null;
  partner_since?: string | null;
  lead_source?: string | null;
  firm_type?: string | null;
  city?: string | null;
  state?: string | null;
  created_at?: string | null;
};

export type AnalyticsFollowup = {
  assigned_to?: string | null;
  status?: string | null;
  due_at?: string | null;
  completed_at?: string | null;
};

export type AnalyticsBooking = {
  id?: string | null;
  amount_after_tds?: Num;
  total_amount?: Num;
  booking_date?: string | null;
};

/**
 * Booking revenue — the single money definition shared with the Sales reports
 * (`bookingRevenue` in report-metrics.ts): net after TDS, falling back to the
 * gross total. Re-stated here as a structural helper so the B2B maths does not
 * have to import the Sales row types.
 */
export function bookingValue(b: AnalyticsBooking): number {
  return n(b.amount_after_tds) || n(b.total_amount) || 0;
}

// ---------------------------------------------------------------------------
// Funnel — count + conversion % for each of the 10 forward pipeline stages.
//
// A lead "reaches" a stage if its current status is at or beyond that stage in
// the pipeline order. The closed/lost outcomes (not_interested, no_response, …)
// have order 0 and so sit outside the funnel; a lead in one of those states
// counts only toward whatever forward stage it actually passed through — which
// the DB does not record historically — so we count the lead at the furthest
// forward stage its CURRENT status represents. For a dead lead that current
// status is a closed outcome, which is order 0, so it is excluded from every
// funnel bar. This matches the business reading of the funnel: "how many
// prospects are at or past this stage right now".
// ---------------------------------------------------------------------------

export type FunnelStage = {
  id: string;
  label: string;
  order: number;
  /** Prospects currently at or past this stage. */
  count: number;
  /** Count as a % of the first stage (top of funnel). */
  conversionFromTop: number;
  /** Count as a % of the immediately previous stage. */
  conversionFromPrev: number;
};

/** 1-based pipeline order of a status id, or 0 when it is not a forward stage. */
function stageOrder(status: string | null | undefined): number {
  return B2B_PIPELINE_STAGES.find((s) => s.id === status)?.order ?? 0;
}

/**
 * The 10-stage funnel with per-stage counts and conversion percentages.
 * Pure — deterministic given the leads array.
 */
export function buildFunnel(leads: AnalyticsLead[]): FunnelStage[] {
  // reached[o] = how many leads have current order >= o (o is 1-based).
  const reached = new Array(B2B_PIPELINE_STAGES.length + 1).fill(0);
  for (const l of leads) {
    const o = stageOrder(l.lead_status);
    if (o <= 0) continue;
    for (let k = 1; k <= o; k++) reached[k]++;
  }
  const top = reached[1];
  return B2B_PIPELINE_STAGES.map((stage, i) => {
    const count = reached[stage.order];
    const prevCount = i === 0 ? count : reached[B2B_PIPELINE_STAGES[i - 1].order];
    return {
      id: stage.id,
      label: stage.label,
      order: stage.order,
      count,
      conversionFromTop: pct(count, top),
      conversionFromPrev: i === 0 ? 100 : pct(count, prevCount),
    };
  });
}

// ---------------------------------------------------------------------------
// Contact / response rates.
// ---------------------------------------------------------------------------

/** Statuses that mean the prospect has been contacted at least once. */
const CONTACTED_MIN_ORDER = stageOrder("contacted"); // 4

/** Statuses that mean the prospect responded with interest or beyond. */
const RESPONDED_MIN_ORDER = stageOrder("interested"); // 5

/**
 * Contact rate = prospects contacted ÷ total prospects. A prospect counts as
 * contacted if its status is at/past "Contacted" OR it carries a
 * last_contacted_at timestamp (covers leads nudged forward without a status
 * change).
 */
export function contactRate(leads: AnalyticsLead[]): {
  total: number;
  contacted: number;
  rate: number;
} {
  const total = leads.length;
  const contacted = leads.filter(
    (l) => stageOrder(l.lead_status) >= CONTACTED_MIN_ORDER || !!l.last_contacted_at,
  ).length;
  return { total, contacted, rate: pct(contacted, total) };
}

/**
 * Response rate = prospects that responded (interested or beyond) ÷ prospects
 * contacted. Measures how many contacted prospects actually engaged.
 */
export function responseRate(leads: AnalyticsLead[]): {
  contacted: number;
  responded: number;
  rate: number;
} {
  const contacted = leads.filter(
    (l) => stageOrder(l.lead_status) >= CONTACTED_MIN_ORDER || !!l.last_contacted_at,
  ).length;
  const responded = leads.filter((l) => stageOrder(l.lead_status) >= RESPONDED_MIN_ORDER).length;
  return { contacted, responded, rate: pct(responded, contacted) };
}

// ---------------------------------------------------------------------------
// Activity breakdown (Calls / WhatsApp / Email / Meetings / Follow-ups).
// ---------------------------------------------------------------------------

export type ActivityBreakdown = {
  calls: number;
  whatsapp: number;
  emails: number;
  meetings: number;
  followupsCompleted: number;
  overdueFollowups: number;
};

/**
 * Count activities by type and roll up follow-up completion / overdue. Follow-ups
 * completed are counted from the follow-up table (status 'done') when a
 * `followups` list is supplied, otherwise from 'followup' activity rows; this
 * avoids double counting the two sources. Overdue = pending follow-ups whose
 * due_at is already in the past. `now` is injectable so the overdue count is
 * deterministic in tests.
 */
export function activityBreakdown(
  activities: AnalyticsActivity[],
  followups: AnalyticsFollowup[] = [],
  now: number = Date.now(),
): ActivityBreakdown {
  const b: ActivityBreakdown = {
    calls: 0,
    whatsapp: 0,
    emails: 0,
    meetings: 0,
    followupsCompleted: 0,
    overdueFollowups: 0,
  };
  let activityFollowups = 0;
  for (const a of activities) {
    switch (a.type) {
      case "call":
        b.calls++;
        break;
      case "whatsapp":
        b.whatsapp++;
        break;
      case "email":
        b.emails++;
        break;
      case "meeting":
        b.meetings++;
        break;
      case "followup":
        activityFollowups++;
        break;
    }
  }
  let tableDone = 0;
  for (const f of followups) {
    if (f.status === "done") {
      tableDone++;
    } else if (f.status === "pending" && f.due_at && new Date(f.due_at).getTime() < now) {
      b.overdueFollowups++;
    }
  }
  b.followupsCompleted = followups.length > 0 ? tableDone : activityFollowups;
  return b;
}

// ---------------------------------------------------------------------------
// Per-source roll-up — the Source performance table and Source Analytics. The
// source list is passed in (the configurable b2b_sources table), NOT hardcoded.
// Every lead/firm/referral is bucketed by its source id; an unknown or missing
// source lands in a synthetic "unknown" bucket so nothing is dropped.
// ---------------------------------------------------------------------------

export type SourceRollup = {
  source: string;
  label: string;
  prospects: number;
  contacted: number;
  interested: number;
  meetings: number;
  partners: number;
  referrals: number;
  bookings: number;
  revenue: number;
};

/** A configurable source {id,label} from b2b_sources (or the seed constants). */
export type SourceOption = { id: string; label: string };

const MEETING_MIN_ORDER = stageOrder("meeting_discussion"); // 6
const PARTNER_MIN_ORDER = stageOrder("partner_onboarded"); // 8

/**
 * Roll up the per-source funnel through to bookings + revenue. `sources` is the
 * live configurable list; a bucket is created for every listed source so the
 * table always shows the full configured set (even sources with zero activity),
 * plus one "unknown" bucket for rows whose source is not in the list.
 */
export function sourceRollups(input: {
  sources: SourceOption[];
  leads: AnalyticsLead[];
  firms: AnalyticsFirm[];
  referrals: AnalyticsReferral[];
  /** booking id -> revenue, so a converted referral contributes revenue once. */
  bookingRevenue?: Map<string, number>;
}): SourceRollup[] {
  const bookingRevenue = input.bookingRevenue ?? new Map<string, number>();
  const labelById = new Map<string, string>();
  for (const s of input.sources) labelById.set(s.id, s.label);

  const buckets = new Map<string, SourceRollup>();
  const ensure = (id: string | null | undefined): SourceRollup => {
    const key = id && labelById.has(id) ? id : "unknown";
    let b = buckets.get(key);
    if (!b) {
      b = {
        source: key,
        label: key === "unknown" ? "Unknown" : (labelById.get(key) ?? key),
        prospects: 0,
        contacted: 0,
        interested: 0,
        meetings: 0,
        partners: 0,
        referrals: 0,
        bookings: 0,
        revenue: 0,
      };
      buckets.set(key, b);
    }
    return b;
  };

  // Pre-create every configured source so zero-activity rows still appear.
  for (const s of input.sources) ensure(s.id);

  // firm source -> firm id, so a referral/firm can resolve its source.
  const firmSource = new Map<string, string | null | undefined>();
  for (const f of input.firms) if (f.id) firmSource.set(f.id, f.lead_source);

  for (const l of input.leads) {
    const b = ensure(l.lead_source);
    b.prospects++;
    const o = stageOrder(l.lead_status);
    if (o >= CONTACTED_MIN_ORDER || l.last_contacted_at) b.contacted++;
    if (o >= RESPONDED_MIN_ORDER) b.interested++;
    if (o >= MEETING_MIN_ORDER) b.meetings++;
    if (o >= PARTNER_MIN_ORDER) b.partners++;
  }

  for (const r of input.referrals) {
    const src = r.firm_id ? firmSource.get(r.firm_id) : undefined;
    const b = ensure(src);
    b.referrals++;
    if (r.booking_id) {
      b.bookings++;
      b.revenue += bookingRevenue.get(r.booking_id) ?? n(r.revenue);
    } else {
      b.revenue += n(r.revenue);
    }
  }

  return Array.from(buckets.values()).sort(
    (a, b) => b.prospects - a.prospects || b.revenue - a.revenue || a.label.localeCompare(b.label),
  );
}

// ---------------------------------------------------------------------------
// Employee leaderboard — one row per assigned employee with every tracked
// column. Pure aggregation; display-name resolution is left to the caller.
// ---------------------------------------------------------------------------

export type EmployeeRow = {
  employeeId: string;
  prospectsAssigned: number;
  prospectsContacted: number;
  calls: number;
  followups: number;
  meetings: number;
  partnersOnboarded: number;
  referrals: number;
  bookings: number;
  revenue: number;
};

export function employeeLeaderboard(input: {
  leads: AnalyticsLead[];
  activities: AnalyticsActivity[];
  referrals: AnalyticsReferral[];
  firms: AnalyticsFirm[];
  followups?: AnalyticsFollowup[];
  bookingRevenue?: Map<string, number>;
}): EmployeeRow[] {
  const bookingRevenue = input.bookingRevenue ?? new Map<string, number>();
  const rows = new Map<string, EmployeeRow>();
  const ensure = (id: string): EmployeeRow => {
    let r = rows.get(id);
    if (!r) {
      r = {
        employeeId: id,
        prospectsAssigned: 0,
        prospectsContacted: 0,
        calls: 0,
        followups: 0,
        meetings: 0,
        partnersOnboarded: 0,
        referrals: 0,
        bookings: 0,
        revenue: 0,
      };
      rows.set(id, r);
    }
    return r;
  };

  for (const l of input.leads) {
    if (!l.assigned_to) continue;
    const r = ensure(l.assigned_to);
    r.prospectsAssigned++;
    if (stageOrder(l.lead_status) >= CONTACTED_MIN_ORDER || l.last_contacted_at)
      r.prospectsContacted++;
  }

  for (const a of input.activities) {
    if (!a.created_by) continue;
    const r = ensure(a.created_by);
    if (a.type === "call") r.calls++;
    else if (a.type === "meeting") r.meetings++;
    else if (a.type === "followup") r.followups++;
  }

  // Partners onboarded: firms assigned to the employee whose partner_status is
  // set (a partnered firm). assigned_to on the firm is the owning employee.
  const partneredStatuses = new Set(["strategic", "active", "potential"]);
  for (const f of input.firms) {
    if (!f.assigned_to) continue;
    const r = ensure(f.assigned_to);
    if (f.partner_status && partneredStatuses.has(f.partner_status)) r.partnersOnboarded++;
  }

  for (const ref of input.referrals) {
    if (!ref.assigned_salesperson) continue;
    const r = ensure(ref.assigned_salesperson);
    r.referrals++;
    if (ref.booking_id) {
      r.bookings++;
      r.revenue += bookingRevenue.get(ref.booking_id) ?? n(ref.revenue);
    } else {
      r.revenue += n(ref.revenue);
    }
  }

  if (input.followups) {
    for (const f of input.followups) {
      if (f.status === "done" && f.assigned_to) ensure(f.assigned_to).followups++;
    }
  }

  return Array.from(rows.values()).sort(
    (a, b) =>
      b.revenue - a.revenue ||
      b.partnersOnboarded - a.partnersOnboarded ||
      b.referrals - a.referrals ||
      b.prospectsAssigned - a.prospectsAssigned,
  );
}

// ---------------------------------------------------------------------------
// Revenue per partner — total referral revenue ÷ active partner firms.
// ---------------------------------------------------------------------------

export type RevenuePerPartner = {
  totalRevenue: number;
  activePartners: number;
  revenuePerPartner: number;
};

/**
 * Average revenue per active partner firm. Active = any firm whose
 * partner_status is one of the "live" categories. Revenue is the sum of
 * referral revenue (preferring the booking revenue map when present).
 */
export function revenuePerPartner(input: {
  firms: AnalyticsFirm[];
  referrals: AnalyticsReferral[];
  bookingRevenue?: Map<string, number>;
}): RevenuePerPartner {
  const bookingRevenue = input.bookingRevenue ?? new Map<string, number>();
  const activeSet = new Set(["strategic", "active"]);
  const activePartners = input.firms.filter(
    (f) => f.partner_status && activeSet.has(f.partner_status),
  ).length;
  const totalRevenue = input.referrals.reduce((sum, r) => {
    if (r.booking_id && bookingRevenue.has(r.booking_id))
      return sum + (bookingRevenue.get(r.booking_id) ?? 0);
    return sum + n(r.revenue);
  }, 0);
  return {
    totalRevenue: Math.round(totalRevenue),
    activePartners,
    revenuePerPartner: activePartners > 0 ? Math.round(totalRevenue / activePartners) : 0,
  };
}

// ---------------------------------------------------------------------------
// Partner health distribution — count of firms in each health category, driven
// by the firm's partner_status. Unknown/unset statuses are ignored.
// ---------------------------------------------------------------------------

export type HealthSlice = { id: string; label: string; count: number };

export function partnerHealthDistribution(firms: AnalyticsFirm[]): HealthSlice[] {
  const counts = new Map<string, number>();
  for (const f of firms) {
    if (!f.partner_status) continue;
    counts.set(f.partner_status, (counts.get(f.partner_status) ?? 0) + 1);
  }
  return PARTNER_HEALTH.map((h) => ({ id: h.id, label: h.label, count: counts.get(h.id) ?? 0 }));
}

// ---------------------------------------------------------------------------
// Monthly trend — count rows by YYYY-MM for the "… by month" trend charts.
// ---------------------------------------------------------------------------

export type MonthlyPoint = { month: string; count: number; revenue: number };

/** The YYYY-MM bucket for an ISO/date string, or null if it has no date. */
function monthKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Bucket rows into monthly counts (and optional revenue), sorted ascending by
 * month. `dateOf`/`revenueOf` pick the fields off each row so the same helper
 * serves prospects-by-month, referrals-by-month, revenue-by-month, etc.
 */
export function monthlyTrend<T>(
  rows: T[],
  dateOf: (row: T) => string | null | undefined,
  revenueOf?: (row: T) => number,
): MonthlyPoint[] {
  const map = new Map<string, MonthlyPoint>();
  for (const row of rows) {
    const key = monthKey(dateOf(row));
    if (!key) continue;
    let p = map.get(key);
    if (!p) {
      p = { month: key, count: 0, revenue: 0 };
      map.set(key, p);
    }
    p.count++;
    if (revenueOf) p.revenue += revenueOf(row);
  }
  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
}
