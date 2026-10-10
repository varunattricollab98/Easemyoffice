import { describe, expect, it } from "vitest";
import { nextEmployeeCodes, sharedDeviceKeys, splitName } from "./hrms";

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

describe("sharedDeviceKeys", () => {
  it("returns an empty set for an empty list", () => {
    expect(sharedDeviceKeys([])).toEqual(new Set());
  });

  it("flags a device_key registered to two different employees", () => {
    const shared = sharedDeviceKeys([
      { device_key: "07c04911", employee_id: "pooja" },
      { device_key: "07c04911", employee_id: "kishan" },
    ]);
    expect(shared.has("07c04911")).toBe(true);
    expect(shared.size).toBe(1);
  });

  it("does not flag a key used by one employee even across repeated rows", () => {
    const shared = sharedDeviceKeys([
      { device_key: "solo", employee_id: "pooja" },
      { device_key: "solo", employee_id: "pooja" },
    ]);
    expect(shared.has("solo")).toBe(false);
    expect(shared.size).toBe(0);
  });

  it("returns only the shared keys from a mixed list", () => {
    const shared = sharedDeviceKeys([
      { device_key: "07c04911", employee_id: "pooja" },
      { device_key: "07c04911", employee_id: "kishan" },
      { device_key: "solo", employee_id: "ravi" },
      { device_key: "solo", employee_id: "ravi" },
      { device_key: "pair", employee_id: "a" },
      { device_key: "pair", employee_id: "b" },
    ]);
    expect(shared).toEqual(new Set(["07c04911", "pair"]));
  });
});
