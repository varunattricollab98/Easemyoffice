import { describe, it, expect } from "vitest";
import {
  pct,
  bookingRevenueValue,
  isB2BSourcedBooking,
  salesSummary,
  renewalSummary,
  docSummary,
  attendanceSummary,
  payrollSummary,
  inRangeDate,
  inRangeISO,
} from "./command-center";

describe("pct", () => {
  it("returns an integer percentage", () => {
    expect(pct(1, 4)).toBe(25);
    expect(pct(1, 3)).toBe(33);
  });
  it("returns 0 when there is no base", () => {
    expect(pct(5, 0)).toBe(0);
  });
});

describe("bookingRevenueValue", () => {
  it("prefers amount_after_tds, falls back to total_amount", () => {
    expect(bookingRevenueValue({ amount_after_tds: 900, total_amount: 1000 })).toBe(900);
    expect(bookingRevenueValue({ amount_after_tds: 0, total_amount: 1000 })).toBe(1000);
    expect(bookingRevenueValue({ amount_after_tds: null, total_amount: null })).toBe(0);
  });
  it("accepts numeric strings from PostgREST", () => {
    expect(bookingRevenueValue({ amount_after_tds: "750" })).toBe(750);
  });
});

describe("isB2BSourcedBooking", () => {
  it("matches a b2b source case-insensitively", () => {
    expect(isB2BSourcedBooking({ booking_source: "B2B Referral" })).toBe(true);
    expect(isB2BSourcedBooking({ booking_source: "b2b" })).toBe(true);
  });
  it("rejects non-b2b sources", () => {
    expect(isB2BSourcedBooking({ booking_source: "Website" })).toBe(false);
    expect(isB2BSourcedBooking({ booking_source: null })).toBe(false);
  });
});

describe("salesSummary", () => {
  it("counts closures, open pipeline, conversion and revenue", () => {
    const leads = [
      { stage: "new" },
      { stage: "contacted" },
      { stage: "agreement_signed" },
      { stage: "completed" },
    ];
    const bookings = [{ amount_after_tds: 1000 }, { amount_after_tds: 0, total_amount: 500 }];
    const s = salesSummary(leads, bookings);
    expect(s.totalLeads).toBe(4);
    expect(s.closures).toBe(2);
    expect(s.pipelineOpen).toBe(2);
    expect(s.conversion).toBe(50);
    expect(s.totalBookings).toBe(2);
    expect(s.totalRevenue).toBe(1500);
  });
  it("handles no leads without dividing by zero", () => {
    expect(salesSummary([], []).conversion).toBe(0);
  });
});

describe("renewalSummary", () => {
  const now = Date.UTC(2026, 0, 15); // 2026-01-15
  it("buckets due, pending, completed and dormant", () => {
    const rows = [
      { status: "completed" },
      { status: "pending", due_date: "2026-01-10", last_contacted_at: "2026-01-14" },
      { status: "pending", due_date: "2026-02-01", last_contacted_at: "2025-09-01" },
      { status: "in_progress", due_date: "2026-01-15" },
    ];
    const s = renewalSummary(rows, now);
    expect(s.completed).toBe(1);
    expect(s.pending).toBe(3);
    // due: row2 (<=now) and row4 (==now); row3 is in the future
    expect(s.due).toBe(2);
    // dormant: row3 (last contact >90d ago) and row4 (no contact)
    expect(s.dormant).toBe(2);
  });
});

describe("docSummary", () => {
  const now = Date.UTC(2026, 0, 15);
  it("counts pending, completed, delayed and TAT breaches", () => {
    const tasks = [
      { stage: "completed", created_at: "2026-01-01" },
      { stage: "docs_requested", escalated: true, created_at: "2026-01-01" }, // old + escalated
      { stage: "draft_shared", escalated: false, created_at: "2026-01-14" }, // fresh
    ];
    const s = docSummary(tasks, now, 7);
    expect(s.completed).toBe(1);
    expect(s.pending).toBe(2);
    expect(s.delayed).toBe(1);
    expect(s.tatBreaches).toBe(1); // only the 2026-01-01 open task is >7d old
  });
});

