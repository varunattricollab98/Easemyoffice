import { describe, it, expect } from "vitest";
import { formatINR, getErrorMessage } from "./utils";

describe("formatINR", () => {
  it("formats with the rupee symbol and en-IN grouping", () => {
    expect(formatINR(35400)).toBe("\u20B935,400");
    expect(formatINR(100000)).toBe("\u20B91,00,000");
    expect(formatINR(0)).toBe("\u20B90");
  });

  it("treats null/undefined/NaN as 0", () => {
    expect(formatINR(null)).toBe("\u20B90");
    expect(formatINR(undefined)).toBe("\u20B90");
    expect(formatINR(NaN)).toBe("\u20B90");
  });

  it("drops decimals", () => {
    expect(formatINR(999.99)).toBe("\u20B91,000");
  });
});

describe("getErrorMessage", () => {
  it("returns the message from an Error", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns a plain string as-is", () => {
    expect(getErrorMessage("just a string")).toBe("just a string");
  });

  it("reads .message off a plain object", () => {
    expect(getErrorMessage({ message: "obj message" })).toBe("obj message");
  });

  it("uses the fallback for null/undefined/unknown shapes", () => {
    expect(getErrorMessage(null)).toBe("Something went wrong");
    expect(getErrorMessage(undefined)).toBe("Something went wrong");
    expect(getErrorMessage(42)).toBe("Something went wrong");
    expect(getErrorMessage({})).toBe("Something went wrong");
  });

  it("honors a custom fallback", () => {
    expect(getErrorMessage(null, "Export failed")).toBe("Export failed");
    expect(getErrorMessage(new Error(""), "Export failed")).toBe("Export failed");
  });
});
