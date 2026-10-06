import { describe, expect, it } from "vitest";
import {
  B2B_CLOSED_OUTCOMES,
  B2B_LEAD_STATUSES,
  B2B_PIPELINE_STAGES,
  B2B_SOURCES,
  isClosedOutcome,
  labelFor,
  pipelineStageOrder,
} from "./b2b";

describe("labelFor", () => {
  it("returns the label for a known id", () => {
    expect(labelFor(B2B_SOURCES, "google_maps")).toBe("Google Maps");
    expect(labelFor(B2B_LEAD_STATUSES, "active_partner")).toBe("Active Partner");
  });

  it("falls back to the id then a dash for unknown / missing ids", () => {
    expect(labelFor(B2B_SOURCES, "nope")).toBe("nope");
    expect(labelFor(B2B_SOURCES, null)).toBe("—");
    expect(labelFor(B2B_SOURCES, undefined)).toBe("—");
  });
});

describe("pipeline stages", () => {
  it("has exactly 10 ordered stages with sequential 1..10 order", () => {
    expect(B2B_PIPELINE_STAGES).toHaveLength(10);
    expect(B2B_PIPELINE_STAGES.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("pipelineStageOrder returns the 1-based position, 0 for non-pipeline ids", () => {
    expect(pipelineStageOrder("new_prospect")).toBe(1);
    expect(pipelineStageOrder("active_partner")).toBe(10);
    expect(pipelineStageOrder("meeting_discussion")).toBe(6);
    expect(pipelineStageOrder("lost")).toBe(0);
    expect(pipelineStageOrder(null)).toBe(0);
    expect(pipelineStageOrder("unknown")).toBe(0);
  });
});

describe("closed outcomes", () => {
  it("isClosedOutcome is true only for closed/lost ids", () => {
    expect(isClosedOutcome("lost")).toBe(true);
    expect(isClosedOutcome("do_not_contact")).toBe(true);
    expect(isClosedOutcome("duplicate")).toBe(true);
    expect(isClosedOutcome("new_prospect")).toBe(false);
    expect(isClosedOutcome(null)).toBe(false);
  });

  it("closed outcomes are disjoint from the forward pipeline stages", () => {
    const pipelineIds = new Set(B2B_PIPELINE_STAGES.map((s) => s.id));
    for (const o of B2B_CLOSED_OUTCOMES) {
      expect(pipelineIds.has(o.id as never)).toBe(false);
    }
  });

  it("every pipeline stage and closed outcome exists in the full lead status set", () => {
    const statusIds = new Set(B2B_LEAD_STATUSES.map((s) => s.id));
    for (const s of B2B_PIPELINE_STAGES) {
      // "meeting_discussion" is a merged board stage; its two lead statuses are
      // meeting_scheduled / meeting_completed, so skip that synthetic id.
      if (s.id === "meeting_discussion") continue;
      expect(statusIds.has(s.id as never)).toBe(true);
    }
    for (const o of B2B_CLOSED_OUTCOMES) {
      expect(statusIds.has(o.id as never)).toBe(true);
    }
  });
});
