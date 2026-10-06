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
  type B2BOnboarding,
  type B2BSource,
  type CaFirm,
  type OnboardingItemId,
  type Partnership,
  type Referral,
} from "@/lib/b2b";
import { bookingRevenue } from "@/lib/report-metrics";
import {
  partnerPerformanceRows,
  type PartnerPerformanceRow,
  type PerfActivity,
  type PerfReferral,
} from "@/lib/b2b-performance";

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

/**
 * A partnership joined to its firm so the pipeline board can render the firm
 * name, location and owner on each card. RLS scopes which rows return.
 */
export type PartnershipWithFirm = Partnership & {
  firm_name: string | null;
  firm_city: string | null;
  firm_state: string | null;
};

export async function listPartnershipsWithFirm(): Promise<PartnershipWithFirm[]> {
  const { data, error } = await b2bDb()
    .from("partnerships")
    .select("*, ca_firms(firm_name, city, state)")
    .order("opened_at", { ascending: false });
  if (error) throw new Error(error.message);
  type Joined = Partnership & {
    ca_firms: { firm_name: string | null; city: string | null; state: string | null } | null;
  };
  return ((data ?? []) as Joined[]).map((r) => {
    const { ca_firms, ...rest } = r;
    return {
      ...rest,
      firm_name: ca_firms?.firm_name ?? null,
      firm_city: ca_firms?.city ?? null,
      firm_state: ca_firms?.state ?? null,
    };
  });
}

export type NewPartnership = {
  firm_id: string;
  stage?: string | null;
  status?: Partnership["status"];
  value?: number | null;
  assigned_to?: string | null;
  created_by: string;
};

export async function createPartnership(input: NewPartnership): Promise<Partnership> {
  const { data, error } = await b2bDb()
    .from("partnerships")
    .insert({ status: "open", ...input })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Partnership;
}

/**
 * Move a partnership to a new pipeline stage or a closed outcome. For a forward
 * stage move only partnerships.stage changes; for a lost/closed outcome the
 * caller passes status 'lost' (or 'won') plus a mandatory reason, which stamps
 * closed_at and outcome_reason. When the firm reaches a partnered stage the
 * caller may also pass firmPartnerStatus to refresh ca_firms.partner_status.
 * logAudit + the timeline activity are written by the caller.
 */
