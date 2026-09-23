import { describe, it, expect } from "vitest";
import {
  num,
  round2,
  salesMonth,
  addYearsISO,
  computeBookingMoney,
  GST_RATE,
} from "./booking-math";

describe("num", () => {
  it("parses numeric strings", () => {
    expect(num("100")).toBe(100);
    expect(num("100.55")).toBe(100.55);
    expect(num("0")).toBe(0);
  });

  it("defaults to 0 for empty / invalid / nullish input", () => {
    expect(num("")).toBe(0);
    expect(num("abc")).toBe(0);
    expect(num(null)).toBe(0);
    expect(num(undefined)).toBe(0);
    expect(num(NaN)).toBe(0);
    expect(num(Infinity)).toBe(0);
  });

  it("accepts real numbers directly", () => {
    expect(num(42)).toBe(42);
    expect(num(-5.5)).toBe(-5.5);
  });
});

describe("round2", () => {
  it("rounds to two decimals like +x.toFixed(2)", () => {
    expect(round2(1.005)).toBe(1); // JS float quirk preserved (matches old code)
    expect(round2(1.234)).toBe(1.23);
    expect(round2(1.235)).toBe(1.24);
    expect(round2(1800)).toBe(1800);
  });
});

describe("GST_RATE", () => {
  it("is 18%", () => {
    expect(GST_RATE).toBe(0.18);
  });
});

describe("salesMonth", () => {
  it("formats an ISO date as Mon-YYYY", () => {
    // Use a mid-month date to avoid timezone edge cases at month boundaries.
    expect(salesMonth("2026-09-15")).toBe("Sep-2026");
    expect(salesMonth("2026-01-15")).toBe("Jan-2026");
    expect(salesMonth("2025-12-10")).toBe("Dec-2025");
  });

  it("returns empty string for an invalid date", () => {
    expect(salesMonth("")).toBe("");
    expect(salesMonth("not-a-date")).toBe("");
  });
});

describe("addYearsISO", () => {
  it("adds whole years and returns an ISO date", () => {
    expect(addYearsISO("2026-09-23", 1)).toBe("2027-09-23");
    expect(addYearsISO("2026-09-23", 3)).toBe("2029-09-23");
  });

  it("returns null for empty or invalid input", () => {
    expect(addYearsISO("", 1)).toBeNull();
    expect(addYearsISO("garbage", 2)).toBeNull();
  });
});

