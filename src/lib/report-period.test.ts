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
