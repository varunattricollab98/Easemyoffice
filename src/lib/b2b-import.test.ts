import { describe, expect, it } from "vitest";
import {
  buildDedupeIndex,
  classifyRows,
  countAssigned,
  firmCityKey,
  isRowValid,
  matchedKeys,
  normalizeEmail,
  normalizePhone,
  normalizeWebsite,
  resolveAssignments,
  roundRobinAssign,
  rowDedupeKeys,
  validateRow,
  type DedupeRecord,
  type ImportRow,
} from "./b2b-import";

// A fully-blank import row that individual tests override field by field.
function row(overrides: Partial<ImportRow>): ImportRow {
  return {
    firm_name: "",
    contact_person: "",
    designation: "",
    phone: "",
    alt_phone: "",
    email: "",
    website: "",
    city: "",
    state: "",
    full_address: "",
    firm_type: "",
    firm_size: "",
    lead_source: "",
    source_url: "",
    ...overrides,
  };
}

describe("normalizers", () => {
  it("normalizes phone to the last 10 digits regardless of country code / punctuation", () => {
    expect(normalizePhone("+91 98765-43210")).toBe("9876543210");
    expect(normalizePhone("098765 43210")).toBe("9876543210");
    expect(normalizePhone("0091-9876543210")).toBe("9876543210");
  });

  it("treats too-short phones as no key (so blanks never collide)", () => {
    expect(normalizePhone("12345")).toBe("");
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone(null)).toBe("");
  });

  it("lower-cases email and host-normalizes website", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
    expect(normalizeWebsite("HTTPS://WWW.Example.com/path?x=1")).toBe("example.com");
    expect(normalizeWebsite("http://example.com/")).toBe("example.com");
  });

  it("builds a firm_name+city key that ignores case/whitespace", () => {
    expect(firmCityKey("  Sharma &  Associates ", "New Delhi")).toBe(
      "sharma & associates|new delhi",
    );
    expect(firmCityKey("", "Delhi")).toBe("");
  });
});

describe("validateRow", () => {
  it("accepts a firm with a valid phone", () => {
    expect(isRowValid(row({ firm_name: "Acme CA", phone: "9876543210" }))).toBe(true);
  });

  it("accepts a firm with a valid email and no phone", () => {
    expect(isRowValid(row({ firm_name: "Acme CA", email: "a@b.com" }))).toBe(true);
  });

  it("flags a missing firm name", () => {
    expect(validateRow(row({ phone: "9876543210" }))).toContain("Missing Firm Name");
  });

  it("flags a row with no phone and no email", () => {
    expect(validateRow(row({ firm_name: "Acme CA" }))).toContain("Missing Phone and Email");
  });

  it("flags a malformed email", () => {
    expect(validateRow(row({ firm_name: "Acme CA", email: "not-an-email" }))).toContain(
      "Malformed Email",
    );
  });

  it("flags a malformed phone when phone is the only contact", () => {
    const reasons = validateRow(row({ firm_name: "Acme CA", phone: "123" }));
    expect(reasons).toContain("Malformed Phone");
    expect(isRowValid(row({ firm_name: "Acme CA", phone: "123" }))).toBe(false);
  });
});

describe("dedupe keys + matching", () => {
  const existing: DedupeRecord[] = [
    {
      firm_name: "Existing Firm",
      phone: "+91 90000-00001",
      email: "existing@firm.com",
      website: "https://www.existingfirm.com",
      city: "Mumbai",
    },
    { firm_name: "Delhi CA", city: "Delhi", phone: null, email: null, website: null },
  ];
  const index = buildDedupeIndex(existing);

  it("matches on exact phone (last-10-digit normalized)", () => {
    const keys = rowDedupeKeys(row({ firm_name: "Whatever", phone: "090000 00001" }));
    expect(matchedKeys(keys, index)).toContain("phone");
  });

  it("matches on email", () => {
    const keys = rowDedupeKeys(row({ firm_name: "Whatever", email: "EXISTING@firm.com" }));
    expect(matchedKeys(keys, index)).toContain("email");
  });

  it("matches on firm_name + city", () => {
    const keys = rowDedupeKeys(row({ firm_name: "delhi ca", city: "DELHI" }));
    expect(matchedKeys(keys, index)).toContain("firm_name + city");
  });

  it("matches on website", () => {
    const keys = rowDedupeKeys(row({ firm_name: "Whatever", website: "existingfirm.com" }));
    expect(matchedKeys(keys, index)).toContain("website");
  });

  it("does not match a genuinely new record", () => {
    const keys = rowDedupeKeys(row({ firm_name: "Brand New", phone: "9123456789", city: "Pune" }));
    expect(matchedKeys(keys, index)).toEqual([]);
  });
});

