import { describe, expect, it } from "vitest";
import { bucketFollowups, bucketFor, istDayKey, type BucketableFollowup } from "./b2b-followups";

// All instants below are expressed as explicit UTC ("Z") so the tests are
// deterministic regardless of the machine's local timezone. IST = UTC+05:30.

describe("istDayKey", () => {
  it("reports the IST calendar day for a UTC instant", () => {
    // 2024-06-10 20:00 UTC is 2024-06-11 01:30 IST — the next IST day.
    expect(istDayKey("2024-06-10T20:00:00Z")).toBe("2024-06-11");
  });

  it("keeps an early-morning UTC instant on the same IST day", () => {
    // 2024-06-10 10:00 UTC is 2024-06-10 15:30 IST.
    expect(istDayKey("2024-06-10T10:00:00Z")).toBe("2024-06-10");
  });

  it("rolls over at IST midnight, not UTC midnight", () => {
    // 2024-06-10 18:29 UTC = 2024-06-10 23:59 IST (still the 10th in IST).
    expect(istDayKey("2024-06-10T18:29:00Z")).toBe("2024-06-10");
    // 2024-06-10 18:30 UTC = 2024-06-11 00:00 IST (now the 11th in IST).
    expect(istDayKey("2024-06-10T18:30:00Z")).toBe("2024-06-11");
  });
});

describe("bucketFor", () => {
  // Reference "now": 2024-06-10 06:00 UTC = 2024-06-10 11:30 IST.
  const now = "2024-06-10T06:00:00Z";

  it("buckets a follow-up due later the same IST day as today", () => {
    // 2024-06-10 16:00 UTC = 2024-06-10 21:30 IST — still today.
    expect(bucketFor("2024-06-10T16:00:00Z", now)).toBe("today");
  });

  it("buckets a follow-up due earlier the same IST day as today (not overdue)", () => {
    // 2024-06-10 01:00 UTC = 2024-06-10 06:30 IST — earlier today, still Today.
    expect(bucketFor("2024-06-10T01:00:00Z", now)).toBe("today");
  });

  it("buckets a follow-up due yesterday (IST) as overdue", () => {
    expect(bucketFor("2024-06-09T12:00:00Z", now)).toBe("overdue");
  });

  it("buckets a follow-up due tomorrow (IST) as upcoming", () => {
    expect(bucketFor("2024-06-11T12:00:00Z", now)).toBe("upcoming");
  });

  it("treats the IST midnight boundary correctly", () => {
    // Due 2024-06-09 18:30 UTC = 2024-06-10 00:00 IST — exactly today's start.
    expect(bucketFor("2024-06-09T18:30:00Z", now)).toBe("today");
    // Due 2024-06-09 18:29 UTC = 2024-06-09 23:59 IST — yesterday, overdue.
    expect(bucketFor("2024-06-09T18:29:00Z", now)).toBe("overdue");
    // Due 2024-06-10 18:30 UTC = 2024-06-11 00:00 IST — tomorrow, upcoming.
    expect(bucketFor("2024-06-10T18:30:00Z", now)).toBe("upcoming");
  });
});

describe("bucketFollowups", () => {
  const now = "2024-06-10T06:00:00Z"; // 11:30 IST on the 10th

  const sample: (BucketableFollowup & { id: string })[] = [
    { id: "overdue-1", due_at: "2024-06-08T10:00:00Z" },
    { id: "today-1", due_at: "2024-06-10T02:00:00Z" }, // 07:30 IST, earlier today
    { id: "today-2", due_at: "2024-06-10T16:00:00Z" }, // 21:30 IST, later today
    { id: "upcoming-1", due_at: "2024-06-12T10:00:00Z" },
    { id: "overdue-2", due_at: "2024-06-09T12:00:00Z" },
  ];

  it("splits follow-ups into overdue / today / upcoming", () => {
    const b = bucketFollowups(sample, now);
    expect(b.overdue.map((f) => f.id)).toEqual(["overdue-1", "overdue-2"]);
    expect(b.today.map((f) => f.id)).toEqual(["today-1", "today-2"]);
    expect(b.upcoming.map((f) => f.id)).toEqual(["upcoming-1"]);
  });

  it("preserves input order within each bucket", () => {
    const ordered = [
      { id: "a", due_at: "2024-06-10T03:00:00Z" },
      { id: "b", due_at: "2024-06-10T04:00:00Z" },
      { id: "c", due_at: "2024-06-10T02:00:00Z" },
    ];
    const b = bucketFollowups(ordered, now);
    expect(b.today.map((f) => f.id)).toEqual(["a", "b", "c"]);
  });

  it("returns three empty buckets for an empty list", () => {
    const b = bucketFollowups([], now);
    expect(b).toEqual({ overdue: [], today: [], upcoming: [] });
  });
});
