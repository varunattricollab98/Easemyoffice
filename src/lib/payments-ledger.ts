// Employee payments / expenses ledger maths — pure, tested, dependency-light.
//
// Mirrors the style of payroll.ts: numeric coercion, deterministic, no DB.
// All amounts are rupees. paid_on is a 'YYYY-MM-DD' date string, so month
// filtering is a timezone-robust string prefix compare on 'YYYY-MM-'.

import type { EmployeePayment, EmployeePaymentType } from "./hrms";

type LedgerRow = Pick<EmployeePayment, "paid_on" | "amount" | "type">;

/** Coerce any stored value (number, numeric string, null) to a safe number. */
const n = (v: unknown): number => Number(v ?? 0) || 0;

/**
 * Rows whose paid_on falls in the given calendar month.
 *
 * monthKey is 'YYYY-MM'. We match on the string prefix `${monthKey}-` so the
 * result is independent of timezone and never parses a Date — '2026-05-01'
 * (first day) and '2026-05-31' (last day) are included, '2026-04-30' and
 * '2026-06-01' (adjacent months) are excluded.
 */
export function paymentsForMonth<T extends LedgerRow>(payments: T[], monthKey: string): T[] {
  const prefix = `${monthKey}-`;
  return payments.filter((p) => typeof p.paid_on === "string" && p.paid_on.startsWith(prefix));
}

/** Sum of the amount column, rounded to whole rupees. Empty list -> 0. */
export function totalPayments(payments: LedgerRow[]): number {
  return Math.round(payments.reduce((t, p) => t + n(p.amount), 0));
}

/**
 * Sum of amounts grouped by payment type. Only types present in the input
 * appear in the result; each total is rounded to whole rupees.
 */
export function paymentsByType(payments: LedgerRow[]): Map<EmployeePaymentType, number> {
  const out = new Map<EmployeePaymentType, number>();
  for (const p of payments) {
    out.set(p.type, Math.round(n(out.get(p.type)) + n(p.amount)));
  }
  return out;
}
