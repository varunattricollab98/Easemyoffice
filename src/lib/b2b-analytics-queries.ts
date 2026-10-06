// Data fetching for the B2B Dashboard + Analytics screens.
//
// One bundle of raw B2B rows (leads, activities, referrals, firms, follow-ups,
// linked-booking revenue) pulled through b2bDb() — the `supabase as any` escape
// hatch — then handed to the pure aggregation in src/lib/b2b-analytics.ts. RLS
// on the B2B tables is the real boundary: a b2b user only ever gets their own
// rows back, an admin gets everything, so no manual scoping is needed here.
//
// Kept out of b2b-queries.ts (which is already large and shared by every B2B
// page) so the dashboard/analytics route chunks pull in only what they need and
// recharts stays out of the entry chunk.

import { queryOptions } from "@tanstack/react-query";
import { b2bDb } from "@/lib/b2b";
import type {
  AnalyticsActivity,
  AnalyticsBooking,
  AnalyticsFirm,
  AnalyticsFollowup,
  AnalyticsLead,
  AnalyticsReferral,
} from "@/lib/b2b-analytics";
import { bookingValue } from "@/lib/b2b-analytics";

const ROW_LIMIT = 5000;

/** Everything the dashboard + analytics screens aggregate, fetched once. */
export type B2BAnalyticsData = {
  leads: AnalyticsLead[];
  activities: AnalyticsActivity[];
  referrals: AnalyticsReferral[];
  firms: AnalyticsFirm[];
  followups: AnalyticsFollowup[];
  /** booking id -> revenue (amount_after_tds || total_amount) for linked referrals. */
  bookingRevenue: Map<string, number>;
};

async function fetchAnalyticsData(): Promise<B2BAnalyticsData> {
  const db = b2bDb();
  const [leadsRes, activitiesRes, referralsRes, firmsRes, followupsRes] = await Promise.all([
    db
      .from("b2b_leads")
      .select(
        "id, firm_id, assigned_to, lead_status, lead_source, city, state, firm_type, created_at, last_contacted_at",
      )
      .limit(ROW_LIMIT),
    db
      .from("b2b_activities")
      .select("firm_id, lead_id, type, created_by, happened_at")
      .limit(ROW_LIMIT),
    db
      .from("referrals")
      .select(
        "firm_id, assigned_salesperson, converted, booking_id, revenue, referral_date, date_received, created_at",
      )
      .limit(ROW_LIMIT),
    db
      .from("ca_firms")
      .select(
        "id, firm_name, assigned_to, partner_status, partner_since, lead_source, firm_type, city, state, created_at",
      )
      .limit(ROW_LIMIT),
    db.from("b2b_followups").select("assigned_to, status, due_at, completed_at").limit(ROW_LIMIT),
  ]);

  for (const res of [leadsRes, activitiesRes, referralsRes, firmsRes, followupsRes]) {
    if (res.error) throw new Error(res.error.message);
  }

  const leads = (leadsRes.data ?? []) as AnalyticsLead[];
  const activities = (activitiesRes.data ?? []) as AnalyticsActivity[];
  const referrals = (referralsRes.data ?? []) as AnalyticsReferral[];
  const firms = (firmsRes.data ?? []) as AnalyticsFirm[];
  const followups = (followupsRes.data ?? []) as AnalyticsFollowup[];

  // Read the revenue of only the bookings referrals actually link to, so the
  // money is the single source of truth (amount_after_tds || total_amount)
  // rather than whatever was snapshotted onto the referral row.
  const bookingIds = Array.from(
    new Set(referrals.map((r) => r.booking_id).filter((id): id is string => !!id)),
  );
  const bookingRevenue = new Map<string, number>();
  if (bookingIds.length > 0) {
    const bk = await db
      .from("bookings")
      .select("id, amount_after_tds, total_amount")
      .in("id", bookingIds);
    if (bk.error) throw new Error(bk.error.message);
    for (const b of (bk.data ?? []) as (AnalyticsBooking & { id: string })[]) {
      bookingRevenue.set(b.id, bookingValue(b));
    }
  }

  return { leads, activities, referrals, firms, followups, bookingRevenue };
}

/** TanStack query for the whole B2B analytics dataset. */
export const b2bAnalyticsQuery = () =>
  queryOptions({
    queryKey: ["b2b-analytics"] as const,
    staleTime: 60_000,
    queryFn: fetchAnalyticsData,
  });
