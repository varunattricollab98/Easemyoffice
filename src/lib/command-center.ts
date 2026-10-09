// Pure aggregation maths for the Admin command-center dashboard (spec section
// 23). Every number on the admin command center is derived here from
// already-fetched rows — no Supabase, no React, no non-injectable clock reads —
// so the definitions live in one auditable, unit-tested place (the
// booking-math.ts / b2b-analytics.ts convention).
//
// The command center groups cross-module KPIs; the Sales / Renewals /
// Documentation / Attendance / Payroll numbers are counted from thin structural
// row shapes so a query can select only the columns it needs, and the B2B
// rollups are reused straight from src/lib/b2b-analytics.ts.

import type { PeriodId } from "./report-period";

// Re-export so callers can import the period id from a single command-center
// entry point if they prefer, while report-period.ts stays the one source of
// truth for the type definition.
export type { PeriodId } from "./report-period";

/**
 * The filter the whole command center threads through every module. `period`
 * selects a preset window (resolved by resolvePeriod); `from`/`to` carry the
 * YYYY-MM-DD bounds for a `custom` period; `day` is a specific YYYY-MM-DD that
 * drives the day-level Attendance block (when absent the block falls back to
 * today).
 */
export type CommandCenterFilter = {
  period: PeriodId;
  from?: string | null;
  to?: string | null;
  day?: string | null;
};

// ---------------------------------------------------------------------------
// Range predicates — the single, tested place that knows how each column type
// is compared, so the date-column-vs-timestamp distinction lives in one spot.
//
// Date-only values (YYYY-MM-DD) are compared LEXICOGRAPHICALLY: the strings are
// zero-padded and ordered the same as the dates, and this matches the codebase
// convention of building YYYY-MM-DD from LOCAL date parts (never new Date(iso))
// to avoid UTC drift. Timestamptz values are compared as instants.
// ---------------------------------------------------------------------------

/**
 * Inclusive membership test for a `date` column value. `dateStr` is a
 * YYYY-MM-DD string; the bounds are compared lexicographically (which equals
 * chronological order for this format). Returns false for null/empty. A
 * reversed range (fromDate > toDate) simply matches nothing, as documented.
 */
export function inRangeDate(
  dateStr: string | null | undefined,
  fromDate: string,
  toDate: string,
): boolean {
  if (!dateStr) return false;
  return dateStr >= fromDate && dateStr <= toDate;
}

/**
 * Inclusive membership test for a timestamptz column value, compared as an
 * instant. `iso` is parsed with Date; returns false for null/empty or an
 * unparseable value. A reversed range matches nothing.
 */
export function inRangeISO(
  iso: string | null | undefined,
  fromISO: string,
  toISO: string,
): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= new Date(fromISO).getTime() && t <= new Date(toISO).getTime();
}

// ---------------------------------------------------------------------------
// Date-selection helpers used by the filter-aware command-center query. Pure
// and tested so the "which date does this row count under" and "which month
// key does payroll use" decisions live in one auditable place.
// ---------------------------------------------------------------------------

/**
 * The best available date for a referral row. Referrals carry three possible
 * date columns and not every row has all three, so the authoritative range
 * check must fall back in priority order: the business referral_date first,
 * then when it was received, then the row's created_at. Returns null when the
 * row has none, so the caller can decide how to treat an undated referral.
 */
export function bestReferralDate(r: {
  referral_date?: string | null;
  date_received?: string | null;
  created_at?: string | null;
}): string | null {
  return r.referral_date || r.date_received || r.created_at || null;
}

/**
 * The salary-slips month key (YYYY-MM-01) for a given YYYY-MM-DD date. Payroll
 * is a monthly view; a selected period's end date (period.toDate) picks the
 * month to show. Falls back to null when the input is not a parseable
 * YYYY-MM-DD so the caller can default to the current month.
 */
export function monthKeyFromDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(dateStr);
  if (!m) return null;
  return `${m[1]}-${m[2]}-01`;
}

/** A `numeric` column from PostgREST can arrive as number or string. */
type Num = number | string | null | undefined;

const num = (v: Num): number => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
};

/** Integer percentage of `part` out of `whole`, 0 when there is no base. */
export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

