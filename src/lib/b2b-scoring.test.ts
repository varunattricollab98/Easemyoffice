import { describe, expect, it } from "vitest";
import {
  partnerHealthCategory,
  partnerScore,
  SCORE_WEIGHTS,
  type PartnerStats,
} from "./b2b-scoring";

const base: PartnerStats = {
  totalReferrals: 0,
  convertedReferrals: 0,
  revenue: 0,
  daysSinceLastActivity: null,
};

describe("partnerScore", () => {
  it("scores a firm with no history at zero", () => {
    expect(partnerScore(base)).toBe(0);
  });

  it("caps at 100 for a maxed-out partner", () => {
    const score = partnerScore({
      totalReferrals: 20,
      convertedReferrals: 20,
      revenue: 1_000_000,
      daysSinceLastActivity: 1,
    });
    expect(score).toBe(100);
  });

  it("gives full recency credit within the recent window", () => {
    // Only recency active: 20 points.
    expect(partnerScore({ ...base, daysSinceLastActivity: 30 })).toBe(SCORE_WEIGHTS.recency);
  });

  it("gives no recency credit once stale", () => {
    expect(partnerScore({ ...base, daysSinceLastActivity: 400 })).toBe(0);
  });

  it("decays recency between recent and stale thresholds", () => {
    // Halfway between 90 and 365 (~227 days) -> about half the recency cap.
    const score = partnerScore({ ...base, daysSinceLastActivity: 227 });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(SCORE_WEIGHTS.recency);
  });

  it("rewards conversion quality", () => {
    const halfConverted = partnerScore({
      totalReferrals: 10,
      convertedReferrals: 5,
      revenue: 0,
      daysSinceLastActivity: null,
    });
    const allConverted = partnerScore({
      totalReferrals: 10,
      convertedReferrals: 10,
      revenue: 0,
      daysSinceLastActivity: null,
    });
    expect(allConverted).toBeGreaterThan(halfConverted);
  });

  it("never exceeds the quality cap when converted exceeds total", () => {
    // Defensive: convertedReferrals clamped to totalReferrals.
    const score = partnerScore({
      totalReferrals: 2,
      convertedReferrals: 99,
      revenue: 0,
      daysSinceLastActivity: null,
    });
    // volume (2/10*25=5) + quality capped at 25 = 30.
    expect(score).toBe(30);
  });

  it("is monotonic in revenue", () => {
    const low = partnerScore({ ...base, revenue: 100_000, totalReferrals: 1 });
    const high = partnerScore({ ...base, revenue: 400_000, totalReferrals: 1 });
    expect(high).toBeGreaterThan(low);
  });
});

describe("partnerHealthCategory", () => {
  it("classifies a never-active firm with no referrals as potential", () => {
    expect(partnerHealthCategory(base)).toBe("potential");
  });

  it("classifies a recently contacted firm with no referrals as potential", () => {
    expect(partnerHealthCategory({ ...base, daysSinceLastActivity: 30 })).toBe("potential");
  });

  it("classifies a stale no-referral firm as dormant", () => {
    expect(partnerHealthCategory({ ...base, daysSinceLastActivity: 200 })).toBe("dormant");
  });

  it("classifies long inactivity as lost regardless of past volume", () => {
    expect(
      partnerHealthCategory({
        totalReferrals: 15,
        convertedReferrals: 10,
        revenue: 800_000,
        daysSinceLastActivity: 500,
      }),
    ).toBe("lost");
  });

  it("classifies a strong, recently active partner as strategic", () => {
    expect(
      partnerHealthCategory({
        totalReferrals: 12,
        convertedReferrals: 10,
        revenue: 600_000,
        daysSinceLastActivity: 10,
      }),
    ).toBe("strategic");
  });

  it("classifies a modest, recently active partner as active", () => {
    expect(
      partnerHealthCategory({
        totalReferrals: 2,
        convertedReferrals: 1,
        revenue: 20_000,
        daysSinceLastActivity: 20,
      }),
    ).toBe("active");
  });

  it("classifies a referring partner that drifted as dormant", () => {
    expect(
      partnerHealthCategory({
        totalReferrals: 5,
        convertedReferrals: 2,
        revenue: 50_000,
        daysSinceLastActivity: 200,
      }),
    ).toBe("dormant");
  });
});
