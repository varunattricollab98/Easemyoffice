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

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export type B2BLeadFilters = {
  assignedTo?: string;
  status?: string;
  firmId?: string;
  search?: string;
};

export async function listB2BLeads(filters: B2BLeadFilters = {}): Promise<B2BLead[]> {
  let q = b2bDb().from("b2b_leads").select("*");
  if (filters.assignedTo) q = q.eq("assigned_to", filters.assignedTo);
  if (filters.status) q = q.eq("lead_status", filters.status);
  if (filters.firmId) q = q.eq("firm_id", filters.firmId);
  if (filters.search) q = q.ilike("contact_person", `%${filters.search}%`);
  const { data, error } = await q.order("created_at", { ascending: false });
  return unwrap<B2BLead>(data, error);
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
