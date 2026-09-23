// Pure, framework-free booking money math.
//
// Extracted from new-booking-dialog.tsx's `deriveBooking` so the arithmetic
// that drives every invoice (GST 18%, TDS, profit on the pre-GST base, discount
// vs quoted price, partial-payment balance) can be unit-tested in isolation and
// reused by the single-save path, the batch path, and the renewals booking form
// without copy-pasting the formulas. This module deliberately has ZERO React /
// Supabase / DOM dependencies.
//
// IMPORTANT: the numbers here must stay byte-for-byte identical to what the UI
// previously computed. Every rounding step (`+(x).toFixed(2)`) is preserved.

/** The fixed GST rate applied to VO and add-on amounts (18%). */
export const GST_RATE = 0.18;

/**
 * Parse a user-entered numeric string into a finite number, defaulting to 0.
 * Mirrors the `num` helper that was duplicated across the booking forms.
 */
export function num(v: string | number | null | undefined): number {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

/** Round to 2 decimals the same way the UI did: `+(x).toFixed(2)`. */
export function round2(n: number): number {
  return +n.toFixed(2);
}

/**
 * Format a date string as the "Mon-YYYY" sales month label (e.g. "Sep-2026").
 * Returns "" for an unparseable date. Mirrors the old `salesMonth` helper.
 */
export function salesMonth(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return d
    .toLocaleDateString(undefined, { month: "short", year: "numeric" })
    .replace(" ", "-");
}

/**
 * Add N whole years to an ISO date (YYYY-MM-DD) and return an ISO date.
 * Used to auto-compute a multi-year plan's expiry from its start date.
 * Returns null on empty or invalid input. Mirrors the old `addYearsISO`.
 */
export function addYearsISO(startISO: string, years: number): string | null {
  if (!startISO) return null;
  const d = new Date(startISO);
  if (isNaN(d.getTime())) return null;
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/** Raw numeric inputs to the booking money calculation. */
export interface BookingMoneyInput {
  /** Virtual-office base amount (pre-GST). */
  voAmount: number;
  /** Add-on services base amount (pre-GST). */
  addOnAmount: number;
  /** Originally quoted price; 0 or negative means "no quote / no discount". */
  quotedAmount: number;
  /** TDS percentage applied to the GST-inclusive total. */
  tdsPct: number;
  /** Amount payable to the service provider (subtracted from profit). */
  spPayable: number;
  /** Add-on amount payable out (subtracted from profit). */
  addOnPayable: number;
  /** Whether this is a partial (installment) payment. */
  isPartial: boolean;
  /** Amount received now; only used when isPartial is true. */
  amountReceived: number;
}

/** Fully-derived money figures for a booking. */
export interface BookingMoney {
  vo: number;
  voGst: number;
  addOn: number;
  addOnGst: number;
  /** GST-inclusive grand total. */
  total: number;
  quoted: number;
  /** Quoted minus final total, clamped at 0. */
  discount: number;
  tdsPct: number;
  tdsAmt: number;
  /** Total after TDS is deducted. */
  afterTds: number;
  spPay: number;
  addOnPay: number;
  /** Profit on the PRE-GST base: (vo + addOn) - spPay - addOnPay. */
  profit: number;
  /** Amount received: entered value if partial, else the full afterTds. */
  amountReceived: number;
  /** Outstanding balance, clamped at 0 (0 when not partial). */
  balanceAmount: number;
}

/**
 * Compute all booking money figures from raw numbers.
 *
 * The math intentionally matches the original inline calculation exactly:
 *  - GST is 18% of the VO and add-on base amounts, rounded to 2dp each.
 *  - total = vo + voGst + addOn + addOnGst (GST-inclusive).
 *  - discount = max(0, quoted - total) when a quote exists, else 0.
 *  - tdsAmt = total * tdsPct / 100; afterTds = total - tdsAmt.
 *  - profit uses the PRE-GST base amounts, not the GST-inclusive total.
 *  - partial: amountReceived is the entered value and balance = afterTds -
 *    amountReceived (clamped at 0); non-partial: received = afterTds, balance 0.
 */
export function computeBookingMoney(input: BookingMoneyInput): BookingMoney {
  const vo = input.voAmount;
  const voGst = round2(vo * GST_RATE);
  const addOn = input.addOnAmount;
  const addOnGst = round2(addOn * GST_RATE);
  const total = round2(vo + voGst + addOn + addOnGst);

  const quoted = input.quotedAmount;
  const discount = quoted > 0 ? Math.max(0, round2(quoted - total)) : 0;

  const tdsPct = input.tdsPct;
  const tdsAmt = round2((total * tdsPct) / 100);
  const afterTds = round2(total - tdsAmt);

  const spPay = input.spPayable;
  const addOnPay = input.addOnPayable;
  // Profit is computed on the pre-GST base amounts (VO + Add-on), not the
  // GST-inclusive total.
  const profit = round2(vo + addOn - spPay - addOnPay);

  const amountReceived = input.isPartial ? input.amountReceived : afterTds;
  const balanceAmount = input.isPartial
    ? Math.max(0, round2(afterTds - amountReceived))
    : 0;

  return {
    vo,
    voGst,
    addOn,
    addOnGst,
    total,
    quoted,
    discount,
    tdsPct,
    tdsAmt,
    afterTds,
    spPay,
    addOnPay,
    profit,
    amountReceived,
    balanceAmount,
  };
}
