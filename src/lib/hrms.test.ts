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
    expect(nextEmployeeCodes(["EMO001", "emo007", "HR-1"], 2)).toEqual(["EMO008", "EMO009"]);
  });

  it("starts at EMO001 with no codes", () => {
    expect(nextEmployeeCodes([], 3)).toEqual(["EMO001", "EMO002", "EMO003"]);
  });
});
