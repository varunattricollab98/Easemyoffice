import { describe, it, expect } from "vitest";
import {
  daysSince,
  partnerPerformanceRows,
  type PerfActivity,
  type PerfFirm,
  type PerfReferral,
} from "@/lib/b2b-performance";

const DAY = 86_400_000;
const NOW = Date.parse("2026-06-01T00:00:00Z");
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

const firm = (over: Partial<PerfFirm> & { id: string }): PerfFirm => ({
  firm_name: `Firm ${over.id}`,
  partner_status: "active",
  assigned_to: "u1",
  city: null,
  state: null,
  ...over,
});

describe("daysSince", () => {
  it("returns null for no date", () => {
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince("not-a-date", NOW)).toBeNull();
  });
  it("counts whole days and never goes negative", () => {
    expect(daysSince(iso(10), NOW)).toBe(10);
    expect(daysSince(iso(0), NOW)).toBe(0);
    expect(daysSince(new Date(NOW + 5 * DAY).toISOString(), NOW)).toBe(0);
  });
});

describe("partnerPerformanceRows", () => {
  it("returns a row per firm even with no history", () => {
    const rows = partnerPerformanceRows({
      firms: [firm({ id: "a" }), firm({ id: "b" })],
      referrals: [],
      activities: [],
      now: NOW,
    });
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.firmId === "a")!;
    expect(a.totalReferrals).toBe(0);
    expect(a.convertedReferrals).toBe(0);
    expect(a.bookings).toBe(0);
    expect(a.revenue).toBe(0);
    expect(a.lastReferral).toBeNull();
    expect(a.lastContact).toBeNull();
    expect(a.score).toBe(0);
    // No referrals + no activity => never active => potential.
    expect(a.health).toBe("potential");
  });

  it("aggregates totals, conversions, bookings and revenue per firm", () => {
    const referrals: PerfReferral[] = [
      { firm_id: "a", converted: true, booking_id: "bk1", revenue: 100_000, date_received: iso(5) },
      {
        firm_id: "a",
        converted: true,
        booking_id: "bk2",
        revenue: "50000",
        date_received: iso(40),
      },
      { firm_id: "a", converted: false, booking_id: null, revenue: null, date_received: iso(80) },
      { firm_id: "b", converted: false, booking_id: null, revenue: 0, date_received: iso(10) },
    ];
    const activities: PerfActivity[] = [
      { firm_id: "a", happened_at: iso(2) },
      { firm_id: "b", happened_at: iso(400) },
    ];
    const bookingDates = new Map<string, string | null>([
      ["bk1", iso(4)],
      ["bk2", iso(39)],
    ]);
    const rows = partnerPerformanceRows({
      firms: [firm({ id: "a" }), firm({ id: "b" })],
      referrals,
      activities,
      bookingDates,
      now: NOW,
    });
    const a = rows.find((r) => r.firmId === "a")!;
    expect(a.totalReferrals).toBe(3);
    expect(a.convertedReferrals).toBe(2);
    expect(a.bookings).toBe(2);
    expect(a.revenue).toBe(150_000);
    // Latest referral is the one 5 days ago; latest contact 2 days ago.
    expect(a.lastReferral).toBe(iso(5));
    expect(a.lastContact).toBe(iso(2));
    expect(a.lastBooking).toBe(iso(4));
    expect(a.daysSinceLastActivity).toBe(2);
    expect(a.score).toBeGreaterThan(0);
    // Recent + referred + reasonable revenue => active or strategic.
    expect(["active", "strategic"]).toContain(a.health);

    const b = rows.find((r) => r.firmId === "b")!;
    expect(b.totalReferrals).toBe(1);
    expect(b.convertedReferrals).toBe(0);
    // Firm b's referral is 10 days old (its activity is 400 days old): the
    // latest active date wins, so it is not treated as lost.
    expect(b.daysSinceLastActivity).toBe(10);
  });

  it("ignores referrals/activities with no firm_id", () => {
    const rows = partnerPerformanceRows({
      firms: [firm({ id: "a" })],
      referrals: [
        { firm_id: null, converted: true, booking_id: "x", revenue: 999, date_received: iso(1) },
      ],
      activities: [{ firm_id: null, happened_at: iso(1) }],
      now: NOW,
    });
    expect(rows[0].totalReferrals).toBe(0);
    expect(rows[0].revenue).toBe(0);
  });

  it("marks a long-dormant partner as lost", () => {
    const rows = partnerPerformanceRows({
      firms: [firm({ id: "a" })],
      referrals: [
        {
          firm_id: "a",
          converted: true,
          booking_id: "b",
          revenue: 500_000,
          date_received: iso(400),
        },
      ],
      activities: [{ firm_id: "a", happened_at: iso(400) }],
      now: NOW,
    });
    expect(rows[0].health).toBe("lost");
  });
});
