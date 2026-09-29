import { describe, it, expect } from "vitest";
import {
  buildReport,
  bookingRevenue,
  isQuotationActivity,
  PRODUCTIVITY_WEIGHTS,
} from "./report-metrics";
import { resolvePeriod } from "./report-period";

const NOW = new Date("2026-09-16T14:30:00.000Z");
const PERIOD = resolvePeriod("this_month", { now: NOW });

const profiles = [
  { id: "u1", full_name: "Asha", email: "asha@emo.in" },
  { id: "u2", full_name: "Vikram", email: "vikram@emo.in" },
];

const empty = {
  leads: [],
  bookings: [],
  activities: [],
  followUps: [],
  profiles,
  period: PERIOD,
  now: NOW,
};

describe("bookingRevenue", () => {
  it("prefers amount_after_tds", () => {
    expect(bookingRevenue({ amount_after_tds: 900, total_amount: 1000 })).toBe(900);
  });

  it("falls back to total_amount when TDS was never computed", () => {
    expect(bookingRevenue({ amount_after_tds: 0, total_amount: 1000 })).toBe(1000);
    expect(bookingRevenue({ amount_after_tds: null, total_amount: 1000 })).toBe(1000);
  });

  it("parses numeric strings and tolerates junk", () => {
    expect(bookingRevenue({ amount_after_tds: "750" })).toBe(750);
    expect(bookingRevenue({ amount_after_tds: "abc", total_amount: null })).toBe(0);
    expect(bookingRevenue({})).toBe(0);
  });
});

describe("isQuotationActivity", () => {
  it("matches the structured payload marker", () => {
    expect(isQuotationActivity({ type: "email", payload: { kind: "quotation" } })).toBe(true);
  });

  it("falls back to the legacy title for rows written before the marker existed", () => {
    expect(isQuotationActivity({ type: "email", title: "Sent quotation to a@b.com" })).toBe(true);
  });

  it("ignores ordinary emails", () => {
    expect(isQuotationActivity({ type: "email", title: "Emailed a@b.com" })).toBe(false);
  });

  it("never matches a non-email activity", () => {
    // A call whose notes happen to mention a quotation must not be counted.
    expect(isQuotationActivity({ type: "call", title: "Sent quotation to a@b.com" })).toBe(false);
  });
});

describe("buildReport — attribution", () => {
  it("credits a booking via sales_agent_id", () => {
    const r = buildReport({
      ...empty,
      bookings: [
        { id: "b1", sales_agent_id: "u1", booking_date: "2026-09-10", amount_after_tds: 1000 },
      ],
    });
    expect(r.agents.find((a) => a.id === "u1")?.closures).toBe(1);
  });

  it("recovers the owner from sales_agent_name when the id is missing", () => {
    // sales_agent_id is nullable and has no FK, so name-matching is the only way
    // to avoid dropping the row.
    const r = buildReport({
      ...empty,
      bookings: [
        { id: "b1", sales_agent_name: "Vikram", booking_date: "2026-09-10", total_amount: 500 },
      ],
    });
    expect(r.agents.find((a) => a.id === "u2")?.closures).toBe(1);
  });

  it("still counts an unattributable booking in the team total", () => {
    const r = buildReport({
      ...empty,
      bookings: [
        { id: "b1", sales_agent_name: "Ghost", booking_date: "2026-09-10", total_amount: 400 },
      ],
    });
    expect(r.agents).toHaveLength(0);
    expect(r.team.closures).toBe(1);
    expect(r.team.revenue).toBe(400);
  });

  it("resolves display names, falling back to email", () => {
    const r = buildReport({
      ...empty,
      profiles: [{ id: "u3", full_name: null, email: "solo@emo.in" }],
      leads: [{ id: "l1", assigned_to: "u3", stage: "new_lead" }],
    });
    expect(r.agents[0].name).toBe("solo@emo.in");
  });
});

