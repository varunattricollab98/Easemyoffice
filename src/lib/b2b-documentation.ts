// B2B partner-onboarding documentation maths — pure, tested, no DB / React.
//
// Turns a b2b_onboarding checklist row into the numbers the Documentation page
// renders: how many of the 8 items are done, the progress %, whether the
// checklist is pending or completed, its turnaround time (TAT), and whether it
// is delayed. Framework-free like booking-math.ts / payroll.ts so it is
// unit-testable in isolation; the queries layer only moves data.

import { ONBOARDING_ITEMS, type OnboardingItemId } from "@/lib/b2b";

/** The minimal checklist shape the roll-up needs (a subset of B2BOnboarding). */
export type OnboardingLike = {
  firm_details: boolean;
  contact_details: boolean;
  agreement: boolean;
  required_documents: boolean;
  partner_terms: boolean;
  referral_process_explained: boolean;
  communication_setup: boolean;
  onboarding_completed: boolean;
  created_at?: string | null;
  completed_at?: string | null;
};

export const ONBOARDING_ITEM_COUNT = ONBOARDING_ITEMS.length;

/** How many days a checklist may sit open before it is considered delayed. */
export const DEFAULT_ONBOARDING_TAT_DAYS = 7;

/** Whole days between two ISO/date strings, or null when either is missing. */
export function daysBetween(from: string | null | undefined, to: string | null | undefined) {
  if (!from || !to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

/** The ids of the checklist items that are ticked, in display order. */
export function completedItemIds(row: OnboardingLike): OnboardingItemId[] {
  return ONBOARDING_ITEMS.filter((i) => row[i.id] === true).map((i) => i.id);
}

export type OnboardingProgress = {
  /** Number of ticked checklist items (0–8). */
  completed: number;
  /** Total checklist items (always ONBOARDING_ITEM_COUNT). */
  total: number;
  /** Rounded 0–100 progress percentage. */
  percent: number;
  /** True once the final "Onboarding Completed" item is ticked. */
  isComplete: boolean;
  /**
   * Turnaround time in days: for a completed checklist, created_at →
   * completed_at; for an open one, created_at → `now`. Null without a
   * created_at.
   */
  tatDays: number | null;
  /**
   * True when an OPEN checklist has been sitting longer than `tatDays`
   * threshold. A completed checklist is never delayed.
   */
  isDelayed: boolean;
};

/**
 * Roll a single checklist up into its progress numbers. Pure: pass `now` and
 * `tatThresholdDays` for deterministic tests.
 */
export function onboardingProgress(
  row: OnboardingLike,
  opts: { now?: number; tatThresholdDays?: number } = {},
): OnboardingProgress {
  const now = opts.now ?? Date.now();
  const threshold = opts.tatThresholdDays ?? DEFAULT_ONBOARDING_TAT_DAYS;
  const completed = completedItemIds(row).length;
  const total = ONBOARDING_ITEM_COUNT;
  const percent = Math.round((completed / total) * 100);
  const isComplete = row.onboarding_completed === true;

  const nowIso = new Date(now).toISOString();
  const tatDays = isComplete
    ? daysBetween(row.created_at, row.completed_at ?? nowIso)
    : daysBetween(row.created_at, nowIso);

  const isDelayed = !isComplete && tatDays !== null && tatDays > threshold;

  return { completed, total, percent, isComplete, tatDays, isDelayed };
}

export type OnboardingSummary = {
  /** Total checklists. */
  total: number;
  /** Checklists whose final item is ticked. */
  completed: number;
  /** Checklists still open. */
  pending: number;
  /** Open checklists past the TAT threshold. */
  delayed: number;
  /** Average TAT (days) across COMPLETED checklists, or null when none. */
  avgTatDays: number | null;
  /** Average progress % across every checklist (0 when empty). */
  avgPercent: number;
};

/**
 * Summarise a list of checklists for the Documentation dashboard tiles. Pure:
 * pass `now` / `tatThresholdDays` for deterministic tests.
 */
export function summarizeOnboarding(
  rows: OnboardingLike[],
  opts: { now?: number; tatThresholdDays?: number } = {},
): OnboardingSummary {
  if (rows.length === 0) {
    return { total: 0, completed: 0, pending: 0, delayed: 0, avgTatDays: null, avgPercent: 0 };
  }
  let completed = 0;
  let delayed = 0;
  let percentSum = 0;
  const completedTats: number[] = [];

  for (const row of rows) {
    const p = onboardingProgress(row, opts);
    percentSum += p.percent;
    if (p.isComplete) {
      completed++;
      if (p.tatDays !== null) completedTats.push(p.tatDays);
    } else if (p.isDelayed) {
      delayed++;
    }
  }

  const avgTatDays =
    completedTats.length > 0
      ? Math.round(completedTats.reduce((s, d) => s + d, 0) / completedTats.length)
      : null;

  return {
    total: rows.length,
    completed,
    pending: rows.length - completed,
    delayed,
    avgTatDays,
    avgPercent: Math.round(percentSum / rows.length),
  };
}