describe("attendanceSummary", () => {
  it("summarizes present, absent, late, leave, missing-checkout and hours", () => {
    const rows = [
      { check_in_at: "t", check_out_at: "t2", work_minutes: 480 },
      { check_in_at: "t", late: true, work_minutes: 60 }, // present + late + missing checkout
      { status: "absent" },
      { status: "leave" },
    ];
    const s = attendanceSummary(rows);
    expect(s.present).toBe(2);
    expect(s.absent).toBe(1);
    expect(s.late).toBe(1);
    expect(s.onLeave).toBe(1);
    expect(s.missingCheckout).toBe(1);
    expect(s.workingHours).toBe(9); // (480+60)/60
  });
  it("treats a row with no check-in and no status as absent", () => {
    expect(attendanceSummary([{}]).absent).toBe(1);
  });
});

describe("payrollSummary", () => {
  it("counts pending/processed, totals cost + LOP and rolls up by department", () => {
    const rows = [
      { status: "processed", net_pay: 50000, lop_days: 0, department: "Sales" },
      { status: "paid", net_pay: 40000, lop_days: 1.5, department: "Sales" },
      { status: "pending", net_pay: 30000, lop_days: 0, department: "B2B" },
    ];
    const s = payrollSummary(rows);
    expect(s.processed).toBe(2);
    expect(s.pending).toBe(1);
    expect(s.totalCost).toBe(120000);
    expect(s.totalLop).toBe(1.5);
    expect(s.byDepartment[0]).toEqual({ department: "Sales", count: 2, cost: 90000 });
    expect(s.byDepartment).toHaveLength(2);
  });
  it("defaults a missing department to Unassigned", () => {
    const s = payrollSummary([{ status: "pending", net_pay: 100 }]);
    expect(s.byDepartment[0].department).toBe("Unassigned");
  });
});

describe("inRangeDate", () => {
  const from = "2026-04-01";
  const to = "2026-06-30";
  it("includes a date inside the range", () => {
    expect(inRangeDate("2026-05-15", from, to)).toBe(true);
  });
  it("excludes dates on either side of the range", () => {
    expect(inRangeDate("2026-03-31", from, to)).toBe(false);
    expect(inRangeDate("2026-07-01", from, to)).toBe(false);
  });
  it("is inclusive of both boundaries", () => {
    expect(inRangeDate("2026-04-01", from, to)).toBe(true);
    expect(inRangeDate("2026-06-30", from, to)).toBe(true);
  });
  it("returns false for null/empty values", () => {
    expect(inRangeDate(null, from, to)).toBe(false);
    expect(inRangeDate(undefined, from, to)).toBe(false);
    expect(inRangeDate("", from, to)).toBe(false);
  });
  it("matches nothing for a reversed/degenerate range", () => {
    // from > to: lexicographic compare can never satisfy both bounds.
    expect(inRangeDate("2026-05-15", "2026-06-30", "2026-04-01")).toBe(false);
  });
});

describe("inRangeISO", () => {
  const from = "2026-04-01T00:00:00.000Z";
  const to = "2026-04-01T23:59:59.999Z";
  it("includes an instant inside the range", () => {
    expect(inRangeISO("2026-04-01T12:00:00.000Z", from, to)).toBe(true);
  });
  it("excludes instants on either side of the range", () => {
    expect(inRangeISO("2026-03-31T23:59:59.999Z", from, to)).toBe(false);
    expect(inRangeISO("2026-04-02T00:00:00.000Z", from, to)).toBe(false);
  });
  it("is inclusive of both boundaries", () => {
    expect(inRangeISO(from, from, to)).toBe(true);
    expect(inRangeISO(to, from, to)).toBe(true);
  });
  it("returns false for null/empty or unparseable values", () => {
    expect(inRangeISO(null, from, to)).toBe(false);
    expect(inRangeISO(undefined, from, to)).toBe(false);
    expect(inRangeISO("", from, to)).toBe(false);
    expect(inRangeISO("not-a-date", from, to)).toBe(false);
  });
  it("matches nothing for a reversed range", () => {
    expect(inRangeISO("2026-04-01T12:00:00.000Z", to, from)).toBe(false);
  });
});