// ---------------------------------------------------------------------------
// Sales performance — a lightweight roll-up over the Sales leads + bookings the
// admin dashboard already loads elsewhere. The heavy Sales widgets stay as-is;
// this is only the command-center summary block.
// ---------------------------------------------------------------------------

export type CcLead = {
  stage?: string | null;
  created_at?: string | null;
};

export type CcBooking = {
  amount_after_tds?: Num;
  total_amount?: Num;
  booking_source?: string | null;
};

/** Stages that count as a won / closed sale. */
const CLOSED_STAGES = new Set(["agreement_signed", "completed"]);

export type SalesSummary = {
  totalLeads: number;
  closures: number;
  conversion: number;
  pipelineOpen: number;
  totalBookings: number;
  totalRevenue: number;
};

/**
 * Booking revenue — the single money definition shared with the Sales reports
 * (`bookingRevenue` in report-metrics.ts): net after TDS, falling back to the
 * gross total.
 */
export function bookingRevenueValue(b: CcBooking): number {
  return num(b.amount_after_tds) || num(b.total_amount) || 0;
}

/** Whether a booking was sourced through the B2B channel (CA-partner referral). */
export function isB2BSourcedBooking(b: CcBooking): boolean {
  return String(b.booking_source ?? "")
    .toLowerCase()
    .includes("b2b");
}

export function salesSummary(leads: CcLead[], bookings: CcBooking[]): SalesSummary {
  const totalLeads = leads.length;
  const closures = leads.filter((l) => CLOSED_STAGES.has(l.stage ?? "")).length;
  const pipelineOpen = leads.filter((l) => !!l.stage && !CLOSED_STAGES.has(l.stage)).length;
  const totalRevenue = Math.round(bookings.reduce((s, b) => s + bookingRevenueValue(b), 0));
  return {
    totalLeads,
    closures,
    conversion: pct(closures, totalLeads),
    pipelineOpen,
    totalBookings: bookings.length,
    totalRevenue,
  };
}

// ---------------------------------------------------------------------------
// Renewals — due / pending / completed / dormant counts off the renewal rows.
// ---------------------------------------------------------------------------

export type CcRenewal = {
  status?: string | null;
  stage?: string | null;
  due_date?: string | null;
  last_contacted_at?: string | null;
};

export type RenewalSummary = {
  due: number;
  pending: number;
  completed: number;
  dormant: number;
};

const COMPLETED_RENEWAL = new Set(["completed", "renewed", "closed_won"]);
const PENDING_RENEWAL = new Set(["pending", "in_progress", "contacted", "follow_up"]);

/**
 * Count renewals by state. `due` = due on or before `now`; `completed` /
 * `pending` are read from status; `dormant` = not completed and no contact in
 * the last `dormantDays` (default 90). `now` is injectable for determinism.
 */
export function renewalSummary(
  renewals: CcRenewal[],
  now: number = Date.now(),
  dormantDays = 90,
): RenewalSummary {
  const dormantCutoff = now - dormantDays * 86_400_000;
  let due = 0;
  let pending = 0;
  let completed = 0;
  let dormant = 0;
  for (const r of renewals) {
    const status = (r.status ?? r.stage ?? "").toLowerCase();
    const isDone = COMPLETED_RENEWAL.has(status);
    if (isDone) completed++;
    else if (PENDING_RENEWAL.has(status)) pending++;
    if (!isDone && r.due_date && new Date(r.due_date).getTime() <= now) due++;
    if (!isDone) {
      const last = r.last_contacted_at ? new Date(r.last_contacted_at).getTime() : 0;
      if (!last || last < dormantCutoff) dormant++;
    }
  }
  return { due, pending, completed, dormant };
}

// ---------------------------------------------------------------------------
// Documentation — pending / delayed / completed + TAT breaches.
// ---------------------------------------------------------------------------

