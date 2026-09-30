// Salary slip maths — pure, tested, no imports.
//
// Pay basis: calendar days. Week-offs and holidays are paid; loss-of-pay (LOP)
// days are subtracted, and every earning is prorated by paid days / days in
// the month (the common Indian payroll convention).
//
// LOP days come from attendance:
//   absent (incl. rejected WFH)  1
//   half day                     0.5
//   unpaid leave                 as taken (0.5 or 1)
// "Left early" is NOT LOP — it is shown on the slip for the admin to judge.

export type SalaryStructure = {
  /** Monthly amounts at full attendance, in rupees. */
  basic: number;
  hra: number;
  conveyance: number;
  medical: number;
  special_allowance: number;
  other_allowance: number;
  /** Employee PF at 12% of earned basic, capped at the statutory wage ceiling. */
  pf_enabled: boolean;
  /** Employee ESI at 0.75% of earned gross, when fixed gross is within the limit. */
  esi_enabled: boolean;
  professional_tax: number;
  tds: number;
};

export type SlipAdjustments = {
  incentive: number;
  bonus: number;
  other_earnings: number;
  advance_recovery: number;
  other_deductions: number;
  /** Replaces the structure's monthly TDS for this slip when set. */
  tds_override: number | null;
};

export const NO_ADJUSTMENTS: SlipAdjustments = {
  incentive: 0,
  bonus: 0,
  other_earnings: 0,
  advance_recovery: 0,
  other_deductions: 0,
  tds_override: null,
};

/** Statutory limits (Sep 2026). */
export const PF_RATE = 0.12;
export const PF_WAGE_CEILING = 15000;
export const ESI_RATE = 0.0075;
export const ESI_GROSS_LIMIT = 21000;

export type SlipLine = { key: string; label: string; full: number; amount: number };

export type SalarySlip = {
  daysInMonth: number;
  lopDays: number;
  paidDays: number;
  earnings: SlipLine[];
  deductions: SlipLine[];
  fixedGross: number;
  grossEarnings: number;
  totalDeductions: number;
  netPay: number;
};

const rupees = (n: number) => Math.round(Number(n) || 0);
const clamp0 = (n: number) => Math.max(0, Number(n) || 0);

export const fixedGross = (s: SalaryStructure) =>
  rupees(
    clamp0(s.basic) +
      clamp0(s.hra) +
      clamp0(s.conveyance) +
      clamp0(s.medical) +
      clamp0(s.special_allowance) +
      clamp0(s.other_allowance),
  );

export function lopDays(input: { absent: number; halfDays: number; unpaidLeave: number }): number {
  return clamp0(input.absent) + clamp0(input.halfDays) * 0.5 + clamp0(input.unpaidLeave);
}

export function computeSlip(input: {
  structure: SalaryStructure;
  daysInMonth: number;
  lopDays: number;
  adjustments?: SlipAdjustments;
}): SalarySlip {
  const s = input.structure;
  const a = input.adjustments ?? NO_ADJUSTMENTS;
  const days = Math.max(1, input.daysInMonth);
  const lop = Math.min(days, clamp0(input.lopDays));
  const paid = days - lop;
  const ratio = paid / days;
  const prorate = (n: number) => rupees(clamp0(n) * ratio);

  const earnings: SlipLine[] = [
    { key: "basic", label: "Basic", full: rupees(s.basic), amount: prorate(s.basic) },
    { key: "hra", label: "House Rent Allowance", full: rupees(s.hra), amount: prorate(s.hra) },
    {
      key: "conveyance",
      label: "Conveyance",
      full: rupees(s.conveyance),
      amount: prorate(s.conveyance),
    },
    { key: "medical", label: "Medical", full: rupees(s.medical), amount: prorate(s.medical) },
    {
      key: "special_allowance",
      label: "Special Allowance",
      full: rupees(s.special_allowance),
      amount: prorate(s.special_allowance),
    },
    {
      key: "other_allowance",
      label: "Other Allowance",
      full: rupees(s.other_allowance),
      amount: prorate(s.other_allowance),
    },
    { key: "incentive", label: "Incentive", full: 0, amount: rupees(clamp0(a.incentive)) },
    { key: "bonus", label: "Bonus", full: 0, amount: rupees(clamp0(a.bonus)) },
    {
      key: "other_earnings",
      label: "Other Earnings",
      full: 0,
      amount: rupees(clamp0(a.other_earnings)),
    },
  ];
  const earnedBasic = earnings[0].amount;
  const fixed = fixedGross(s);
  const grossEarnings = earnings.reduce((t, l) => t + l.amount, 0);

  const pf = s.pf_enabled ? rupees(Math.min(earnedBasic, PF_WAGE_CEILING) * PF_RATE) : 0;
  // ESI eligibility is decided on the fixed monthly gross; the contribution
  // is on what was actually earned this month.
  const esi = s.esi_enabled && fixed <= ESI_GROSS_LIMIT ? Math.ceil(grossEarnings * ESI_RATE) : 0;
  const tds = rupees(clamp0(a.tds_override ?? s.tds));

  const deductions: SlipLine[] = [
    { key: "pf", label: "Provident Fund (Employee)", full: 0, amount: pf },
    { key: "esi", label: "ESI (Employee)", full: 0, amount: esi },
    {
      key: "professional_tax",
      label: "Professional Tax",
      full: 0,
      amount: rupees(clamp0(s.professional_tax)),
    },
    { key: "tds", label: "Income Tax (TDS)", full: 0, amount: tds },
    {
      key: "advance_recovery",
      label: "Advance Recovery",
      full: 0,
      amount: rupees(clamp0(a.advance_recovery)),
    },
    {
      key: "other_deductions",
      label: "Other Deductions",
      full: 0,
      amount: rupees(clamp0(a.other_deductions)),
    },
  ];
  const totalDeductions = deductions.reduce((t, l) => t + l.amount, 0);

  return {
    daysInMonth: days,
    lopDays: lop,
    paidDays: paid,
    earnings,
    deductions,
    fixedGross: fixed,
    grossEarnings,
    totalDeductions,
    netPay: grossEarnings - totalDeductions,
  };
}

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  return [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join(" ");
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

/** 125430 -> "Rupees One Lakh Twenty Five Thousand Four Hundred Thirty Only" (Indian system). */
export function amountInWords(amount: number): string {
  let n = Math.max(0, Math.round(amount));
  if (n === 0) return "Rupees Zero Only";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return `Rupees ${parts.join(" ")} Only`;
}
