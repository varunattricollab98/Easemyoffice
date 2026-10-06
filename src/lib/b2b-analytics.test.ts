import { describe, it, expect } from "vitest";
import {
  buildFunnel,
  contactRate,
  responseRate,
  activityBreakdown,
  sourceRollups,
  employeeLeaderboard,
  revenuePerPartner,
  partnerHealthDistribution,
  monthlyTrend,
  bookingValue,
  pct,
  type AnalyticsLead,
} from "./b2b-analytics";

// A lead at a given status, defaulting the rest.
const lead = (status: string, extra: Partial<AnalyticsLead> = {}): AnalyticsLead => ({
  lead_status: status,
  ...extra,
});

describe("pct", () => {
  it("rounds and guards divide-by-zero", () => {
    expect(pct(1, 2)).toBe(50);
    expect(pct(1, 3)).toBe(33);
    expect(pct(5, 0)).toBe(0);
  });
});

describe("bookingValue", () => {
  it("prefers amount_after_tds, falls back to total, parses strings", () => {
    expect(bookingValue({ amount_after_tds: 900, total_amount: 1000 })).toBe(900);
    expect(bookingValue({ amount_after_tds: 0, total_amount: 1000 })).toBe(1000);
    expect(bookingValue({ amount_after_tds: "750" })).toBe(750);
    expect(bookingValue({})).toBe(0);
  });
});

