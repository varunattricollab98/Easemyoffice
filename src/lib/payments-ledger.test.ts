import { describe, expect, it } from "vitest";
import type { EmployeePayment } from "./hrms";
import { paymentsByType, paymentsForMonth, totalPayments } from "./payments-ledger";

type Row = Pick<EmployeePayment, "paid_on" | "amount" | "type">;

const ROWS: Row[] = [
  { paid_on: "2026-05-01", amount: 1000, type: "incentive" }, // first day of month
  { paid_on: "2026-05-15", amount: 2500, type: "bonus" },
  { paid_on: "2026-05-31", amount: 500, type: "other" }, // last day of month
  { paid_on: "2026-04-30", amount: 9999, type: "incentive" }, // adjacent month (before)
  { paid_on: "2026-06-01", amount: 7777, type: "advance" }, // adjacent month (after)
];

describe("payments-ledger", () => {
  it("keeps only rows in the given month, including boundary dates", () => {
    const may = paymentsForMonth(ROWS, "2026-05");
    expect(may.map((r) => r.paid_on)).toEqual(["2026-05-01", "2026-05-15", "2026-05-31"]);
  });

  it("excludes adjacent months entirely", () => {
    expect(paymentsForMonth(ROWS, "2026-04").map((r) => r.paid_on)).toEqual(["2026-04-30"]);
    expect(paymentsForMonth(ROWS, "2026-06").map((r) => r.paid_on)).toEqual(["2026-06-01"]);
  });

  it("returns an empty list for a month with no rows", () => {
    expect(paymentsForMonth(ROWS, "2026-07")).toEqual([]);
  });

  it("sums mixed types to an exact rupee figure", () => {
    expect(totalPayments(paymentsForMonth(ROWS, "2026-05"))).toBe(4000);
  });

  it("sums all rows and coerces numeric strings", () => {
    const mixed: Row[] = [
      { paid_on: "2026-05-01", amount: "1200.50", type: "incentive" },
      { paid_on: "2026-05-02", amount: 300, type: "other" },
      { paid_on: "2026-05-03", amount: null as unknown as number, type: "bonus" },
    ];
    expect(totalPayments(mixed)).toBe(1501); // 1200.5 + 300 + 0, rounded
  });

  it("returns 0 for an empty list", () => {
    expect(totalPayments([])).toBe(0);
  });

  it("groups amounts by type", () => {
    const grouped = paymentsByType([
      { paid_on: "2026-05-01", amount: 1000, type: "incentive" },
      { paid_on: "2026-05-02", amount: 250, type: "incentive" },
      { paid_on: "2026-05-03", amount: 2500, type: "bonus" },
      { paid_on: "2026-05-04", amount: 500, type: "other" },
    ]);
    expect(grouped.get("incentive")).toBe(1250);
    expect(grouped.get("bonus")).toBe(2500);
    expect(grouped.get("other")).toBe(500);
    expect(grouped.has("advance")).toBe(false);
  });

  it("groups an empty list to an empty map", () => {
    expect(paymentsByType([]).size).toBe(0);
  });
});
