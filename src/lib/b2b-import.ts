// Pure, testable logic for the B2B CSV import flow (FEAT-004).
//
// Everything here operates on plain arrays and primitives — no Supabase, no
// React — so it can be unit-tested without a database (the repo convention: see
// booking-math.ts, payroll.ts, b2b-scoring.ts). The import route in
// src/routes/_authenticated/b2b/import.tsx wires these functions to the parsed
// CSV rows and to the existing ca_firms / b2b_leads records fetched through
// b2bDb(), then performs the chunked inserts.
//
// Four duplicate-detection keys are supported (per spec section 7 step 5):
//   1. exact phone, normalised to the last 10 digits
//   2. email, lower-cased
//   3. firm_name + city, both normalised
//   4. website, host-normalised
// A row is a duplicate when ANY key matches either an existing record OR an
// earlier row in the same uploaded file.

// ---------------------------------------------------------------------------
// Normalised B2B import field set — one entry per mappable CSV column
// (spec section 7 step 3). Keys match the b2b_leads / ca_firms columns.
// ---------------------------------------------------------------------------

/** The 14 B2B fields a CSV column can map to. */
export type B2BImportField =
  | "firm_name"
  | "contact_person"
  | "designation"
  | "phone"
  | "alt_phone"
  | "email"
  | "website"
  | "city"
  | "state"
  | "full_address"
  | "firm_type"
  | "firm_size"
  | "lead_source"
  | "source_url";

/** A single parsed import row — every value already trimmed to a string. */
export type ImportRow = Record<B2BImportField, string>;

/** The identity fields of an existing firm/lead used for duplicate matching. */
export type DedupeRecord = {
  firm_name?: string | null;
  phone?: string | null;
  alt_phone?: string | null;
  email?: string | null;
  website?: string | null;
  city?: string | null;
};

// ---------------------------------------------------------------------------
// Normalisers (exported so the UI and the DB layer agree on the exact keys).
// ---------------------------------------------------------------------------

/**
 * Normalise a phone number to its last 10 digits (Indian mobile length),
 * dropping country codes, spaces, dashes and punctuation. Returns "" when there
 * are not enough digits to form a usable key, so empty/short values never
 * collide with each other.
 */