describe("buildFunnel", () => {
  it("returns all 10 forward stages in order", () => {
    const f = buildFunnel([]);
    expect(f).toHaveLength(10);
    expect(f[0].id).toBe("new_prospect");
    expect(f[9].id).toBe("active_partner");
    expect(f.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("counts a lead at every stage up to and including its current stage", () => {
    // One lead sitting at 'interested' (order 5) is counted in stages 1..5.
    const f = buildFunnel([lead("interested")]);
    expect(f[0].count).toBe(1); // new_prospect
    expect(f[4].count).toBe(1); // interested
    expect(f[5].count).toBe(0); // meeting_discussion
    expect(f[9].count).toBe(0); // active_partner
  });

  it("computes conversion % from the top of the funnel and from the previous stage", () => {
    // 4 at new_prospect, 2 reach 'contacted' (order 4), 1 reaches 'active_partner'.
    const leads = [
      lead("new_prospect"),
      lead("data_verified"),
      lead("contacted"),
      lead("active_partner"),
    ];
    const f = buildFunnel(leads);
    expect(f[0].count).toBe(4); // all 4
    expect(f[0].conversionFromTop).toBe(100);
    // contacted (order 4): the 'contacted' lead + the 'active_partner' lead = 2
    expect(f[3].count).toBe(2);
    expect(f[3].conversionFromTop).toBe(50); // 2/4
    // active_partner (order 10): only the one lead = 1 -> 25% of top
    expect(f[9].count).toBe(1);
    expect(f[9].conversionFromTop).toBe(25);
  });

  it("conversionFromPrev reflects the step-to-step drop", () => {
    // 2 at contacted (order4), 1 at interested (order5) => prev-conversion 50%.
    const f = buildFunnel([lead("contacted"), lead("interested")]);
    expect(f[3].count).toBe(2); // contacted
    expect(f[4].count).toBe(1); // interested
    expect(f[4].conversionFromPrev).toBe(50);
  });

  it("excludes closed/lost outcomes from every funnel bar", () => {
    // A dead lead (not_interested, order 0) contributes to nothing.
    const f = buildFunnel([lead("not_interested"), lead("lost"), lead("no_response")]);
    expect(f.every((s) => s.count === 0)).toBe(true);
  });
});

describe("contactRate / responseRate", () => {
  it("contact rate counts leads at/past 'contacted' or with a last_contacted_at", () => {
    const leads = [
      lead("new_prospect"), // not contacted
      lead("contacted"), // contacted
      lead("new_prospect", { last_contacted_at: "2026-01-01" }), // nudged
      lead("interested"), // contacted + responded
    ];
    const c = contactRate(leads);
    expect(c.total).toBe(4);
    expect(c.contacted).toBe(3);
    expect(c.rate).toBe(75);
  });

  it("response rate is responders ÷ contacted", () => {
    const leads = [
      lead("contacted"),
      lead("contacted"),
      lead("interested"),
      lead("meeting_discussion"),
    ];
    const r = responseRate(leads);
    expect(r.contacted).toBe(4);
    expect(r.responded).toBe(2); // interested + meeting_discussion
    expect(r.rate).toBe(50);
  });
});

describe("activityBreakdown", () => {
  it("tallies activities by type", () => {
    const b = activityBreakdown([
      { type: "call" },
      { type: "call" },
      { type: "whatsapp" },
      { type: "email" },
      { type: "meeting" },
      { type: "note" },
    ]);
    expect(b.calls).toBe(2);
    expect(b.whatsapp).toBe(1);
    expect(b.emails).toBe(1);
    expect(b.meetings).toBe(1);
  });

  it("counts overdue follow-ups against now and completed from the table", () => {
    const now = new Date("2026-09-16T00:00:00.000Z").getTime();
    const b = activityBreakdown(
      [{ type: "followup" }],
      [
        { status: "done" },
        { status: "done" },
        { status: "pending", due_at: "2026-09-10T00:00:00.000Z" }, // overdue
        { status: "pending", due_at: "2026-09-20T00:00:00.000Z" }, // future
      ],
      now,
    );
    // Table supplied => completed comes from the table (2), not the activity row.
    expect(b.followupsCompleted).toBe(2);
    expect(b.overdueFollowups).toBe(1);
  });

  it("falls back to 'followup' activity rows when no follow-up table is passed", () => {
    const b = activityBreakdown([{ type: "followup" }, { type: "followup" }]);
    expect(b.followupsCompleted).toBe(2);
    expect(b.overdueFollowups).toBe(0);
  });
});

describe("sourceRollups", () => {
  const sources = [
    { id: "google", label: "Google" },
    { id: "referral", label: "Referral" },
  ];

  it("creates a bucket for every configured source, even with zero activity", () => {
    const rows = sourceRollups({ sources, leads: [], firms: [], referrals: [] });
    const ids = rows.map((r) => r.source).sort();
    expect(ids).toEqual(["google", "referral"]);
  });

  it("rolls up the per-source funnel through to bookings and revenue", () => {
    const firms = [{ id: "f1", lead_source: "google" }];
    const leads = [
      { lead_source: "google", lead_status: "contacted" },
      { lead_source: "google", lead_status: "interested" },
      { lead_source: "referral", lead_status: "new_prospect" },
    ];
    const referrals = [
      { firm_id: "f1", booking_id: "bk1", revenue: 5000 },
      { firm_id: "f1", booking_id: null, revenue: 0 },
    ];
    const rows = sourceRollups({ sources, leads, firms, referrals });
    const g = rows.find((r) => r.source === "google")!;
    expect(g.prospects).toBe(2);
    expect(g.contacted).toBe(2); // contacted + interested are both >= contacted
    expect(g.interested).toBe(1);
    expect(g.referrals).toBe(2);
    expect(g.bookings).toBe(1);
    expect(g.revenue).toBe(5000);
    const r = rows.find((r) => r.source === "referral")!;
    expect(r.prospects).toBe(1);
    expect(r.bookings).toBe(0);
  });

  it("buckets rows with an unknown source into 'unknown'", () => {
    const rows = sourceRollups({
      sources,
      leads: [{ lead_source: "linkedin", lead_status: "new_prospect" }],
      firms: [],
      referrals: [],
    });
    const unknown = rows.find((r) => r.source === "unknown")!;
    expect(unknown.prospects).toBe(1);
    expect(unknown.label).toBe("Unknown");
  });

  it("prefers the booking revenue map over the stored referral revenue", () => {
    const firms = [{ id: "f1", lead_source: "google" }];
    const referrals = [{ firm_id: "f1", booking_id: "bk1", revenue: 1000 }];
    const rows = sourceRollups({
      sources,
      leads: [],
      firms,
      referrals,
      bookingRevenue: new Map([["bk1", 7777]]),
    });
    expect(rows.find((r) => r.source === "google")!.revenue).toBe(7777);
  });
});

describe("employeeLeaderboard", () => {
  it("aggregates every per-employee column and sorts by revenue", () => {
    const rows = employeeLeaderboard({
      leads: [
        { assigned_to: "e1", lead_status: "contacted" },
        { assigned_to: "e1", lead_status: "new_prospect" },
        { assigned_to: "e2", lead_status: "interested" },
      ],
      activities: [
        { created_by: "e1", type: "call" },
        { created_by: "e1", type: "meeting" },
        { created_by: "e2", type: "followup" },
      ],
      referrals: [
        { assigned_salesperson: "e2", booking_id: "bk1", revenue: 9000 },
        { assigned_salesperson: "e1", booking_id: null, revenue: 0 },
      ],
      firms: [
        { assigned_to: "e1", partner_status: "active" },
        { assigned_to: "e2", partner_status: "lost" }, // not a partnered status
      ],
    });
    const e1 = rows.find((r) => r.employeeId === "e1")!;
    const e2 = rows.find((r) => r.employeeId === "e2")!;
    expect(e1.prospectsAssigned).toBe(2);
    expect(e1.prospectsContacted).toBe(1);
    expect(e1.calls).toBe(1);
    expect(e1.meetings).toBe(1);
    expect(e1.partnersOnboarded).toBe(1);
    expect(e1.referrals).toBe(1);
    expect(e2.referrals).toBe(1);
    expect(e2.bookings).toBe(1);
    expect(e2.revenue).toBe(9000);
    expect(e2.partnersOnboarded).toBe(0);
    // e2 has the revenue, so it sorts first.
    expect(rows[0].employeeId).toBe("e2");
  });
});

describe("revenuePerPartner", () => {
  it("divides total referral revenue by active partner firms", () => {
    const result = revenuePerPartner({
      firms: [
        { partner_status: "active" },
        { partner_status: "strategic" },
        { partner_status: "potential" }, // not "active" for this metric
        { partner_status: null },
      ],
      referrals: [
        { booking_id: "bk1", revenue: 10000 },
        { booking_id: null, revenue: 2000 },
      ],
    });
    expect(result.activePartners).toBe(2);
    expect(result.totalRevenue).toBe(12000);
    expect(result.revenuePerPartner).toBe(6000);
  });

  it("returns zero per-partner when there are no active partners", () => {
    const result = revenuePerPartner({
      firms: [{ partner_status: "dormant" }],
      referrals: [{ booking_id: null, revenue: 5000 }],
    });
    expect(result.activePartners).toBe(0);
    expect(result.revenuePerPartner).toBe(0);
  });
});

describe("partnerHealthDistribution", () => {
  it("counts firms by partner_status across the health categories", () => {
    const slices = partnerHealthDistribution([
      { partner_status: "active" },
      { partner_status: "active" },
      { partner_status: "dormant" },
      { partner_status: null },
    ]);
    expect(slices.find((s) => s.id === "active")!.count).toBe(2);
    expect(slices.find((s) => s.id === "dormant")!.count).toBe(1);
    expect(slices.find((s) => s.id === "lost")!.count).toBe(0);
  });
});

describe("monthlyTrend", () => {
  it("buckets rows by YYYY-MM and sums revenue, sorted ascending", () => {
    const rows = [
      { created_at: "2026-01-05", rev: 100 },
      { created_at: "2026-01-20", rev: 200 },
      { created_at: "2026-02-02", rev: 50 },
    ];
    const trend = monthlyTrend(
      rows,
      (r) => r.created_at,
      (r) => r.rev,
    );
    expect(trend).toHaveLength(2);
    expect(trend[0]).toMatchObject({ month: "2026-01", count: 2, revenue: 300 });
    expect(trend[1]).toMatchObject({ month: "2026-02", count: 1, revenue: 50 });
  });

  it("skips rows without a parseable date", () => {
    const trend = monthlyTrend([{ d: null }, { d: "nonsense" }], (r) => r.d);
    expect(trend).toHaveLength(0);
  });
});
