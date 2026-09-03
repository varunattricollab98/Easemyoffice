// ─────────────────────────────────────────────────────────────────────────
// Deno-compatible copy of the pure Gmail parsing helpers.
//
// SOURCE OF TRUTH: src/lib/gmail.ts (the browser module). Supabase edge
// functions run under Deno and CANNOT import that browser module (it imports
// the Supabase browser client). So the pure, dependency-free functions the
// server-side sync needs are re-implemented here, BEHAVIOUR-IDENTICAL to
// src/lib/gmail.ts. Keep the two in sync: any change to a function here must be
// mirrored in src/lib/gmail.ts and vice-versa.
//
// Functions copied: parseFrom, claimedOwner, normalizeOwnerTag,
// matchOwnerTagToName, isThrowawayAddress, htmlToText, parseWeb3FormLead.
//
// The canonical dedup rule (documented in src/lib/gmail.ts) is: a lead created
// from an email is deduped by [realCustomerEmail, relaySenderAddress], both
// lowercased/trimmed; if EITHER already maps to a lead, no new lead is created.
// gmail-tag-sync/index.ts uses these helpers to reproduce that rule exactly.
// ─────────────────────────────────────────────────────────────────────────

// Split "Name <email@x.com>" into its parts.
export function parseFrom(from: string): { name: string; address: string } {
  if (!from) return { name: "", address: "" };
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: (m[1] || "").trim(), address: (m[2] || "").trim() };
  if (from.includes("@")) return { name: "", address: from.trim() };
  return { name: from.trim(), address: "" };
}

// Which person has claimed an email, from its Gmail labels ("<Name> lead"),
// or null if unclaimed.
export function claimedOwner(labels: string[]): string | null {
  const l = (labels || []).find((x) => /\blead$/i.test(x.trim()));
  return l ? l.replace(/\s*lead$/i, "").trim() : null;
}

// Strip a possessive owner tag down to a bare name so it can be matched to a
// team member: "Hardik's" -> "Hardik", "Kishan" -> "Kishan".
export function normalizeOwnerTag(owner: string | null | undefined): string {
  return (owner || "").replace(/[’'`]s\b/gi, "").replace(/\s+/g, " ").trim();
}

// Canonical owner-tag -> team-member matching rule (three tiers, in order):
//   1. exact full-name match (lowercased),
//   2. first-name (first whitespace-delimited token) match,
//   3. "starts with <tag> " prefix match.
// Returns the index of the first matching name, or -1 if none/empty. Identical
// to matchOwnerTagToName in src/lib/gmail.ts.
export function matchOwnerTagToName(ownerTag: string | null | undefined, names: (string | null | undefined)[]): number {
  const norm = normalizeOwnerTag(ownerTag).toLowerCase();
  if (!norm) return -1;
  const normalized = names.map((n) => (n || "").trim().toLowerCase());
  const byFull = normalized.findIndex((n) => n === norm);
  if (byFull !== -1) return byFull;
  const byFirst = normalized.findIndex((n) => n.split(/\s+/)[0] === norm);
  if (byFirst !== -1) return byFirst;
  const byStarts = normalized.findIndex((n) => n.startsWith(norm + " "));
  return byStarts;
}

// Addresses that are never a real customer contact (form relays, no-reply, our
// own shared mailbox). Used so we don't save these as a lead's email.
export function isThrowawayAddress(addr: string | null | undefined): boolean {
  return /web3forms|noreply|no-reply|tawk\.email|zenith-spaces|easemyoffice\.in/i.test(addr || "");
}

// Best-effort convert a chunk of HTML into readable, line-separated plain text
// so we can scan it for form fields.
export function htmlToText(html: string): string {
  return (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|td|th|li|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

export interface ParsedFormLead {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  company?: string;
  message?: string;
}

// Field label synonyms found in Web3Forms / typical contact-form emails.
const FORM_FIELD_ALIASES: Record<keyof ParsedFormLead, string[]> = {
  name: ["name", "full name", "your name", "contact name"],
  email: ["email", "email address", "e-mail", "your email", "email id"],
  phone: ["phone", "mobile", "phone number", "mobile number", "contact", "contact number", "contact no", "whatsapp"],
  location: ["location", "city", "address", "state"],
  company: ["company", "business", "business name", "organisation", "organization"],
  message: ["message", "comments", "query", "requirement", "requirements", "details", "note", "notes"],
};

// Parse a Web3Forms (or similar labelled) submission body into real lead fields.
// Handles both "Label: value" (same line) and "Label\nvalue" (next line) layouts,
// and falls back to regex extraction for email/phone if labels are missing.
export function parseWeb3FormLead(rawBody: string): ParsedFormLead {
  const text = /<[a-z!/]/i.test(rawBody) ? htmlToText(rawBody) : rawBody;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const aliasToField = new Map<string, keyof ParsedFormLead>();
  (Object.keys(FORM_FIELD_ALIASES) as (keyof ParsedFormLead)[]).forEach((f) =>
    FORM_FIELD_ALIASES[f].forEach((a) => aliasToField.set(a, f)),
  );
  const labelOf = (s: string): keyof ParsedFormLead | null => {
    const key = s.replace(/[:*\-\s]+$/, "").trim().toLowerCase();
    return aliasToField.get(key) ?? null;
  };

  const out: ParsedFormLead = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // "Label: value" on one line
    const inline = line.match(/^([A-Za-z][A-Za-z /.]{1,26})\s*[:\-]\s*(.+)$/);
    if (inline) {
      const f = labelOf(inline[1]);
      if (f && !out[f]) { out[f] = inline[2].trim(); continue; }
    }
    // "Label" then value on the following line
    const f = labelOf(line);
    if (f && !out[f]) {
      const next = lines[i + 1];
      if (next && !labelOf(next)) { out[f] = next.trim(); i++; }
    }
  }

  // Fallbacks: pull the first real-looking email / phone from anywhere in the body.
  if (!out.email) {
    const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    const real = emails.find((e) => !isThrowawayAddress(e));
    if (real) out.email = real;
  }
  if (!out.phone) {
    const m = text.match(/\+?\d[\d\s-]{7,}\d/);
    if (m) out.phone = m[0].trim();
  }
  // Normalise the phone a touch (keep leading + and digits only).
  if (out.phone) {
    const plus = out.phone.trim().startsWith("+") ? "+" : "";
    out.phone = plus + out.phone.replace(/\D/g, "");
  }
  return out;
}