describe("buildReport — derived metrics", () => {
  it("computes conversion, avg deal and separates collected from revenue", () => {
    const r = buildReport({
      ...empty,
      leads: [
        { id: "l1", assigned_to: "u1", stage: "new_lead" },
        { id: "l2", assigned_to: "u1", stage: "contacted" },
        { id: "l3", assigned_to: "u1", stage: "lost" },
        { id: "l4", assigned_to: "u1", stage: "new_lead" },
      ],
      bookings: [
        {
          id: "b1",
          sales_agent_id: "u1",
          booking_date: "2026-09-02",
          amount_after_tds: 1000,
          amount_received: 400,
        },
        {
          id: "b2",
          sales_agent_id: "u1",
          booking_date: "2026-09-03",
          amount_after_tds: 3000,
          amount_received: 3000,
        },
      ],
    });
    const a = r.agents[0];
    expect(a.leadsAssigned).toBe(4);
    expect(a.closures).toBe(2);
    expect(a.conversionPct).toBe(50);
    expect(a.revenue).toBe(4000);
    // A partial payment is still a closed sale, so collected lags revenue.
    expect(a.collected).toBe(3400);
    expect(a.avgDeal).toBe(2000);
    expect(a.lost).toBe(1);
  });

  it("counts calls, whatsapp and quotations without double-counting emails", () => {
    const r = buildReport({
      ...empty,
      activities: [
        { actor_id: "u1", type: "call" },
        { actor_id: "u1", type: "call" },
        { actor_id: "u1", type: "whatsapp" },
        { actor_id: "u1", type: "email", payload: { kind: "quotation" } },
        { actor_id: "u1", type: "email", title: "Emailed x@y.com" },
        { actor_id: "u1", type: "note" },
      ],
    });
    const a = r.agents[0];
    expect(a.calls).toBe(2);
    expect(a.whatsapp).toBe(1);
    expect(a.quotations).toBe(1);
    expect(a.emails).toBe(2);
    // activity = calls + whatsapp + quotations; plain emails and notes excluded.
    expect(a.activity).toBe(4);
  });

  it("scores follow-up discipline as done over done-plus-overdue", () => {
    const r = buildReport({
      ...empty,
      followUps: [
        { owner_id: "u1", status: "done", completed_at: "2026-09-05T10:00:00Z" },
        { owner_id: "u1", status: "done", completed_at: "2026-09-06T10:00:00Z" },
        { owner_id: "u1", status: "done", completed_at: "2026-09-07T10:00:00Z" },
        { owner_id: "u1", status: "pending", due_at: "2026-09-01T10:00:00Z" },
      ],
    });
    const a = r.agents[0];
    expect(a.followupsDone).toBe(3);
    expect(a.followupsOverdue).toBe(1);
    expect(a.disciplinePct).toBe(75);
  });

  it("does not count a pending follow-up that is not yet due as overdue", () => {
    const r = buildReport({
      ...empty,
      followUps: [{ owner_id: "u1", status: "pending", due_at: "2026-12-01T10:00:00Z" }],
    });
    expect(r.agents[0].followupsOverdue).toBe(0);
  });

  it("counts only bookings carrying lead_id as linked closures", () => {
    const r = buildReport({
      ...empty,
      bookings: [
        {
          id: "b1",
          sales_agent_id: "u1",
          booking_date: "2026-09-02",
          lead_id: "l1",
          total_amount: 100,
        },
        { id: "b2", sales_agent_id: "u1", booking_date: "2026-09-03", total_amount: 100 },
      ],
    });
    expect(r.agents[0].closures).toBe(2);
    expect(r.agents[0].linkedClosures).toBe(1);
    expect(r.team.linkedClosures).toBe(1);
  });
});

