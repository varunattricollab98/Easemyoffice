import { describe, it, expect } from "vitest";
import {
  completedItemIds,
  daysBetween,
  onboardingProgress,
  summarizeOnboarding,
  ONBOARDING_ITEM_COUNT,
  type OnboardingLike,
} from "@/lib/b2b-documentation";

const EMPTY: OnboardingLike = {
  firm_details: false,
  contact_details: false,
  agreement: false,
  required_documents: false,
  partner_terms: false,
  referral_process_explained: false,
  communication_setup: false,
  onboarding_completed: false,
};

function row(patch: Partial<OnboardingLike>): OnboardingLike {
  return { ...EMPTY, ...patch };
}

const DAY = 86_400_000;
const NOW = Date.parse("2026-05-20T00:00:00.000Z");

describe("daysBetween", () => {
  it("returns whole days, clamped at zero", () => {
    expect(daysBetween("2026-05-01", "2026-05-08")).toBe(7);
    expect(daysBetween("2026-05-08", "2026-05-01")).toBe(0);
  });
  it("returns null when a bound is missing or invalid", () => {
    expect(daysBetween(null, "2026-05-08")).toBeNull();
    expect(daysBetween("2026-05-01", undefined)).toBeNull();
    expect(daysBetween("nope", "2026-05-08")).toBeNull();
  });
});

describe("completedItemIds", () => {
  it("lists ticked items in display order", () => {
    expect(completedItemIds(row({ agreement: true, firm_details: true }))).toEqual([
      "firm_details",
      "agreement",
    ]);
  });
  it("is empty for a fresh checklist", () => {
    expect(completedItemIds(EMPTY)).toEqual([]);
  });
});

describe("onboardingProgress", () => {
  it("is 0% / 8 items for an empty checklist", () => {
    const p = onboardingProgress(EMPTY, { now: NOW });
    expect(p.completed).toBe(0);
    expect(p.total).toBe(ONBOARDING_ITEM_COUNT);
    expect(p.percent).toBe(0);
    expect(p.isComplete).toBe(false);
  });

  it("rounds the progress percentage", () => {
    // 3 of 8 = 37.5% -> 38
    const p = onboardingProgress(
      row({ firm_details: true, contact_details: true, agreement: true }),
      { now: NOW },
    );
    expect(p.completed).toBe(3);
    expect(p.percent).toBe(38);
  });

  it("flags completion and computes TAT from created_at -> completed_at", () => {
    const p = onboardingProgress(
      row({
        onboarding_completed: true,
        created_at: "2026-05-01T00:00:00.000Z",
        completed_at: "2026-05-04T00:00:00.000Z",
      }),
      { now: NOW },
    );
    expect(p.isComplete).toBe(true);
    expect(p.tatDays).toBe(3);
    // A completed checklist is never delayed.
    expect(p.isDelayed).toBe(false);
  });

  it("marks an open checklist delayed once past the TAT threshold", () => {
    const createdAt = new Date(NOW - 10 * DAY).toISOString();
    const p = onboardingProgress(row({ created_at: createdAt }), {
      now: NOW,
      tatThresholdDays: 7,
    });
    expect(p.isComplete).toBe(false);
    expect(p.tatDays).toBe(10);
    expect(p.isDelayed).toBe(true);
  });

  it("does not flag a young open checklist as delayed", () => {
    const createdAt = new Date(NOW - 2 * DAY).toISOString();
    const p = onboardingProgress(row({ created_at: createdAt }), {
      now: NOW,
      tatThresholdDays: 7,
    });
    expect(p.isDelayed).toBe(false);
  });
});

describe("summarizeOnboarding", () => {
  it("returns zeroed summary for an empty list", () => {
    expect(summarizeOnboarding([], { now: NOW })).toEqual({
      total: 0,
      completed: 0,
      pending: 0,
      delayed: 0,
      avgTatDays: null,
      avgPercent: 0,
    });
  });

  it("counts completed / pending / delayed and averages TAT over completed only", () => {
    const createdOld = new Date(NOW - 10 * DAY).toISOString();
    const createdYoung = new Date(NOW - 1 * DAY).toISOString();
    const rows: OnboardingLike[] = [
      // completed, TAT 2 days
      row({
        firm_details: true,
        contact_details: true,
        agreement: true,
        required_documents: true,
        partner_terms: true,
        referral_process_explained: true,
        communication_setup: true,
        onboarding_completed: true,
        created_at: "2026-05-01T00:00:00.000Z",
        completed_at: "2026-05-03T00:00:00.000Z",
      }),
      // completed, TAT 4 days
      row({
        firm_details: true,
        contact_details: true,
        agreement: true,
        required_documents: true,
        partner_terms: true,
        referral_process_explained: true,
        communication_setup: true,
        onboarding_completed: true,
        created_at: "2026-05-01T00:00:00.000Z",
        completed_at: "2026-05-05T00:00:00.000Z",
      }),
      // open + delayed (10 days old)
      row({ firm_details: true, created_at: createdOld }),
      // open + fresh (1 day old)
      row({ created_at: createdYoung }),
    ];
    const s = summarizeOnboarding(rows, { now: NOW, tatThresholdDays: 7 });
    expect(s.total).toBe(4);
    expect(s.completed).toBe(2);
    expect(s.pending).toBe(2);
    expect(s.delayed).toBe(1);
    expect(s.avgTatDays).toBe(3); // (2 + 4) / 2
  });
});
