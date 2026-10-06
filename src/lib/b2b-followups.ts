// Pure follow-up bucketing for the B2B Follow-ups workflow.
//
// The Follow-ups page splits scheduled follow-ups (public.b2b_followups) into
// three buckets by their due date relative to "now": Today, Upcoming and
// Overdue. This module keeps that classification pure and DB-free so it can be
// unit-tested deterministically (the repo convention — booking-math.ts,
// payroll.ts, attendance-rules.ts, b2b-import.ts). The caller passes "now" in
// so tests never depend on the wall clock.
//
// Timezone: the HRMS code treats business days in IST (+05:30). "Today" here is
// the IST calendar day, so a follow-up due at 23:00 IST and the moment "now" at
// 09:00 IST on the same date both land in the Today bucket regardless of the
// machine's local timezone or UTC drift across midnight.

/** The three follow-up buckets, in display order. */
export type FollowupBucket = "overdue" | "today" | "upcoming";

/** India Standard Time offset in minutes (+05:30). */
export const IST_OFFSET_MINUTES = 5 * 60 + 30;

/**
 * The IST calendar day for an instant, as a stable YYYY-MM-DD string. Shifting
 * the UTC epoch by the IST offset and then reading the UTC date parts gives the
 * civil date in IST without any dependency on the host timezone.
 */
export function istDayKey(instant: Date | string | number): string {
  const ms = new Date(instant).getTime();
  const shifted = new Date(ms + IST_OFFSET_MINUTES * 60_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Classify a single follow-up due-date against "now":
 *  - "today"    — due on the same IST calendar day as now.
 *  - "overdue"  — due on an earlier IST calendar day than now.
 *  - "upcoming" — due on a later IST calendar day than now.
 *
 * Comparing day keys (not raw timestamps) means a follow-up due earlier today
 * still counts as Today, not Overdue, matching how a user reads their list.
 */
export function bucketFor(
  dueAt: Date | string | number,
  now: Date | string | number,
): FollowupBucket {
  const due = istDayKey(dueAt);
  const today = istDayKey(now);
  if (due === today) return "today";
  return due < today ? "overdue" : "upcoming";
}

/** A follow-up as far as bucketing cares: it only needs a due date. */
export type BucketableFollowup = { due_at: string };

/** The three buckets, each a list preserving the caller's input order. */
export type FollowupBuckets<T extends BucketableFollowup> = {
  overdue: T[];
  today: T[];
  upcoming: T[];
};

/**
 * Split a list of follow-ups into the overdue / today / upcoming buckets.
 * Pure: given the same input and "now", always returns the same grouping.
 */
export function bucketFollowups<T extends BucketableFollowup>(
  followups: readonly T[],
  now: Date | string | number,
): FollowupBuckets<T> {
  const buckets: FollowupBuckets<T> = { overdue: [], today: [], upcoming: [] };
  for (const f of followups) {
    buckets[bucketFor(f.due_at, now)].push(f);
  }
  return buckets;
}
