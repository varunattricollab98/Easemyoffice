// Partner scoring — pure, tested, no imports.
//
// Turns a firm's referral/booking history into a single 0-100 partner_score and
// a PARTNER_HEALTH category (see src/lib/b2b.ts). Kept here, free of any
// database or React dependency, so the thresholds can be unit-tested in
// isolation — the same pattern as booking-math.ts / payroll.ts.
//
// The score is a blend of four signals:
//   * volume   — how many referrals the partner has sent (ever).
//   * quality  — how many of those converted into bookings.
//   * revenue  — rupees of booking revenue attributed to the partner.
//   * recency  — how recently the partner last sent a referral / was active.
// Each contributes up to a fixed cap; the caps sum to 100.

export type PartnerStats = {
  /** Total referrals ever received from the firm. */
  totalReferrals: number;
  /** Referrals that converted (became a booking). */
  convertedReferrals: number;
  /** Booking revenue attributed to the firm, in rupees. */
  revenue: number;
  /**
   * Days since the partner was last active (last referral or contact). Null
   * when the firm has never been active. Larger = more stale.
   */
  daysSinceLastActivity: number | null;
};

/** PARTNER_HEALTH category ids, mirrored from src/lib/b2b.ts. */
export type PartnerHealthId = "strategic" | "active" | "potential" | "dormant" | "lost";

/** Score component caps — sum to 100. */
export const SCORE_WEIGHTS = {
  volume: 25,
  quality: 25,
  revenue: 30,
  recency: 20,
} as const;

/** A referral is "recent" within this many days (full recency credit). */
const RECENT_DAYS = 90;
/** Beyond this many days of inactivity a partner is treated as gone. */
const STALE_DAYS = 365;
/** Referral count that earns the full volume cap. */
const VOLUME_TARGET = 10;
/** Revenue (rupees) that earns the full revenue cap. */
const REVENUE_TARGET = 500_000;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * 0-100 partner score. Monotonic in each positive signal (more referrals,
 * conversions, revenue, and more recent activity never lower the score) and
 * returns 0 for a firm with no history at all.
 */
export function partnerScore(stats: PartnerStats): number {
  const totalReferrals = Math.max(0, stats.totalReferrals);
  const convertedReferrals = clamp(stats.convertedReferrals, 0, totalReferrals);
  const revenue = Math.max(0, stats.revenue);

  // Volume: linear up to VOLUME_TARGET referrals.
  const volume = clamp(totalReferrals / VOLUME_TARGET, 0, 1) * SCORE_WEIGHTS.volume;

  // Quality: conversion rate (no referrals -> no quality credit).
  const quality =
    totalReferrals === 0 ? 0 : (convertedReferrals / totalReferrals) * SCORE_WEIGHTS.quality;

  // Revenue: linear up to REVENUE_TARGET rupees.
  const revenueScore = clamp(revenue / REVENUE_TARGET, 0, 1) * SCORE_WEIGHTS.revenue;

  // Recency: full credit when active within RECENT_DAYS, decaying to 0 at
  // STALE_DAYS, and 0 when the partner has never been active.
  let recency = 0;
  const days = stats.daysSinceLastActivity;
  if (days != null && Number.isFinite(days)) {
    if (days <= RECENT_DAYS) {
      recency = SCORE_WEIGHTS.recency;
    } else if (days < STALE_DAYS) {
      const decay = 1 - (days - RECENT_DAYS) / (STALE_DAYS - RECENT_DAYS);
      recency = clamp(decay, 0, 1) * SCORE_WEIGHTS.recency;
    }
  }

  return Math.round(volume + quality + revenueScore + recency);
}

/**
 * Map a firm's stats to a PARTNER_HEALTH category. The score alone does not
 * capture lifecycle, so recency and referral history gate the category:
 *   * No referrals at all              -> Potential (never-active) / Dormant.
 *   * Long inactivity (> STALE_DAYS)   -> Lost.
 *   * Recent + high score              -> Strategic.
 *   * Recent, moderate                 -> Active.
 *   * Otherwise                        -> Dormant / Potential.
 */
export function partnerHealthCategory(stats: PartnerStats): PartnerHealthId {
  const totalReferrals = Math.max(0, stats.totalReferrals);
  const days = stats.daysSinceLastActivity;
  const score = partnerScore(stats);

  // Never active and no referrals: a prospect, not a partner.
  if (totalReferrals === 0 && days == null) return "potential";

  // Gone cold for over a year, regardless of past volume.
  if (days != null && days > STALE_DAYS) return "lost";

  // No referrals yet but has been contacted recently: still a potential.
  if (totalReferrals === 0) {
    return days != null && days <= RECENT_DAYS ? "potential" : "dormant";
  }

  // Has referred and is recently active.
  if (days != null && days <= RECENT_DAYS) {
    return score >= 70 ? "strategic" : "active";
  }

  // Has referred but has drifted (between RECENT_DAYS and STALE_DAYS).
  return "dormant";
}