export type CcDocTask = {
  stage?: string | null;
  escalated?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type DocSummary = {
  pending: number;
  completed: number;
  delayed: number;
  tatBreaches: number;
};

/**
 * Documentation workload summary. `completed` = stage 'completed'; `pending` =
 * everything else; `delayed` = an escalated open task; `tatBreaches` = open
 * tasks older than `tatDays` (default 7) measured from created_at. `now` is
 * injectable for determinism.
 */
export function docSummary(tasks: CcDocTask[], now: number = Date.now(), tatDays = 7): DocSummary {
  const tatCutoff = now - tatDays * 86_400_000;
  let pending = 0;
  let completed = 0;
  let delayed = 0;
  let tatBreaches = 0;
  for (const t of tasks) {
    const done = t.stage === "completed";
    if (done) {
      completed++;
      continue;
    }
    pending++;
    if (t.escalated) delayed++;
    if (t.created_at && new Date(t.created_at).getTime() < tatCutoff) tatBreaches++;
  }
  return { pending, completed, delayed, tatBreaches };
}

// ---------------------------------------------------------------------------
// Attendance — today's present / absent / late / on-leave / missing-checkout +
// total working hours, counted from the day's attendance rows.
// ---------------------------------------------------------------------------

export type CcAttendanceRow = {
  status?: string | null;
  check_in_at?: string | null;
  check_out_at?: string | null;
  late?: boolean | null;
  work_minutes?: Num;
};

export type AttendanceSummary = {
  present: number;
  absent: number;
  late: number;
  onLeave: number;
  missingCheckout: number;
  workingHours: number;
};

/**
 * Summarize a single day's attendance rows. `present` = checked in and not on
 * leave; `late` = flagged late or checked in late; `onLeave` from status;
 * `missingCheckout` = checked in with no checkout; `workingHours` = total
 * work_minutes / 60 rounded to one decimal.
 */
export function attendanceSummary(rows: CcAttendanceRow[]): AttendanceSummary {
  let present = 0;
  let absent = 0;
  let late = 0;
  let onLeave = 0;
  let missingCheckout = 0;
  let workMinutes = 0;
  for (const r of rows) {
    const status = (r.status ?? "").toLowerCase();
    if (status === "leave" || status === "on_leave") {
      onLeave++;
      continue;
    }
    if (status === "absent") {
      absent++;
      continue;
    }
    if (r.check_in_at) {
      present++;
      if (r.late) late++;
      if (!r.check_out_at) missingCheckout++;
    } else {
      absent++;
    }
    workMinutes += num(r.work_minutes);
  }
  return {
    present,
    absent,
    late,
    onLeave,
    missingCheckout,
    workingHours: Math.round((workMinutes / 60) * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Payroll — pending / processed runs, total cost, LOP days, department-wise.
// ---------------------------------------------------------------------------

export type CcPayrollRow = {
  status?: string | null;
  net_pay?: Num;
  lop_days?: Num;
  department?: string | null;
};

export type PayrollSummary = {
  pending: number;
  processed: number;
  totalCost: number;
  totalLop: number;
  byDepartment: { department: string; count: number; cost: number }[];
};

const PROCESSED_PAYROLL = new Set(["processed", "paid", "finalized", "approved"]);

/**
 * Payroll run summary. `processed` from status; `pending` = everything else;
 * `totalCost` = sum of net_pay; `totalLop` = sum of lop_days; `byDepartment`
 * aggregates count + cost per department, sorted by cost desc.
 */
export function payrollSummary(rows: CcPayrollRow[]): PayrollSummary {
  let pending = 0;
  let processed = 0;
  let totalCost = 0;
  let totalLop = 0;
  const deptMap = new Map<string, { department: string; count: number; cost: number }>();
  for (const r of rows) {
    const status = (r.status ?? "").toLowerCase();
    if (PROCESSED_PAYROLL.has(status)) processed++;
    else pending++;
    const cost = num(r.net_pay);
    totalCost += cost;
    totalLop += num(r.lop_days);
    const dept = (r.department ?? "Unassigned").trim() || "Unassigned";
    let bucket = deptMap.get(dept);
    if (!bucket) {
      bucket = { department: dept, count: 0, cost: 0 };
      deptMap.set(dept, bucket);
    }
    bucket.count++;
    bucket.cost += cost;
  }
  return {
    pending,
    processed,
    totalCost: Math.round(totalCost),
    totalLop: Math.round(totalLop * 10) / 10,
    byDepartment: Array.from(deptMap.values()).sort((a, b) => b.cost - a.cost),
  };
}