describe("buildReport — productivity index", () => {
  it("weights are declared and sum to 1", () => {
    const total = Object.values(PRODUCTIVITY_WEIGHTS).reduce((s, w) => s + w, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("scores the top performer near 100 and ranks by index", () => {
    const r = buildReport({
      ...empty,
      leads: [
        { id: "l1", assigned_to: "u1", stage: "new_lead" },
        { id: "l2", assigned_to: "u2", stage: "new_lead" },
      ],
      bookings: [
        { id: "b1", sales_agent_id: "u1", booking_date: "2026-09-02", amount_after_tds: 10000 },
        { id: "b2", sales_agent_id: "u2", booking_date: "2026-09-03", amount_after_tds: 1000 },
      ],
      activities: [{ actor_id: "u1", type: "call" }],
    });
    expect(r.agents[0].id).toBe("u1");
    expect(r.agents[0].rank).toBe(1);
    expect(r.agents[1].rank).toBe(2);
    expect(r.agents[0].productivity).toBeGreaterThan(r.agents[1].productivity);
  });

  it("gives a lone rep a perfect volume score, since scoring is relative", () => {
    // Documented consequence of having no configured targets: with one rep there
    // is nobody to be relative to. Asserted so the behaviour is intentional
    // rather than a surprise when a report shows 100.
    const r = buildReport({
      ...empty,
      leads: [{ id: "l1", assigned_to: "u1", stage: "new_lead" }],
      bookings: [
        { id: "b1", sales_agent_id: "u1", booking_date: "2026-09-02", amount_after_tds: 1 },
      ],
      followUps: [{ owner_id: "u1", status: "done", completed_at: "2026-09-05T10:00:00Z" }],
      activities: [{ actor_id: "u1", type: "call" }],
    });
    expect(r.agents[0].productivity).toBe(100);
  });

  it("reports zero rather than NaN when there is no data at all", () => {
    const r = buildReport(empty);
    expect(r.agents).toHaveLength(0);
    expect(r.team.productivity).toBe(0);
    expect(r.team.conversionPct).toBe(0);
    expect(r.team.avgDeal).toBe(0);
    expect(r.team.activeAgents).toBe(0);
  });
});

describe("buildReport — team and breakdowns", () => {
  it("averages the index only over agents with activity", () => {
    const r = buildReport({
      ...empty,
      // u2 appears in profiles but does nothing, so must not drag the mean down.
      leads: [{ id: "l1", assigned_to: "u1", stage: "new_lead" }],
      bookings: [
        { id: "b1", sales_agent_id: "u1", booking_date: "2026-09-02", amount_after_tds: 500 },
      ],
    });
    expect(r.team.activeAgents).toBe(1);
    expect(r.team.productivity).toBe(r.agents[0].productivity);
  });

  it("buckets the trend by day and sums revenue per bucket", () => {
    const r = buildReport({
      ...empty,
      bookings: [
        { id: "b1", sales_agent_id: "u1", booking_date: "2026-09-02", amount_after_tds: 100 },
        { id: "b2", sales_agent_id: "u1", booking_date: "2026-09-02", amount_after_tds: 200 },
        { id: "b3", sales_agent_id: "u1", booking_date: "2026-09-04", amount_after_tds: 50 },
      ],
    });
    expect(r.trend).toHaveLength(2);
    expect(r.trend[0].closures).toBe(2);
    expect(r.trend[0].revenue).toBe(300);
    expect(r.trend[1].revenue).toBe(50);
  });

  it("attributes conversion to the lead's source", () => {
    const r = buildReport({
      ...empty,
      leads: [
        { id: "l1", assigned_to: "u1", stage: "new_lead", source: "indiamart" },
        { id: "l2", assigned_to: "u1", stage: "new_lead", source: "indiamart" },
        { id: "l3", assigned_to: "u1", stage: "new_lead", source: "website" },
      ],
      bookings: [
        {
          id: "b1",
          sales_agent_id: "u1",
          booking_date: "2026-09-02",
          lead_id: "l1",
          amount_after_tds: 900,
        },
      ],
    });
    const indiamart = r.bySource.find((s) => s.source === "indiamart");
    expect(indiamart).toMatchObject({ leads: 2, closures: 1, conversionPct: 50, revenue: 900 });
    expect(r.bySource.find((s) => s.source === "website")?.closures).toBe(0);
  });
});
