/**
 * Shared email utility helpers used by both the Follow-ups page
 * and the Lead detail page.
 */

/**
 * Generate a human-readable frequency label for an email reminder.
 * Shows interval (Daily / Weekly / Every Xd) and remaining days if a repeat_until is set.
 */
export function getFrequencyLabel(intervalDays: number, repeatUntil: string | null): string {
  if (intervalDays === 0) return "One-time";
  if (!repeatUntil) return intervalDays === 1 ? "Daily" : `Every ${intervalDays} days`;

  const now = new Date();
  const until = new Date(repeatUntil);
  const daysLeft = Math.max(0, Math.ceil((until.getTime() - now.getTime()) / 86400000));

  const freqLabel = intervalDays === 1 ? "Daily" : intervalDays === 7 ? "Weekly" : `Every ${intervalDays}d`;
  return `${freqLabel}, ${daysLeft}d left`;
}
