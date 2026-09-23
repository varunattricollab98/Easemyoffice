import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/utils";

export interface InboxEmail {
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  labels: string[];
  url: string;
}

// The edge function that bridges to a Gmail mailbox. Sales uses "gmail-bridge"
// (contact@easemyoffice.in); the Renewals inbox passes "renewals-gmail-bridge"
// (renewals@easemyoffice.in). Both functions share the same request/response
// shape, so the same helpers below serve either mailbox.
export type GmailBridgeFn = "gmail-bridge" | "renewals-gmail-bridge";

// Fetch a page of lead emails from a Gmail inbox (via the given bridge edge
// function). `start` is the offset (for pagination). Fails soft if not connected.
export async function fetchInbox(max = 40, start = 0, fn: GmailBridgeFn = "gmail-bridge"): Promise<{ ok: boolean; emails: InboxEmail[]; hasMore: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke(fn, { body: { action: "inbox", max, start } });
    if (error) return { ok: false, emails: [], hasMore: false, error: `Function call failed: ${error.message || "invoke error"}` };
    if (!data?.ok) return { ok: false, emails: [], hasMore: false, error: data?.error || "unknown error" };
    const emails = Array.isArray(data.emails) ? data.emails : [];
    return { ok: true, emails, hasMore: data.hasMore ?? emails.length >= max };
  } catch (e: unknown) {
    return { ok: false, emails: [], hasMore: false, error: getErrorMessage(e, "unknown error") };
  }
}

export interface ThreadMessage {
  from: string;
  to: string;
  date: string;
  subject: string;
  body: string;
  html?: string;
  attachments?: { name: string; size: number }[];
}

// Load the full text of one email thread (all messages) for reading in the CRM.
export async function fetchThread(threadId: string, fn: GmailBridgeFn = "gmail-bridge"): Promise<{ ok: boolean; subject?: string; url?: string; messages: ThreadMessage[]; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke(fn, { body: { action: "thread", threadId } });
    if (error) return { ok: false, messages: [], error: error.message };
    if (!data?.ok) return { ok: false, messages: [], error: data?.error || "could not load" };
    return { ok: true, subject: data.subject, url: data.url, messages: Array.isArray(data.messages) ? data.messages : [] };
  } catch (e: unknown) {
    return { ok: false, messages: [], error: getErrorMessage(e, "could not load") };
  }
}

// Label a Gmail thread as "<Name> lead" and mark it read.
export async function claimEmailInGmail(threadId: string, label: string, fn: GmailBridgeFn = "gmail-bridge"): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke(fn, { body: { action: "claim", threadId, label } });
    if (error) return { ok: false, error: error.message };
    if (!data?.ok) return { ok: false, error: data?.error || "claim failed" };
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: getErrorMessage(e, "claim failed") };
  }
}

// Send a reply INSIDE the same Gmail thread (native Gmail reply). The Apps
// Script behind the bridge uses GmailThread.reply/replyAll, so the message
// stays in the original conversation and appears in the mailbox's Sent — the
// customer sees it as a normal reply to their email. `htmlBody` is the full
// reply HTML (the rep's typed text + their signature) built by the caller.
export interface ReplyAttachmentPayload {
  name: string;
  mimeType: string;
  dataBase64: string;
}

export async function sendThreadReply(
  threadId: string,
  htmlBody: string,
  opts: { cc?: string; replyAll?: boolean; fn?: GmailBridgeFn; attachments?: ReplyAttachmentPayload[] } = {},
): Promise<{ ok: boolean; error?: string }> {
  const fn = opts.fn ?? "gmail-bridge";
  try {
    const { data, error } = await supabase.functions.invoke(fn, {
      body: {
        action: "reply",
        threadId,
        htmlBody,
        cc: opts.cc || "",
        replyAll: opts.replyAll ? true : false,
        attachments: Array.isArray(opts.attachments) ? opts.attachments : [],
      },
    });
    if (error) return { ok: false, error: error.message };
    if (!data?.ok) return { ok: false, error: data?.error || "reply failed" };
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: getErrorMessage(e, "reply failed") };
  }
}

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

// Canonical owner-tag -> team-member matching rule, operating on plain name
// strings so it can be reused anywhere (the client's inbox page today, and any
// future server-side sync that mirrors this logic).
//
// Given a Gmail owner tag ("Hardik's", "Kishan", "Hardik Kumar") and a list of
// candidate full names, return the index of the first matching name using the
// SAME three tiers, in order, that inbox.tsx has always used:
//   1. exact full-name match (lowercased),
//   2. first-name (first whitespace-delimited token) match,
//   3. "starts with <tag> " prefix match.
// Returns -1 if none match or the tag normalises to empty. The tag is passed
// through normalizeOwnerTag first so possessive forms ("Hardik's") are handled.
//
// NOTE: this must stay behaviourally identical to matchOwnerToUser in
// src/routes/_authenticated/inbox.tsx, which now delegates here. The server
// sync (written in Deno, which cannot import this browser module) must
// replicate this exact three-tier order to avoid drift.
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

// CANONICAL DEDUP KEY RULE (shared contract, documented here to prevent drift):
// A lead created from an email is deduped by the pair
//   [realCustomerEmail, relaySenderAddress]
// where each value is lowercased and trimmed before comparison. Before inserting
// a lead, existing leads must be looked up by BOTH of these keys; if either key
// already maps to a lead, no new lead is created. `realCustomerEmail` is the
// actual customer address parsed from the form body (see parseWeb3FormLead),
// while `relaySenderAddress` is the envelope sender (which may be a Web3Forms /
// relay address per isThrowawayAddress). The future server-side sync function is
// written in Deno and CANNOT import this browser module, so it MUST replicate
// this exact rule rather than reimplement a divergent one.

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