describe("classifyRows", () => {
  const existing: DedupeRecord[] = [{ firm_name: "Old Co", phone: "9876500001", city: "Jaipur" }];

  it("classifies new / duplicate (existing) / invalid and counts them", () => {
    const rows: ImportRow[] = [
      row({ firm_name: "Fresh One", phone: "9000000001", city: "Pune" }), // new
      row({ firm_name: "Dup Of Old", phone: "+91 98765-00001" }), // dup (existing phone)
      row({ phone: "9000000002" }), // invalid (no firm name)
    ];
    const { counts, classifications } = classifyRows(rows, existing);
    expect(counts).toEqual({ total: 3, new: 1, duplicate: 1, invalid: 1 });
    expect(classifications[0].status).toBe("new");
    expect(classifications[1].status).toBe("duplicate");
    expect(classifications[2].status).toBe("invalid");
  });

  it("catches within-file duplicates (first occurrence is new, rest duplicate)", () => {
    const rows: ImportRow[] = [
      row({ firm_name: "Repeat CA", email: "same@ca.com" }),
      row({ firm_name: "Different Name", email: "same@ca.com" }), // dup on email in-file
      row({ firm_name: "Repeat CA", city: "" }), // dup on firm_name+city in-file -> needs contact
    ];
    const { counts, classifications } = classifyRows(rows, []);
    expect(classifications[0].status).toBe("new");
    expect(classifications[1].status).toBe("duplicate");
    expect((classifications[1] as { matchedOn: string[] }).matchedOn).toContain("email");
    // Third row has no phone/email -> invalid, so it is NOT counted as a duplicate.
    expect(classifications[2].status).toBe("invalid");
    expect(counts.new).toBe(1);
    expect(counts.duplicate).toBe(1);
    expect(counts.invalid).toBe(1);
  });

  it("flags a within-file firm_name+city repeat as duplicate when it is otherwise valid", () => {
    const rows: ImportRow[] = [
      row({ firm_name: "Twin CA", city: "Delhi", phone: "9000000010" }),
      row({ firm_name: "TWIN ca", city: "delhi", phone: "9000000011" }), // same firm+city
    ];
    const { classifications } = classifyRows(rows, []);
    expect(classifications[0].status).toBe("new");
    expect(classifications[1].status).toBe("duplicate");
    expect((classifications[1] as { matchedOn: string[] }).matchedOn).toContain("firm_name + city");
  });
});

describe("roundRobinAssign", () => {
  it("cycles users deterministically across rows", () => {
    expect(roundRobinAssign(["a", "b", "c"], 7)).toEqual(["a", "b", "c", "a", "b", "c", "a"]);
  });

  it("distributes rows evenly (counts differ by at most one)", () => {
    const assignments = roundRobinAssign(["u1", "u2", "u3"], 10);
    const counts = assignments.reduce<Record<string, number>>((acc, id) => {
      acc[id!] = (acc[id!] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ u1: 4, u2: 3, u3: 3 });
  });

  it("returns all-null when there are no users", () => {
    expect(roundRobinAssign([], 3)).toEqual([null, null, null]);
  });

  it("returns empty for a non-positive count", () => {
    expect(roundRobinAssign(["a"], 0)).toEqual([]);
  });
});

describe("resolveAssignments", () => {
  it("assigns everyone to a specific user", () => {
    expect(resolveAssignments("specific", 3, { specificUserId: "x" })).toEqual(["x", "x", "x"]);
  });

  it("leaves the whole team-mode batch unassigned", () => {
    expect(resolveAssignments("team", 2)).toEqual([null, null]);
  });

  it("round-robins across the selected users", () => {
    expect(resolveAssignments("round_robin", 4, { roundRobinUserIds: ["a", "b"] })).toEqual([
      "a",
      "b",
      "a",
      "b",
    ]);
  });

  it("counts the assigned (non-null) rows", () => {
    expect(
      countAssigned(resolveAssignments("round_robin", 4, { roundRobinUserIds: ["a", "b"] })),
    ).toBe(4);
    expect(countAssigned(resolveAssignments("team", 4))).toBe(0);
  });
});