export function normalizePhone(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

/** Lower-case + trim an email; "" when blank. */
export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/** Host-normalise a website: strip scheme, "www.", path and trailing slash. */
export function normalizeWebsite(raw: string | null | undefined): string {
  let s = (raw ?? "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.split(/[/?#]/)[0];
  return s.replace(/\/+$/, "");
}

/** Collapse whitespace + lower-case a free-text value (firm name, city). */
function normalizeText(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** firm_name + "|" + city composite key; "" when firm_name is blank. */
export function firmCityKey(
  firmName: string | null | undefined,
  city: string | null | undefined,
): string {
  const f = normalizeText(firmName);
  if (!f) return "";
  return `${f}|${normalizeText(city)}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A row is valid when it has a firm name AND at least one usable contact
 * (a 10-digit phone or a well-formed email). Any email/phone that is present
 * but malformed is also reported. Returns the list of human reasons; an empty
 * list means the row is valid.
 */
export function validateRow(row: ImportRow): string[] {
  const reasons: string[] = [];
  const firm = (row.firm_name ?? "").trim();
  if (!firm) reasons.push("Missing Firm Name");

  const phone = normalizePhone(row.phone);
  const emailRaw = (row.email ?? "").trim();
  const emailValid = emailRaw !== "" && EMAIL_RE.test(emailRaw);

  if (!phone && !emailValid) {
    if (!(row.phone ?? "").trim() && emailRaw === "") {
      reasons.push("Missing Phone and Email");
    }
  }
  if ((row.phone ?? "").trim() && !phone) {
    reasons.push("Malformed Phone");
  }
  if (emailRaw && !emailValid) {
    reasons.push("Malformed Email");
  }
  return reasons;
}

/** True when the row passes validation (no reasons). */
export function isRowValid(row: ImportRow): boolean {
  return validateRow(row).length === 0;
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

/** The four dedupe keys for a single record (empty string = not applicable). */
export type DedupeKeys = {
  phones: string[];
  email: string;
  firmCity: string;
  website: string;
};

/** Compute the dedupe keys for an import row. */
export function rowDedupeKeys(row: ImportRow): DedupeKeys {
  return {
    phones: [normalizePhone(row.phone), normalizePhone(row.alt_phone)].filter(Boolean),
    email: normalizeEmail(row.email),
    firmCity: firmCityKey(row.firm_name, row.city),
    website: normalizeWebsite(row.website),
  };
}

/** Compute the dedupe keys for an existing firm/lead record. */
export function recordDedupeKeys(rec: DedupeRecord): DedupeKeys {
  return {
    phones: [normalizePhone(rec.phone), normalizePhone(rec.alt_phone)].filter(Boolean),
    email: normalizeEmail(rec.email),
    firmCity: firmCityKey(rec.firm_name, rec.city),
    website: normalizeWebsite(rec.website),
  };
}

/** An index of existing dedupe keys, built once per import. */
export type DedupeIndex = {
  phones: Set<string>;
  emails: Set<string>;
  firmCities: Set<string>;
  websites: Set<string>;
};

/** Build a lookup index from the existing firm/lead records. */
export function buildDedupeIndex(records: DedupeRecord[]): DedupeIndex {
  const index: DedupeIndex = {
    phones: new Set(),
    emails: new Set(),
    firmCities: new Set(),
    websites: new Set(),
  };
  for (const rec of records) {
    const keys = recordDedupeKeys(rec);
    keys.phones.forEach((p) => index.phones.add(p));
    if (keys.email) index.emails.add(keys.email);
    if (keys.firmCity) index.firmCities.add(keys.firmCity);
    if (keys.website) index.websites.add(keys.website);
  }
  return index;
}

/** Which dedupe key(s) matched, for display. Empty = no match. */
export function matchedKeys(keys: DedupeKeys, index: DedupeIndex): string[] {
  const hits: string[] = [];
  if (keys.phones.some((p) => index.phones.has(p))) hits.push("phone");
  if (keys.email && index.emails.has(keys.email)) hits.push("email");
  if (keys.firmCity && index.firmCities.has(keys.firmCity)) hits.push("firm_name + city");
  if (keys.website && index.websites.has(keys.website)) hits.push("website");
  return hits;
}

/** Add a row's keys into an index (used to catch within-file duplicates). */
function addKeys(index: DedupeIndex, keys: DedupeKeys): void {
  keys.phones.forEach((p) => index.phones.add(p));
  if (keys.email) index.emails.add(keys.email);
  if (keys.firmCity) index.firmCities.add(keys.firmCity);
  if (keys.website) index.websites.add(keys.website);
}

// ---------------------------------------------------------------------------
// Classification — validate + dedupe every uploaded row in one pass.
// ---------------------------------------------------------------------------

export type RowClassification =
  | { status: "invalid"; index: number; reasons: string[] }
  | { status: "duplicate"; index: number; matchedOn: string[] }
  | { status: "new"; index: number };

export type ClassifyResult = {
  classifications: RowClassification[];
  counts: { total: number; new: number; duplicate: number; invalid: number };
};

/**
 * Classify every uploaded row as new / duplicate / invalid.
 *
 * - Invalid rows (failing validateRow) are reported first and never counted as
 *   duplicates.
 * - A valid row is a duplicate when any of its four keys matches an existing
 *   record OR an earlier valid row in the same file (first occurrence wins and
 *   is counted as new; later ones are duplicates).
 */
export function classifyRows(rows: ImportRow[], existing: DedupeRecord[]): ClassifyResult {
  const index = buildDedupeIndex(existing);
  // A separate running set of keys seen earlier in THIS file.
  const seen: DedupeIndex = {
    phones: new Set(),
    emails: new Set(),
    firmCities: new Set(),
    websites: new Set(),
  };
  const classifications: RowClassification[] = [];
  let newCount = 0;
  let dupCount = 0;
  let invalidCount = 0;

  rows.forEach((row, i) => {
    const reasons = validateRow(row);
    if (reasons.length > 0) {
      classifications.push({ status: "invalid", index: i, reasons });
      invalidCount++;
      return;
    }
    const keys = rowDedupeKeys(row);
    const hits = [...matchedKeys(keys, index), ...matchedKeys(keys, seen)];
    // De-dup the hit labels so "phone" matching both existing and in-file reads once.
    const uniqueHits = Array.from(new Set(hits));
    if (uniqueHits.length > 0) {
      classifications.push({ status: "duplicate", index: i, matchedOn: uniqueHits });
      dupCount++;
    } else {
      classifications.push({ status: "new", index: i });
      newCount++;
    }
    // Always record this row's keys so a later identical row is caught in-file.
    addKeys(seen, keys);
  });

  return {
    classifications,
    counts: { total: rows.length, new: newCount, duplicate: dupCount, invalid: invalidCount },
  };
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

export type AssignmentMode = "specific" | "team" | "round_robin";

/**
 * Deterministic round-robin: cycle the provided user ids across `count` rows so
 * row i goes to users[i % users.length]. Pure, so a test can assert the exact
 * distribution. Returns an all-null array when there are no users (equivalent
 * to the "team" / unassigned pool mode).
 */
export function roundRobinAssign(userIds: string[], count: number): (string | null)[] {
  if (count <= 0) return [];
  if (userIds.length === 0) return new Array(count).fill(null);
  const out: (string | null)[] = [];
  for (let i = 0; i < count; i++) {
    out.push(userIds[i % userIds.length]);
  }
  return out;
}

/**
 * Resolve the assigned_to value for each of `count` rows given the chosen mode:
 *  - "specific":    everyone -> specificUserId (or null if not provided)
 *  - "team":        everyone -> null (unassigned pool pickup)
 *  - "round_robin": deterministic cycling across userIds
 */
export function resolveAssignments(
  mode: AssignmentMode,
  count: number,
  opts: { specificUserId?: string | null; roundRobinUserIds?: string[] } = {},
): (string | null)[] {
  if (count <= 0) return [];
  switch (mode) {
    case "specific":
      return new Array(count).fill(opts.specificUserId ?? null);
    case "team":
      return new Array(count).fill(null);
    case "round_robin":
      return roundRobinAssign(opts.roundRobinUserIds ?? [], count);
  }
}

/** Count how many of the resolved assignments are non-null (assigned_records). */
export function countAssigned(assignments: (string | null)[]): number {
  return assignments.filter((a) => a != null).length;
}
