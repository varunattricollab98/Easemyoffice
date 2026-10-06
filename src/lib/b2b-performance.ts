// Partner performance aggregation — pure, tested, no DB / React imports.
//
// Turns the raw referral / booking / activity history for one or many CA firms
// into the per-firm rows the Partner Performance and Active Partners pages
// render: total/converted referrals, bookings, revenue, the last-referral /
// last-booking / last-contact timestamps, and (via b2b-scoring.ts) the computed
// partner score + health category. Kept framework-free, exactly like
// booking-math.ts / report-metrics.ts, so the roll-up maths is unit-testable in
// isolation and the queries layer only has to move data.

import {
  partnerHealthCategory,
  partnerScore,
  type PartnerHealthId,
  type PartnerStats,
} from "@/lib/b2b-scoring";

/** A `numeric` column from PostgREST can arrive as number or string. */
type Num = number | string | null | undefined;

const n = (v: Num): number => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
};

/** The minimal firm shape the roll-up needs. */
export type PerfFirm = {
  id: string;
  firm_name: string;
  partner_status: string | null;
  assigned_to: string | null;
  city?: string | null;
  state?: string | null;
};

/** A referral contributing to a firm's totals. */
export type PerfReferral = {
  firm_id: string | null;
  converted: boolean;
  booking_id: string | null;
  revenue: Num;
  /** When the referral was received / created (ISO or date string). */
  date_received?: string | null;
  referral_date?: string | null;
  created_at?: string | null;
};

/** An activity contributing to a firm's "last contact". */
export type PerfActivity = {
  firm_id: string | null;
  happened_at: string | null;
};

/** A booking contributing to a firm's "last booking" (via a converted referral). */
export type PerfBooking = {
  id: string;
  booking_date?: string | null;
  created_at?: string | null;
};

/** One fully-rolled-up row for the Partner Performance table. */
export type PartnerPerformanceRow = {
  firmId: string;
  firmName: string;
  partnerStatus: string | null;
  assignedTo: string | null;
  city: string | null;
  state: string | null;
  totalReferrals: number;
  convertedReferrals: number;
  bookings: number;
  revenue: number;
  /** ISO timestamp of the most recent referral, or null. */
  lastReferral: string | null;
  /** ISO timestamp of the most recent linked booking, or null. */
  lastBooking: string | null;
  /** ISO timestamp of the most recent activity, or null. */
  lastContact: string | null;
  /** Days since the firm was last active (referral or contact), or null. */
  daysSinceLastActivity: number | null;
  score: number;
  health: PartnerHealthId;
};

/** The best (latest) referral date available on a referral row. */
function referralDate(r: PerfReferral): string | null {
  return r.date_received ?? r.referral_date ?? r.created_at ?? null;
}

/** The best (latest) booking date available on a booking row. */
function bookingDate(b: PerfBooking): string | null {
  return b.booking_date ?? b.created_at ?? null;
}

/** Max of two nullable ISO/date strings (lexicographic works for ISO dates). */
function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

/** Whole days between an ISO/date string and `now`, or null for no date. */
export function daysSince(iso: string | null, now: number = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

/**
 * Roll up the raw history into one performance row per firm. `bookingDates`
 * maps a booking id to its date so a converted referral can contribute to the
 * firm's "last booking" without a second lookup. Pure: pass `now` for
 * deterministic tests.
 */
export function partnerPerformanceRows(input: {
  firms: PerfFirm[];
  referrals: PerfReferral[];
  activities: PerfActivity[];
  bookingDates?: Map<string, string | null>;
  now?: number;
}): PartnerPerformanceRow[] {
  const now = input.now ?? Date.now();
  const bookingDates = input.bookingDates ?? new Map();

  type Acc = {
    totalReferrals: number;
    convertedReferrals: number;
    bookings: number;
    revenue: number;
    lastReferral: string | null;
    lastBooking: string | null;
    lastContact: string | null;
  };
  const acc = new Map<string, Acc>();
  const ensure = (firmId: string): Acc => {
    let a = acc.get(firmId);
    if (!a) {
      a = {
        totalReferrals: 0,
        convertedReferrals: 0,
        bookings: 0,
        revenue: 0,
        lastReferral: null,
        lastBooking: null,
        lastContact: null,
      };
      acc.set(firmId, a);
    }
    return a;
  };

  for (const r of input.referrals) {
    if (!r.firm_id) continue;
    const a = ensure(r.firm_id);
    a.totalReferrals++;
    if (r.converted) a.convertedReferrals++;
    if (r.booking_id) {
      a.bookings++;
      const bDate = bookingDates.get(r.booking_id) ?? null;
      a.lastBooking = laterOf(a.lastBooking, bDate);
    }
    a.revenue += n(r.revenue);
    a.lastReferral = laterOf(a.lastReferral, referralDate(r));
  }

  for (const act of input.activities) {
    if (!act.firm_id) continue;
    const a = ensure(act.firm_id);
    a.lastContact = laterOf(a.lastContact, act.happened_at ?? null);
  }

  return input.firms.map((firm) => {
    const a = acc.get(firm.id);
    const totalReferrals = a?.totalReferrals ?? 0;
    const convertedReferrals = a?.convertedReferrals ?? 0;
    const revenue = a?.revenue ?? 0;
    const lastReferral = a?.lastReferral ?? null;
    const lastContact = a?.lastContact ?? null;
    // "Active" = the latest of a referral or a logged contact.
    const lastActive = laterOf(lastReferral, lastContact);
    const daysSinceLastActivity = daysSince(lastActive, now);

    const stats: PartnerStats = {
      totalReferrals,
      convertedReferrals,
      revenue,
      daysSinceLastActivity,
    };

    return {
      firmId: firm.id,
      firmName: firm.firm_name,
      partnerStatus: firm.partner_status,
      assignedTo: firm.assigned_to,
      city: firm.city ?? null,
      state: firm.state ?? null,
      totalReferrals,
      convertedReferrals,
      bookings: a?.bookings ?? 0,
      revenue,
      lastReferral,
      lastBooking: a?.lastBooking ?? null,
      lastContact,
      daysSinceLastActivity,
      score: partnerScore(stats),
      health: partnerHealthCategory(stats),
    };
  });
}
