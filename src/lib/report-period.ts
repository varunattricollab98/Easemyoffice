// Period resolution for the Sales Reports panel.
//
// Every report metric is "this thing, within this window", and two different
// column types have to be filtered: timestamptz columns (leads.created_at,
// lead_activities.created_at, follow_ups.completed_at) and the plain `date`
// column bookings.booking_date. Mixing the two is the classic source of
// month-boundary bugs, so a resolved period carries BOTH representations and
// callers pick the one matching the column they filter.
//
// Pure and dependency-light on purpose: the aggregation math in report-metrics.ts
// is unit-tested, and it can only be tested if the window it works on is
// deterministic.

import { startOfDay, startOfWeek, startOfMonth, endOfDay, subDays, format } from "date-fns";

export type PeriodId = "today" | "this_week" | "this_month" | "custom";

export const PERIOD_OPTIONS: { id: PeriodId; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "this_week", label: "This week" },
  { id: "this_month", label: "This month" },
  { id: "custom", label: "Custom range" },
];

export type ResolvedPeriod = {
  id: PeriodId;
  label: string;
  /** Inclusive start / end as instants — for timestamptz columns. */
  fromISO: string;
  toISO: string;
  /** Inclusive start / end as YYYY-MM-DD — for `date` columns (booking_date). */
  fromDate: string;
  toDate: string;
  /**
   * The immediately preceding window of the SAME length, used for growth
   * deltas. "Same length" rather than "previous calendar month" so that a
   * part-way-through month is compared against an equally long stretch instead
   * of a full one, which would otherwise always show a fake decline.
   */
  previous: { fromISO: string; toISO: string; fromDate: string; toDate: string };
  /** Bucket granularity for the trend chart. */
  bucket: "hour" | "day";
};

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * Resolves a period id (plus optional custom bounds) into concrete windows.
 * `now` is injectable so tests are not clock-dependent.
 */
export function resolvePeriod(
  id: PeriodId,
  opts: { from?: string | null; to?: string | null; now?: Date } = {},
): ResolvedPeriod {
  const now = opts.now ?? new Date();
  let start: Date;
  let end: Date = endOfDay(now);
  let label: string;

  switch (id) {
    case "today":
      start = startOfDay(now);
      label = "Today";
      break;
    case "this_week":
      // Monday-first: the Indian business week, and date-fns defaults to Sunday.
      start = startOfWeek(now, { weekStartsOn: 1 });
      label = "This week";
      break;
    case "custom": {
      // Fall back to the current month when a custom range is selected but not
      // yet filled in, so the page always has a valid window to query.
      const lo = opts.from ? startOfDay(new Date(opts.from)) : startOfMonth(now);
      const hi = opts.to ? endOfDay(new Date(opts.to)) : endOfDay(now);
      // Tolerate a reversed pick rather than returning an empty report.
      const [a, b] = lo > hi ? [hi, lo] : [lo, hi];
      start = a;
      end = b;
      label = `${ymd(a)} → ${ymd(b)}`;
      break;
    }
    case "this_month":
    default:
      start = startOfMonth(now);
      label = "This month";
      break;
  }

  // Length in whole days, used to step back for the comparison window.
  const spanDays = Math.max(
    1,
    Math.round((endOfDay(end).getTime() - startOfDay(start).getTime()) / 86_400_000),
  );
  const prevEnd = endOfDay(subDays(startOfDay(start), 1));
  const prevStart = startOfDay(subDays(startOfDay(start), spanDays));

  return {
    id,
    label,
    fromISO: start.toISOString(),
    toISO: end.toISOString(),
    fromDate: ymd(start),
    toDate: ymd(end),
    previous: {
      fromISO: prevStart.toISOString(),
      toISO: prevEnd.toISOString(),
      fromDate: ymd(prevStart),
      toDate: ymd(prevEnd),
    },
    // A single day reads better hour-by-hour; anything longer by day.
    bucket: spanDays <= 1 ? "hour" : "day",
  };
}

/** Percentage change from `prev` to `curr`, or null when there is no baseline. */
export function growthPct(curr: number, prev: number): number | null {
  if (prev === 0) return curr > 0 ? 100 : null;
  return Math.round(((curr - prev) / prev) * 100);
}
