import { describe, expect, it } from "vitest";
import { amountInWords, computeSlip, fixedGross, lopDays, type SalaryStructure } from "./payroll";

const S: SalaryStructure = {
  basic: 15000,
  hra: 7500,
  conveyance: 1600,
  medical: 1250,
  special_allowance: 4650,
  other_allowance: 0,
  pf_enabled: true,
  esi_enabled: true,
  professional_tax: 0,
  tds: 0,
};

describe("payroll", () => {
  it("adds up the fixed gross", () => {
    expect(fixedGross(S)).toBe(30000);
  });

  it("counts LOP from absent, half days and unpaid leave", () => {
    expect(lopDays({ absent: 2, halfDays: 3, unpaidLeave: 0.5 })).toBe(4);
  });

  it("pays the full month with no LOP", () => {
    const slip = computeSlip({ structure: S, daysInMonth: 31, lopDays: 0 });
    expect(slip.paidDays).toBe(31);
    expect(slip.grossEarnings).toBe(30000);
    expect(slip.deductions.find((d) => d.key === "pf")?.amount).toBe(1800);
    // Fixed gross 30k is above the ESI limit, so no ESI.
    expect(slip.deductions.find((d) => d.key === "esi")?.amount).toBe(0);
    expect(slip.netPay).toBe(28200);
  });

  it("prorates every fixed component by paid days", () => {
    const slip = computeSlip({ structure: S, daysInMonth: 30, lopDays: 3 });
    expect(slip.paidDays).toBe(27);
    expect(slip.earnings.find((e) => e.key === "basic")?.amount).toBe(13500);
    expect(slip.grossEarnings).toBe(27000);
    expect(slip.deductions.find((d) => d.key === "pf")?.amount).toBe(1620);
  });

  it("caps PF at the wage ceiling", () => {
    const slip = computeSlip({ structure: { ...S, basic: 40000 }, daysInMonth: 30, lopDays: 0 });
    expect(slip.deductions.find((d) => d.key === "pf")?.amount).toBe(1800);
  });

  it("applies ESI on earned gross when fixed gross is within the limit", () => {
    const small = {
      ...S,
      basic: 10000,
      hra: 5000,
      special_allowance: 3000,
      conveyance: 0,
      medical: 0,
    };
    const slip = computeSlip({ structure: small, daysInMonth: 30, lopDays: 0 });
    expect(slip.deductions.find((d) => d.key === "esi")?.amount).toBe(135); // 0.75% of 18000
  });

  it("adds monthly adjustments and a TDS override", () => {
    const slip = computeSlip({
      structure: { ...S, tds: 500 },
      daysInMonth: 30,
      lopDays: 0,
      adjustments: {
        incentive: 5000,
        bonus: 1000,
        other_earnings: 0,
        advance_recovery: 2000,
        other_deductions: 0,
        tds_override: 800,
      },
    });
    expect(slip.grossEarnings).toBe(36000);
    expect(slip.totalDeductions).toBe(1800 + 800 + 2000);
    expect(slip.netPay).toBe(36000 - 4600);
  });

  it("never pays negative days", () => {
    expect(computeSlip({ structure: S, daysInMonth: 30, lopDays: 45 }).paidDays).toBe(0);
  });

  it("writes amounts in the Indian system", () => {
    expect(amountInWords(125430)).toBe(
      "Rupees One Lakh Twenty Five Thousand Four Hundred Thirty Only",
    );
    expect(amountInWords(28200)).toBe("Rupees Twenty Eight Thousand Two Hundred Only");
    expect(amountInWords(0)).toBe("Rupees Zero Only");
  });
});
