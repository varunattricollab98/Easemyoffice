// Read/write query helpers for the B2B department, consumed by the UI phases.
//
// Every call goes through b2bDb() (the `supabase as any` escape hatch from
// src/lib/b2b.ts) because the B2B tables are not in the generated Supabase
// types — the hand-written row types in b2b.ts are the contract. All access is
// still enforced server-side by the RLS policies in
// supabase/migrations/20260517000002_b2b_core.sql, so a B2B user only ever gets
// their own rows back regardless of what is requested here.
//
// Pure aggregation maths (partner scoring, funnel counts) lives in separate
// testable modules (b2b-scoring.ts) — these helpers only move data.

import {
  b2bDb,
  type B2BActivity,
  type B2BContact,
  type B2BFollowup,
  type B2BImportBatch,
  type B2BLead,
  type B2BSource,
  type CaFirm,
  type Partnership,
  type Referral,
} from "@/lib/b2b";

function unwrap<T>(data: T[] | null, error: { message: string } | null): T[] {
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Firms
// ---------------------------------------------------------------------------

export type FirmFilters = {
  assignedTo?: string;
  partnerStatus?: string;
  search?: string;
};

export async function listFirms(filters: FirmFilters = {}): Promise<CaFirm[]> {
  let q = b2bDb().from("ca_firms").select("*");
  if (filters.assignedTo) q = q.eq("assigned_to", filters.assignedTo);
  if (filters.partnerStatus) q = q.eq("partner_status", filters.partnerStatus);
  if (filters.search) q = q.ilike("firm_name", `%${filters.search}%`);
  const { data, error } = await q.order("firm_name");
  return unwrap<CaFirm>(data, error);
}

export async function getFirm(id: string): Promise<CaFirm | null> {
  const { data, error } = await b2bDb().from("ca_firms").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CaFirm) ?? null;
}

export type NewFirm = {
  firm_name: string;
  firm_type?: string | null;
  firm_size?: string | null;
  website?: string | null;
  phone?: string | null;
  alt_phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  full_address?: string | null;
  lead_source?: string | null;
  source_url?: string | null;
  partner_status?: string | null;
  partner_since?: string | null;
  owner?: string | null;
  assigned_to?: string | null;
  created_by: string;
};

export async function createFirm(input: NewFirm): Promise<CaFirm> {
  const { data, error } = await b2bDb().from("ca_firms").insert(input).select("*").single();
  if (error) throw new Error(error.message);
  return data as CaFirm;
}

export type FirmPatch = Partial<Omit<NewFirm, "created_by">> & {
  primary_contact_id?: string | null;
};

export async function updateFirm(id: string, patch: FirmPatch): Promise<CaFirm> {
  const { data, error } = await b2bDb()
    .from("ca_firms")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as CaFirm;
}

/**
 * The firm 360 view: the firm plus every related record (contacts, activities,
 * partnerships, referrals) and a few rolled-up totals. Each related list is
 * fetched independently so a failure in one does not hide the others; the
 * fetches run in parallel.
 */
export type Firm360 = {
  firm: CaFirm | null;
  contacts: B2BContact[];
  activities: B2BActivity[];
  partnerships: Partnership[];
  referrals: Referral[];
  totals: {
    contacts: number;
    activities: number;
    partnerships: number;
    referrals: number;
    convertedReferrals: number;
    revenue: number;
  };
};

