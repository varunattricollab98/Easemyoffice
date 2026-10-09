import { describe, it, expect } from "vitest";
import { resolvePeriod, growthPct } from "./report-period";

// Wednesday 16 Sep 2026, mid-afternoon. Fixed so the assertions below are not
// clock-dependent.
const NOW = new Date("2026-09-16T14:30:00.000Z");

describe("resolvePeriod", () => {
  it("bounds 'today' to the current day", () => {
    const p = resolvePeriod("today", { now: NOW });
    expect(p.fromDate).toBe("2026-09-16");
    expect(p.toDate).toBe("2026-09-16");
  });

  it("starts 'this_week' on Monday, not Sunday", () => {
    const p = resolvePeriod("this_week", { now: NOW });
    // 16 Sep 2026 is a Wednesday, so Monday is the 14th.
    expect(p.fromDate).toBe("2026-09-14");
    expect(p.toDate).toBe("2026-09-16");
  });

  it("starts 'this_month' on the 1st", () => {
    const p = resolvePeriod("this_month", { now: NOW });
    expect(p.fromDate).toBe("2026-09-01");
    expect(p.toDate).toBe("2026-09-16");
  });

  it("compares against a preceding window of the SAME length, not the previous calendar month", () => {
    // 1st-16th is 16 days, so the comparison window must also be 16 days
    // (16 Aug - 31 Aug) rather than the whole of August.
    const p = resolvePeriod("this_month", { now: NOW });
    expect(p.previous.toDate).toBe("2026-08-31");
    expect(p.previous.fromDate).toBe("2026-08-16");
  });

  it("gives 'today' a single-day comparison window", () => {
    const p = resolvePeriod("today", { now: NOW });
    expect(p.previous.fromDate).toBe("2026-09-15");
    expect(p.previous.toDate).toBe("2026-09-15");
  });

  it("buckets by hour for a single day and by day for longer spans", () => {
    expect(resolvePeriod("today", { now: NOW }).bucket).toBe("hour");
    expect(resolvePeriod("this_month", { now: NOW }).bucket).toBe("day");
  });

  it("honours custom bounds", () => {
    const p = resolvePeriod("custom", { from: "2026-03-01", to: "2026-03-10", now: NOW });
    expect(p.fromDate).toBe("2026-03-01");
    expect(p.toDate).toBe("2026-03-10");
  });

  it("swaps a reversed custom range instead of returning an empty window", () => {
    const p = resolvePeriod("custom", { from: "2026-03-10", to: "2026-03-01", now: NOW });
    expect(p.fromDate).toBe("2026-03-01");
    expect(p.toDate).toBe("2026-03-10");
  });

  it("falls back to the current month when custom bounds are missing", () => {
    const p = resolvePeriod("custom", { now: NOW });
    expect(p.fromDate).toBe("2026-09-01");
  });

  // New presets. Fixed to Friday 15 May 2026 so the quarter/year/all boundaries
  // are not clock-dependent.
  const MID_MAY = new Date("2026-05-15T10:00:00.000Z");

  it("starts 'this_quarter' on the first day of the calendar quarter", () => {
    const p = resolvePeriod("this_quarter", { now: MID_MAY });
    // May is in Q2 (Apr-Jun), so the quarter starts on 1 Apr.
    expect(p.fromDate).toBe("2026-04-01");
    expect(p.toDate).toBe("2026-05-15");
    expect(p.bucket).toBe("day");
  });

  it("starts 'this_year' on 1 January", () => {
    const p = resolvePeriod("this_year", { now: MID_MAY });
    expect(p.fromDate).toBe("2026-01-01");
    expect(p.toDate).toBe("2026-05-15");
    expect(p.bucket).toBe("day");
  });

  it("spans everything for 'all' from the epoch up to today", () => {
    const p = resolvePeriod("all", { now: MID_MAY });
    expect(p.fromDate).toBe("1970-01-01");
    expect(p.toDate).toBe("2026-05-15");
    expect(p.fromISO).toBe(new Date(0).toISOString());
    expect(p.bucket).toBe("day");
    // NOTE: 'all' deliberately keeps toDate capped at end-of-today here so the
    // shared sales-reports / b2b-analytics captions that render period.toDate
    // stay sensible. The command center makes 'all' a TRULY unbounded window by
    // skipping the ranged .gte/.lte bounds in command-center-queries.ts
    // (withWindow(..., isAll)) rather than widening this shared sentinel, so a
    // future-dated bookings.booking_date row is counted exactly as the
    // pre-change unbounded dashboard counted it.
  });
});

describe("growthPct", () => {
  it("computes percentage change", () => {
    expect(growthPct(150, 100)).toBe(50);
    expect(growthPct(50, 100)).toBe(-50);
    expect(growthPct(100, 100)).toBe(0);
  });

  it("returns null when there is no baseline and nothing happened", () => {
    // Distinguishes "flat at zero" from "grew from zero", so the UI can show a
    // dash rather than a meaningless +100%.
    expect(growthPct(0, 0)).toBeNull();
  });

  it("treats growth from a zero baseline as +100%", () => {
    expect(growthPct(5, 0)).toBe(100);
  });
});