describe("computeBookingMoney", () => {
  const base = {
    voAmount: 0,
    addOnAmount: 0,
    quotedAmount: 0,
    tdsPct: 0,
    spPayable: 0,
    addOnPayable: 0,
    isPartial: false,
    amountReceived: 0,
  };

  it("applies 18% GST to VO and add-on and totals GST-inclusive", () => {
    const m = computeBookingMoney({ ...base, voAmount: 10000, addOnAmount: 2000 });
    expect(m.voGst).toBe(1800);
    expect(m.addOnGst).toBe(360);
    // 10000 + 1800 + 2000 + 360
    expect(m.total).toBe(14160);
  });

  it("computes profit on the PRE-GST base, not the GST-inclusive total", () => {
    const m = computeBookingMoney({
      ...base,
      voAmount: 10000,
      addOnAmount: 2000,
      spPayable: 4000,
      addOnPayable: 500,
    });
    // (10000 + 2000) - 4000 - 500 = 7500 (GST is NOT part of profit)
    expect(m.profit).toBe(7500);
  });

  it("allows profit to go negative when payables exceed base", () => {
    const m = computeBookingMoney({
      ...base,
      voAmount: 1000,
      spPayable: 5000,
    });
    expect(m.profit).toBe(-4000);
  });

  it("computes TDS on the GST-inclusive total and afterTds", () => {
    const m = computeBookingMoney({ ...base, voAmount: 10000, tdsPct: 10 });
    // total = 11800; tds = 1180; afterTds = 10620
    expect(m.total).toBe(11800);
    expect(m.tdsAmt).toBe(1180);
    expect(m.afterTds).toBe(10620);
  });

  it("has zero TDS when tdsPct is 0", () => {
    const m = computeBookingMoney({ ...base, voAmount: 10000 });
    expect(m.tdsAmt).toBe(0);
    expect(m.afterTds).toBe(m.total);
  });

  it("computes discount as quoted minus final total when a quote exists", () => {
    const m = computeBookingMoney({ ...base, voAmount: 10000, quotedAmount: 13000 });
    // total = 11800; discount = 13000 - 11800 = 1200
    expect(m.discount).toBe(1200);
  });

  it("clamps discount at 0 when total exceeds the quote", () => {
    const m = computeBookingMoney({ ...base, voAmount: 10000, quotedAmount: 5000 });
    expect(m.discount).toBe(0);
  });

  it("reports zero discount when no quote is given", () => {
    const m = computeBookingMoney({ ...base, voAmount: 10000, quotedAmount: 0 });
    expect(m.discount).toBe(0);
  });

  describe("partial payments", () => {
    it("uses the entered amountReceived and computes the balance", () => {
      const m = computeBookingMoney({
        ...base,
        voAmount: 10000, // total 11800, no TDS -> afterTds 11800
        isPartial: true,
        amountReceived: 5000,
      });
      expect(m.amountReceived).toBe(5000);
      expect(m.balanceAmount).toBe(6800);
    });

    it("clamps the balance at 0 when overpaid", () => {
      const m = computeBookingMoney({
        ...base,
        voAmount: 10000,
        isPartial: true,
        amountReceived: 999999,
      });
      expect(m.balanceAmount).toBe(0);
    });

    it("nets the balance against afterTds, not the pre-TDS total", () => {
      const m = computeBookingMoney({
        ...base,
        voAmount: 10000,
        tdsPct: 10, // afterTds = 10620
        isPartial: true,
        amountReceived: 620,
      });
      expect(m.balanceAmount).toBe(10000);
    });
  });

  describe("non-partial payments", () => {
    it("sets amountReceived to the full afterTds and balance to 0", () => {
      const m = computeBookingMoney({
        ...base,
        voAmount: 10000,
        tdsPct: 10,
        isPartial: false,
        amountReceived: 1, // ignored when not partial
      });
      expect(m.amountReceived).toBe(10620);
      expect(m.balanceAmount).toBe(0);
    });
  });

  it("handles an all-zero booking without NaN", () => {
    const m = computeBookingMoney(base);
    for (const v of Object.values(m)) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(m.total).toBe(0);
    expect(m.profit).toBe(0);
    expect(m.balanceAmount).toBe(0);
  });

  it("rounds GST to two decimals per component", () => {
    const m = computeBookingMoney({ ...base, voAmount: 999.99 });
    // 999.99 * 0.18 = 179.9982 -> 180.00
    expect(m.voGst).toBe(180);
  });

  it("computes a full realistic booking end-to-end", () => {
    const m = computeBookingMoney({
      voAmount: 25000,
      addOnAmount: 5000,
      quotedAmount: 40000,
      tdsPct: 2,
      spPayable: 12000,
      addOnPayable: 1500,
      isPartial: true,
      amountReceived: 20000,
    });
    expect(m.voGst).toBe(4500); // 25000 * 0.18
    expect(m.addOnGst).toBe(900); // 5000 * 0.18
    expect(m.total).toBe(35400); // 25000+4500+5000+900
    expect(m.discount).toBe(4600); // 40000 - 35400
    expect(m.tdsAmt).toBe(708); // 35400 * 2%
    expect(m.afterTds).toBe(34692);
    expect(m.profit).toBe(16500); // (25000+5000) - 12000 - 1500
    expect(m.amountReceived).toBe(20000);
    expect(m.balanceAmount).toBe(14692); // 34692 - 20000
  });
});
