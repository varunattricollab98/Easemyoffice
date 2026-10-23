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

// ---------------------------------------------------------------------------
// Email addresses
//
// This regex used to be copy-pasted in the quotation dialog, the reminders
// page and the new-booking dialog (twice). One copy now, because a client with
// several addresses is normal and every form has to agree on what counts as an
// address.
//
// Two deliberately different standards:
//   - To is STRICT. A typo in a primary recipient must stop the send, not be
//     silently dropped, or the client never hears from us and nobody knows.
//   - CC/BCC are LENIENT. They are typed as a comma list and a stray trailing
//     comma or blank entry should not block anything.
// ---------------------------------------------------------------------------

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailAddress(value: string | null | undefined): boolean {
  return EMAIL_RE.test((value ?? "").trim());
}

/** Case-insensitive dedupe that keeps the first spelling it saw. */
export function dedupeEmails(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = (raw ?? "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * Lenient: splits a typed list on commas, semicolons or whitespace, keeps only
 * the valid addresses and dedupes them. Used for CC and BCC.
 */
export function parseEmailList(value: string | null | undefined): string[] {
  const parts = (value ?? "").split(/[,;\s]+/);
  return dedupeEmails(parts.filter((p) => isEmailAddress(p)));
}

/**
 * Strict: every non-blank entry must be a valid address. An empty string is
 * allowed (an optional field), so callers check emptiness separately.
 */
export function everyEmailValid(value: string | null | undefined): boolean {
  const parts = (value ?? "")
    .split(/[,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.every(isEmailAddress);
}

/**
 * The To list for a client: their primary address plus any alternates we hold,
 * in order, de-duplicated, invalid ones dropped.
 */
export function clientRecipients(...values: (string | null | undefined)[]): string[] {
  return dedupeEmails(values).filter((e) => isEmailAddress(e));
}