export async function getFirm360(id: string): Promise<Firm360> {
  const [firm, contacts, activities, partnerships, referrals] = await Promise.all([
    getFirm(id),
    listFirmContacts(id),
    listActivities({ firmId: id }),
    listPartnerships(id),
    listReferrals({ firmId: id }),
  ]);

  const convertedReferrals = referrals.filter((r) => r.converted).length;
  const revenue = referrals.reduce((sum, r) => sum + (Number(r.revenue) || 0), 0);

  return {
    firm,
    contacts,
    activities,
    partnerships,
    referrals,
    totals: {
      contacts: contacts.length,
      activities: activities.length,
      partnerships: partnerships.length,
      referrals: referrals.length,
      convertedReferrals,
      revenue,
    },
  };
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export async function listFirmContacts(firmId: string): Promise<B2BContact[]> {
  const { data, error } = await b2bDb()
    .from("b2b_contacts")
    .select("*")
    .eq("firm_id", firmId)
    .order("is_primary", { ascending: false })
    .order("name");
  return unwrap<B2BContact>(data, error);
}

/**
 * All contacts across every firm the caller can see (RLS still scopes rows).
 * Returns the firm name alongside each contact so the Contacts list can link
 * back to the firm 360 page without a second query per row.
 */
export type ContactWithFirm = B2BContact & { firm_name: string | null };

export async function listAllContacts(search?: string): Promise<ContactWithFirm[]> {
  let q = b2bDb().from("b2b_contacts").select("*, ca_firms(firm_name)").order("name");
  if (search) q = q.ilike("name", `%${search}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  type Joined = B2BContact & { ca_firms: { firm_name: string | null } | null };
  return ((data ?? []) as Joined[]).map((row) => {
    const { ca_firms, ...rest } = row;
    return { ...rest, firm_name: ca_firms?.firm_name ?? null };
  });
}

export type NewContact = {
  firm_id: string;
  name: string;
  designation?: string | null;
  phone?: string | null;
  alt_phone?: string | null;
  email?: string | null;
  is_primary?: boolean;
  created_by: string;
};

export async function createContact(input: NewContact): Promise<B2BContact> {
  const { data, error } = await b2bDb().from("b2b_contacts").insert(input).select("*").single();
  if (error) throw new Error(error.message);
  return data as B2BContact;
}

export type ContactPatch = Partial<Omit<NewContact, "firm_id" | "created_by">>;

export async function updateContact(id: string, patch: ContactPatch): Promise<B2BContact> {
  const { data, error } = await b2bDb()
    .from("b2b_contacts")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as B2BContact;
}

/**
 * Mark a single contact as the firm's primary: clear is_primary on every other
 * contact of the firm, set it on this one, and point ca_firms.primary_contact_id
 * at it. Three small writes rather than a transaction (no RPC available), which
 * is fine because RLS already scopes the rows to the owner.
 */
export async function setPrimaryContact(firmId: string, contactId: string): Promise<void> {
  const db = b2bDb();
  const clear = await db.from("b2b_contacts").update({ is_primary: false }).eq("firm_id", firmId);
  if (clear.error) throw new Error(clear.error.message);
  const mark = await db.from("b2b_contacts").update({ is_primary: true }).eq("id", contactId);
  if (mark.error) throw new Error(mark.error.message);
  const link = await db.from("ca_firms").update({ primary_contact_id: contactId }).eq("id", firmId);
  if (link.error) throw new Error(link.error.message);
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export type B2BLeadFilters = {
  assignedTo?: string;
  status?: string;
  firmId?: string;
  source?: string;
  priority?: string;
  importBatchId?: string;
  search?: string;
  sortByFollowUp?: boolean;
};

export async function listB2BLeads(filters: B2BLeadFilters = {}): Promise<B2BLead[]> {
  let q = b2bDb().from("b2b_leads").select("*");
  if (filters.assignedTo) q = q.eq("assigned_to", filters.assignedTo);
  if (filters.status) q = q.eq("lead_status", filters.status);
  if (filters.firmId) q = q.eq("firm_id", filters.firmId);
  if (filters.source) q = q.eq("lead_source", filters.source);
  if (filters.priority) q = q.eq("priority", filters.priority);
  if (filters.importBatchId) q = q.eq("import_batch_id", filters.importBatchId);
  if (filters.search) q = q.ilike("contact_person", `%${filters.search}%`);
  q = filters.sortByFollowUp
    ? q.order("next_follow_up_at", { ascending: true, nullsFirst: false })
    : q.order("created_at", { ascending: false });
  const { data, error } = await q;
  return unwrap<B2BLead>(data, error);
}

export type NewB2BLead = {
  contact_person?: string | null;
  firm_id?: string | null;
  designation?: string | null;
  phone?: string | null;
  alt_phone?: string | null;
  email?: string | null;
  website?: string | null;
  city?: string | null;
  state?: string | null;
  full_address?: string | null;
  firm_type?: string | null;
  firm_size?: string | null;
  lead_source?: string | null;
  source_url?: string | null;
  assigned_to?: string | null;
  lead_status?: string;
  priority?: string | null;
  next_follow_up_at?: string | null;
  latest_remark?: string | null;
  created_by: string;
};

export async function createB2BLead(input: NewB2BLead): Promise<B2BLead> {
  const { data, error } = await b2bDb().from("b2b_leads").insert(input).select("*").single();
  if (error) throw new Error(error.message);
  return data as B2BLead;
}

export type B2BLeadPatch = Partial<Omit<NewB2BLead, "created_by">>;

export async function updateB2BLead(id: string, patch: B2BLeadPatch): Promise<B2BLead> {
  const { data, error } = await b2bDb()
    .from("b2b_leads")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as B2BLead;
}

// ---------------------------------------------------------------------------
// Partnerships
// ---------------------------------------------------------------------------

export async function listPartnerships(firmId?: string): Promise<Partnership[]> {
  let q = b2bDb().from("partnerships").select("*");
  if (firmId) q = q.eq("firm_id", firmId);
  const { data, error } = await q.order("opened_at", { ascending: false });
  return unwrap<Partnership>(data, error);
}

// ---------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------

export type ReferralFilters = {
  firmId?: string;
  status?: string;
  assignedSalesperson?: string;
};

export async function listReferrals(filters: ReferralFilters = {}): Promise<Referral[]> {
  let q = b2bDb().from("referrals").select("*");
  if (filters.firmId) q = q.eq("firm_id", filters.firmId);
  if (filters.status) q = q.eq("referral_status", filters.status);
  if (filters.assignedSalesperson) q = q.eq("assigned_salesperson", filters.assignedSalesperson);
  const { data, error } = await q.order("created_at", { ascending: false });
  return unwrap<Referral>(data, error);
}

// ---------------------------------------------------------------------------
// Activities (append-friendly timeline)
// ---------------------------------------------------------------------------

export type ActivityScope = {
  firmId?: string;
  contactId?: string;
  leadId?: string;
};

export async function listActivities(scope: ActivityScope): Promise<B2BActivity[]> {
  let q = b2bDb().from("b2b_activities").select("*");
  if (scope.firmId) q = q.eq("firm_id", scope.firmId);
  if (scope.contactId) q = q.eq("contact_id", scope.contactId);
  if (scope.leadId) q = q.eq("lead_id", scope.leadId);
  const { data, error } = await q.order("happened_at", { ascending: false });
  return unwrap<B2BActivity>(data, error);
}

export type NewActivity = {
  type: B2BActivity["type"];
  firm_id?: string | null;
  contact_id?: string | null;
  lead_id?: string | null;
  subject?: string | null;
  notes?: string | null;
  outcome?: string | null;
  duration_minutes?: number | null;
  happened_at?: string | null;
  created_by: string;
};

export async function createActivity(input: NewActivity): Promise<B2BActivity> {
  const { data, error } = await b2bDb().from("b2b_activities").insert(input).select("*").single();
  if (error) throw new Error(error.message);
  return data as B2BActivity;
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

export type FollowupScope = {
  assignedTo?: string;
  leadId?: string;
  firmId?: string;
  status?: B2BFollowup["status"];
};

export async function listFollowups(scope: FollowupScope = {}): Promise<B2BFollowup[]> {
  let q = b2bDb().from("b2b_followups").select("*");
  if (scope.assignedTo) q = q.eq("assigned_to", scope.assignedTo);
  if (scope.leadId) q = q.eq("lead_id", scope.leadId);
  if (scope.firmId) q = q.eq("firm_id", scope.firmId);
  if (scope.status) q = q.eq("status", scope.status);
  const { data, error } = await q.order("due_at");
  return unwrap<B2BFollowup>(data, error);
}

export type FollowupPatch = Partial<
  Pick<B2BFollowup, "status" | "remark" | "completed_at" | "due_at" | "assigned_to">
>;

export async function updateFollowup(id: string, patch: FollowupPatch): Promise<B2BFollowup> {
  const { data, error } = await b2bDb()
    .from("b2b_followups")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as B2BFollowup;
}

// ---------------------------------------------------------------------------
// Sources + import batches
// ---------------------------------------------------------------------------

export async function listSources(activeOnly = true): Promise<B2BSource[]> {
  let q = b2bDb().from("b2b_sources").select("*");
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q.order("name");
  return unwrap<B2BSource>(data, error);
}

export async function listImportBatches(): Promise<B2BImportBatch[]> {
  const { data, error } = await b2bDb()
    .from("b2b_import_batches")
    .select("*")
    .order("created_at", { ascending: false });
  return unwrap<B2BImportBatch>(data, error);
}

export async function getImportBatch(id: string): Promise<B2BImportBatch | null> {
  const { data, error } = await b2bDb()
    .from("b2b_import_batches")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as B2BImportBatch) ?? null;
}

export type NewImportBatch = {
  source?: string | null;
  file_name?: string | null;
  uploaded_by: string;
  total_records: number;
  new_records: number;
  duplicate_records: number;
  invalid_records: number;
  assigned_records: number;
};

export async function createImportBatch(input: NewImportBatch): Promise<B2BImportBatch> {
  const { data, error } = await b2bDb()
    .from("b2b_import_batches")
    .insert(input)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as B2BImportBatch;
}

// ---------------------------------------------------------------------------
// Bulk import writers (used by the CSV import flow). Rows are inserted in
// chunks by the caller; these helpers do a single insert each.
// ---------------------------------------------------------------------------

/**
 * The firm/lead identity columns needed to detect duplicates against existing
 * data. Pulled once up front and fed to the pure dedupe logic in b2b-import.ts.
 */
export type DedupeRow = {
  firm_name?: string | null;
  phone?: string | null;
  alt_phone?: string | null;
  email?: string | null;
  website?: string | null;
  city?: string | null;
};

/** Existing ca_firms identity rows for duplicate detection. */
export async function listFirmDedupeRows(): Promise<DedupeRow[]> {
  const { data, error } = await b2bDb()
    .from("ca_firms")
    .select("firm_name, phone, alt_phone, email, website, city");
  return unwrap<DedupeRow>(data, error);
}

/**
 * Existing b2b_leads identity rows for duplicate detection. b2b_leads has no
 * firm_name column (that lives on ca_firms), so leads only contribute the
 * phone / alt_phone / email / website / city dedupe keys.
 */
export async function listLeadDedupeRows(): Promise<DedupeRow[]> {
  const { data, error } = await b2bDb()
    .from("b2b_leads")
    .select("phone, alt_phone, email, website, city");
  return unwrap<DedupeRow>(data, error);
}

/** Insert a chunk of ca_firms, returning the created rows. */
export async function bulkInsertFirms(rows: NewFirm[]): Promise<CaFirm[]> {
  if (rows.length === 0) return [];
  const { data, error } = await b2bDb().from("ca_firms").insert(rows).select("*");
  return unwrap<CaFirm>(data, error);
}

/** Insert a chunk of b2b_contacts. */
export async function bulkInsertContacts(rows: NewContact[]): Promise<B2BContact[]> {
  if (rows.length === 0) return [];
  const { data, error } = await b2bDb().from("b2b_contacts").insert(rows).select("*");
  return unwrap<B2BContact>(data, error);
}

export type NewB2BLeadRow = NewB2BLead & { import_batch_id?: string | null };

/** Insert a chunk of b2b_leads. */
export async function bulkInsertLeads(rows: NewB2BLeadRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await b2bDb().from("b2b_leads").insert(rows);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Profiles (for owner / assigned-to selectors and name lookups)
// ---------------------------------------------------------------------------

export type AssignableUser = { id: string; full_name: string | null; email: string | null };

export async function listAssignableUsers(): Promise<AssignableUser[]> {
  const { data, error } = await b2bDb()
    .from("profiles")
    .select("id, full_name, email")
    .order("full_name");
  return unwrap<AssignableUser>(data, error);
}
