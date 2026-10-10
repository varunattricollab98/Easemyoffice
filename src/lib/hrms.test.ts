import { describe, expect, it } from "vitest";
import { nextEmployeeCodes, splitName } from "./hrms";

describe("splitName", () => {
  it("splits first and last name", () => {
    expect(splitName("Neha Singh", null)).toEqual({ first: "Neha", last: "Singh" });
    expect(splitName("Kishan", null)).toEqual({ first: "Kishan", last: null });
  });

  it("falls back to the email local part", () => {
    expect(splitName("", "sarthak.sharma@easemyoffice.in")).toEqual({
      first: "Sarthak",
      last: "Sharma",
    });
  });
});

describe("nextEmployeeCodes", () => {
  it("continues after the highest existing code", () => {
    expect(nextEmployeeCodes(["EMOC001", "emoc007", "HR-1"], 2)).toEqual(["EMOC008", "EMOC009"]);
  });

  it("continues after EMOC008 with EMOC009", () => {
    expect(nextEmployeeCodes(["EMOC008"], 1)).toEqual(["EMOC009"]);
  });

  it("starts at EMOC001 with no codes", () => {
    expect(nextEmployeeCodes([], 3)).toEqual(["EMOC001", "EMOC002", "EMOC003"]);
  });

  it("starts at EMOC001 when no codes match the prefix", () => {
    expect(nextEmployeeCodes(["HR-1", "ABC123"], 1)).toEqual(["EMOC001"]);
  });
});