export async function updatePartnershipStage(input: {
  id: string;
  firmId: string;
  stage: string;
  status?: Partnership["status"];
  outcomeReason?: string | null;
  firmPartnerStatus?: string | null;
  closedAt?: string;
}): Promise<void> {
  const db = b2bDb();
  const patch: Record<string, unknown> = { stage: input.stage };
  if (input.status) {
    patch.status = input.status;
    if (input.status === "lost" || input.status === "won") {
      patch.closed_at = input.closedAt ?? new Date().toISOString();
      patch.outcome_reason = input.outcomeReason ?? null;
    } else {
      // Reopened into a forward stage.
      patch.closed_at = null;
      patch.outcome_reason = null;
    }
  }
  const upd = await db.from("partnerships").update(patch).eq("id", input.id);
  if (upd.error) throw new Error(upd.error.message);

  if (input.firmPartnerStatus !== undefined && input.firmPartnerStatus !== null) {
    const firmUpd = await db
      .from("ca_firms")
      .update({ partner_status: input.firmPartnerStatus })
      .eq("id", input.firmId);
    if (firmUpd.error) throw new Error(firmUpd.error.message);
  }
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

/**
 * A referral joined to its firm name and referring contact name so the
 * Referrals list can label and link each row back to the firm 360 and the
 * contact without a per-row query. RLS still scopes which rows return.
 */
export type ReferralWithRefs = Referral & {
  firm_name: string | null;
  referring_contact_name: string | null;
};

export async function listReferralsWithRefs(
  filters: ReferralFilters = {},
): Promise<ReferralWithRefs[]> {
  let q = b2bDb().from("referrals").select("*, ca_firms(firm_name), b2b_contacts(name)");
  if (filters.firmId) q = q.eq("firm_id", filters.firmId);
  if (filters.status) q = q.eq("referral_status", filters.status);
  if (filters.assignedSalesperson) q = q.eq("assigned_salesperson", filters.assignedSalesperson);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  type Joined = Referral & {
    ca_firms: { firm_name: string | null } | null;
    b2b_contacts: { name: string | null } | null;
  };
  return ((data ?? []) as Joined[]).map((r) => {
    const { ca_firms, b2b_contacts, ...rest } = r;
    return {
      ...rest,
      firm_name: ca_firms?.firm_name ?? null,
      referring_contact_name: b2b_contacts?.name ?? null,
    };
  });
}

export type NewReferral = {
  firm_id?: string | null;
  referring_contact_id?: string | null;
  referred_client_name?: string | null;
  client_phone?: string | null;
  date_received?: string | null;
  assigned_salesperson?: string | null;
  service_required?: string | null;
  referral_status?: Referral["referral_status"];
  referral_date?: string | null;
  notes?: string | null;
  created_by: string;
};

export async function createReferral(input: NewReferral): Promise<Referral> {
  const { data, error } = await b2bDb()
    .from("referrals")
    .insert({ referral_status: "new", ...input })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Referral;
}

export type ReferralPatch = Partial<Omit<NewReferral, "created_by">> & {
  converted?: boolean;
  converted_date?: string | null;
  lead_id?: string | null;
  booking_id?: string | null;
  booking_value?: number | null;
  revenue?: number | null;
};

export async function updateReferral(id: string, patch: ReferralPatch): Promise<Referral> {
  const { data, error } = await b2bDb()
    .from("referrals")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Referral;
}

/**
 * Push a referral into the existing Sales Leads system. This is additive
 * linking only — it inserts a brand new public.leads row (it never touches
 * existing leads or their RLS) carrying the referral's client name / phone /
 * service, stamps source = 'referral', and writes the new lead_id back onto the
 * referral along with referral_status = 'converted'. The leads insert reuses
 * the exact required column names the Sales import/forms use (client_name,
 * mobile, source, service_required) so it satisfies the live schema + RLS.
 * logAudit is left to the caller.
 */
export async function convertReferralToLead(input: {
  referral: Referral;
  clientName: string;
  mobile: string;
  serviceRequired: string;
  source: string;
  actorId: string;
}): Promise<{ leadId: string }> {
  const db = b2bDb();
  const { referral } = input;

  const leadInsert = await db
    .from("leads")
    .insert({
      client_name: input.clientName,
      mobile: input.mobile,
      source: input.source,
      service_required: input.serviceRequired,
      notes: `Referred by B2B partner${referral.referral_code ? ` (${referral.referral_code})` : ""}.`,
      created_by: input.actorId,
    })
    .select("id")
    .single();
  if (leadInsert.error) throw new Error(leadInsert.error.message);
  const leadId = (leadInsert.data as { id: string }).id;

  const now = new Date().toISOString().slice(0, 10);
  const upd = await db
    .from("referrals")
    .update({
      lead_id: leadId,
      referral_status: "converted",
      converted: true,
      converted_date: referral.converted_date ?? now,
    })
    .eq("id", referral.id);
  if (upd.error) throw new Error(upd.error.message);

  return { leadId };
}

/**
 * The minimal booking fields the referral "link booking" picker needs: enough
 * to list and search bookings and to read the revenue (amount_after_tds, with
 * total_amount as the fallback — see src/lib/report-metrics.ts bookingRevenue).
 */
export type LinkableBooking = {
  id: string;
  booking_code: string | null;
  client_name: string | null;
  booking_date: string | null;
  amount_after_tds: number | string | null;
  total_amount: number | string | null;
};

/**
 * Recent bookings for the "link to booking" picker. Reads only — this never
 * mutates a booking, so existing Sales/booking behaviour is untouched. RLS on
 * public.bookings scopes which rows return.
 */
export async function listLinkableBookings(search?: string): Promise<LinkableBooking[]> {
  let q = b2bDb()
    .from("bookings")
    .select("id, booking_code, client_name, booking_date, amount_after_tds, total_amount");
  if (search) q = q.ilike("client_name", `%${search}%`);
  const { data, error } = await q.order("booking_date", { ascending: false }).limit(50);
  return unwrap<LinkableBooking>(data, error);
}

/**
 * Attach a booking to a referral and capture its value + revenue. Additive: it
 * only writes booking_id / booking_value / revenue (and flips converted) on the
 * referral row; the booking itself is never modified. The caller passes the
 * revenue it read via bookingRevenue() so the money math stays in one place.
 */
export async function linkReferralBooking(input: {
  referralId: string;
  bookingId: string;
  bookingValue: number;
  revenue: number;
  convertedDate?: string | null;
}): Promise<Referral> {
  const now = new Date().toISOString().slice(0, 10);
  const { data, error } = await b2bDb()
    .from("referrals")
    .update({
      booking_id: input.bookingId,
      booking_value: input.bookingValue,
      revenue: input.revenue,
      converted: true,
      referral_status: "converted",
      converted_date: input.convertedDate ?? now,
    })
    .eq("id", input.referralId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Referral;
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

/**
 * Activity row joined to the firm name and lead contact, so the Calls /
 * Meetings / Activity History feeds can label and link each row back to its
 * firm or lead without a per-row query. RLS still scopes which rows return.
 */
export type ActivityWithRefs = B2BActivity & {
  firm_name: string | null;
  lead_contact: string | null;
};

export type ActivityFeedFilters = {
  type?: B2BActivity["type"];
  firmId?: string;
  leadId?: string;
  createdBy?: string;
  /** Inclusive lower bound on happened_at (ISO string). */
  from?: string;
  /** Exclusive upper bound on happened_at (ISO string). */
  to?: string;
  limit?: number;
};

/**
 * Chronological activity feed across firms/leads (most recent first), filtered
 * by type / firm / lead / creator / date range. Used by the Calls, Meetings and
 * Activity History screens.
 */
export async function listActivityFeed(
  filters: ActivityFeedFilters = {},
): Promise<ActivityWithRefs[]> {
  let q = b2bDb()
    .from("b2b_activities")
    .select("*, ca_firms(firm_name), b2b_leads(contact_person)");
  if (filters.type) q = q.eq("type", filters.type);
  if (filters.firmId) q = q.eq("firm_id", filters.firmId);
  if (filters.leadId) q = q.eq("lead_id", filters.leadId);
  if (filters.createdBy) q = q.eq("created_by", filters.createdBy);
  if (filters.from) q = q.gte("happened_at", filters.from);
  if (filters.to) q = q.lt("happened_at", filters.to);
  q = q.order("happened_at", { ascending: false }).limit(filters.limit ?? 500);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  type Joined = B2BActivity & {
    ca_firms: { firm_name: string | null } | null;
    b2b_leads: { contact_person: string | null } | null;
  };
  return ((data ?? []) as Joined[]).map((r) => {
    const { ca_firms, b2b_leads, ...rest } = r;
    return {
      ...rest,
      firm_name: ca_firms?.firm_name ?? null,
      lead_contact: b2b_leads?.contact_person ?? null,
    };
  });
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

/**
 * A follow-up joined to its firm name and lead contact so the Follow-ups page
 * and My Tasks can label and link each row without a per-row lookup.
 */
export type FollowupWithRefs = B2BFollowup & {
  firm_name: string | null;
  lead_contact: string | null;
};

export async function listFollowupsWithRefs(
  scope: FollowupScope = {},
): Promise<FollowupWithRefs[]> {
  let q = b2bDb().from("b2b_followups").select("*, ca_firms(firm_name), b2b_leads(contact_person)");
  if (scope.assignedTo) q = q.eq("assigned_to", scope.assignedTo);
  if (scope.leadId) q = q.eq("lead_id", scope.leadId);
  if (scope.firmId) q = q.eq("firm_id", scope.firmId);
  if (scope.status) q = q.eq("status", scope.status);
  const { data, error } = await q.order("due_at");
  if (error) throw new Error(error.message);
  type Joined = B2BFollowup & {
    ca_firms: { firm_name: string | null } | null;
    b2b_leads: { contact_person: string | null } | null;
  };
  return ((data ?? []) as Joined[]).map((r) => {
    const { ca_firms, b2b_leads, ...rest } = r;
    return {
      ...rest,
      firm_name: ca_firms?.firm_name ?? null,
      lead_contact: b2b_leads?.contact_person ?? null,
    };
  });
}

export type NewFollowup = {
  lead_id?: string | null;
  firm_id?: string | null;
  due_at: string;
  remark?: string | null;
  assigned_to?: string | null;
  created_by: string;
};

export async function createFollowup(input: NewFollowup): Promise<B2BFollowup> {
  const { data, error } = await b2bDb()
    .from("b2b_followups")
    .insert({ ...input, status: "pending" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as B2BFollowup;
}

/**
 * Complete a follow-up inline from the list and (optionally) schedule the next
 * one, without opening the firm page. This performs the full workflow from spec
 * section 10 as a sequence of small writes (no RPC available; RLS scopes every
 * row to the owner):
 *   1. mark THIS follow-up done + stamp completed_at + save its remark;
 *   2. bump the related lead's follow_up_count and refresh
 *      last_contacted_at / next_follow_up_at / latest_remark;
 *   3. write a b2b_activities row of type 'followup' for the timeline;
 *   4. if a next date is given, create the next pending follow-up.
 * logAudit is left to the caller (it needs the actor and is fire-and-forget).
 */
export async function completeFollowup(input: {
  followup: B2BFollowup;
  remark: string | null;
  nextDueAt: string | null;
  outcome?: string | null;
  actorId: string;
  completedAt?: string;
}): Promise<void> {
  const db = b2bDb();
  const now = input.completedAt ?? new Date().toISOString();
  const { followup } = input;

  const done = await db
    .from("b2b_followups")
    .update({ status: "done", completed_at: now, remark: input.remark })
    .eq("id", followup.id);
  if (done.error) throw new Error(done.error.message);

  // Refresh the related lead's follow-up fields and increment the counter.
  if (followup.lead_id) {
    const existing = await db
      .from("b2b_leads")
      .select("follow_up_count")
      .eq("id", followup.lead_id)
      .maybeSingle();
    const current = Number(
      (existing.data as { follow_up_count?: number } | null)?.follow_up_count ?? 0,
    );
    const leadPatch: Record<string, unknown> = {
      last_contacted_at: now,
      next_follow_up_at: input.nextDueAt,
      follow_up_count: current + 1,
    };
    if (input.remark) leadPatch.latest_remark = input.remark;
    const upd = await db.from("b2b_leads").update(leadPatch).eq("id", followup.lead_id);
    if (upd.error) throw new Error(upd.error.message);
  }

  // Keep the firm's last-contact fresh too (firms carry no follow_up_count).
  if (followup.firm_id) {
    const upd = await db.from("ca_firms").update({ updated_at: now }).eq("id", followup.firm_id);
    if (upd.error) throw new Error(upd.error.message);
  }

  // Timeline entry.
  const act = await db.from("b2b_activities").insert({
    type: "followup",
    firm_id: followup.firm_id,
    lead_id: followup.lead_id,
    subject: "Follow-up completed",
    notes: input.remark,
    outcome: input.outcome ?? null,
    happened_at: now,
    created_by: input.actorId,
  });
  if (act.error) throw new Error(act.error.message);

  // Schedule the next follow-up if the user picked a date.
  if (input.nextDueAt) {
    const next = await db.from("b2b_followups").insert({
      lead_id: followup.lead_id,
      firm_id: followup.firm_id,
      due_at: input.nextDueAt,
      status: "pending",
      remark: input.remark,
      assigned_to: followup.assigned_to ?? input.actorId,
      created_by: input.actorId,
    });
    if (next.error) throw new Error(next.error.message);
  }
}

// ---------------------------------------------------------------------------
// Partner onboarding checklists (B2B Documentation)
//
// One b2b_onboarding row per CA firm. RLS (20260517000003) scopes which rows
// return exactly like the other B2B tables: admin sees all; a B2B user sees
// only checklists for firms they own / are assigned / created. The pure
// progress / TAT maths lives in src/lib/b2b-documentation.ts.
// ---------------------------------------------------------------------------

/** An onboarding checklist joined to its firm name so the list can label rows. */
export type OnboardingWithFirm = B2BOnboarding & {
  firm_name: string | null;
  firm_city: string | null;
  firm_state: string | null;
};

export async function listOnboarding(): Promise<OnboardingWithFirm[]> {
  const { data, error } = await b2bDb()
    .from("b2b_onboarding")
    .select("*, ca_firms(firm_name, city, state)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  type Joined = B2BOnboarding & {
    ca_firms: { firm_name: string | null; city: string | null; state: string | null } | null;
  };
  return ((data ?? []) as Joined[]).map((r) => {
    const { ca_firms, ...rest } = r;
    return {
      ...rest,
      firm_name: ca_firms?.firm_name ?? null,
      firm_city: ca_firms?.city ?? null,
      firm_state: ca_firms?.state ?? null,
    };
  });
}

export async function getOnboardingForFirm(firmId: string): Promise<B2BOnboarding | null> {
  const { data, error } = await b2bDb()
    .from("b2b_onboarding")
    .select("*")
    .eq("firm_id", firmId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as B2BOnboarding) ?? null;
}

/**
 * Create the onboarding checklist for a firm, or return the existing one. The
 * UNIQUE (firm_id) constraint plus RLS keep this a single checklist per firm.
 */
export async function ensureOnboarding(input: {
  firmId: string;
  actorId: string;
}): Promise<B2BOnboarding> {
  const existing = await getOnboardingForFirm(input.firmId);
  if (existing) return existing;
  const { data, error } = await b2bDb()
    .from("b2b_onboarding")
    .insert({ firm_id: input.firmId, created_by: input.actorId, assigned_to: input.actorId })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as B2BOnboarding;
}

export type OnboardingPatch = Partial<Record<OnboardingItemId, boolean>> & {
  notes?: string | null;
  assigned_to?: string | null;
};

/**
 * Toggle checklist items / notes on an onboarding row. completed_at is stamped
 * server-side by the b2b_onboarding_stamp_completed trigger, so the UI never
 * has to manage it.
 */
export async function updateOnboarding(id: string, patch: OnboardingPatch): Promise<B2BOnboarding> {
  const { data, error } = await b2bDb()
    .from("b2b_onboarding")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as B2BOnboarding;
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

// ---------------------------------------------------------------------------
// Partner performance — the live roll-up behind the Partner Performance and
// Active Partners pages. The pure aggregation (totals, last-activity dates,
// score, health) lives in src/lib/b2b-performance.ts and is unit-tested; this
// helper only fetches the raw firms / referrals / activities / booking dates
// and feeds them in.
// ---------------------------------------------------------------------------

export async function listPartnerPerformance(): Promise<PartnerPerformanceRow[]> {
  const db = b2bDb();
  const [firmsRes, referralsRes, activitiesRes] = await Promise.all([
    db.from("ca_firms").select("id, firm_name, partner_status, assigned_to, city, state"),
    db
      .from("referrals")
      .select("firm_id, converted, booking_id, revenue, date_received, referral_date, created_at"),
    db.from("b2b_activities").select("firm_id, happened_at"),
  ]);
  if (firmsRes.error) throw new Error(firmsRes.error.message);
  if (referralsRes.error) throw new Error(referralsRes.error.message);
  if (activitiesRes.error) throw new Error(activitiesRes.error.message);

  const firms = (firmsRes.data ?? []) as {
    id: string;
    firm_name: string;
    partner_status: string | null;
    assigned_to: string | null;
    city: string | null;
    state: string | null;
  }[];
  const referrals = (referralsRes.data ?? []) as PerfReferral[];
  const activities = (activitiesRes.data ?? []) as PerfActivity[];

  // Fetch the dates of only the bookings that referrals actually link to, so a
  // converted referral contributes to the firm's "last booking".
  const bookingIds = Array.from(
    new Set(referrals.map((r) => r.booking_id).filter((id): id is string => !!id)),
  );
  const bookingDates = new Map<string, string | null>();
  if (bookingIds.length > 0) {
    const bk = await db.from("bookings").select("id, booking_date").in("id", bookingIds);
    if (bk.error) throw new Error(bk.error.message);
    for (const b of (bk.data ?? []) as { id: string; booking_date: string | null }[]) {
      bookingDates.set(b.id, b.booking_date);
    }
  }

  return partnerPerformanceRows({ firms, referrals, activities, bookingDates });
}

// Re-exported so callers can read a booking's revenue with the single source of
// truth (amount_after_tds, falling back to total_amount) when linking.
export { bookingRevenue };
