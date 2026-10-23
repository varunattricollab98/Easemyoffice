// Who an email actually goes to.
//
// A client with several addresses is normal, and the cost of getting this
// wrong is asymmetric: silently dropping a primary recipient means the client
// never receives their own payment acknowledgment and nobody notices, while a
// stray comma in a CC box should never block a send. Hence two standards —
// strict for To, lenient for CC/BCC.

import { describe, expect, it } from "vitest";
import {
  clientRecipients,
  dedupeEmails,
  everyEmailValid,
  isEmailAddress,
  parseEmailList,
} from "./email-utils";

describe("isEmailAddress", () => {
  it("accepts the addresses this business actually uses", () => {
    expect(isEmailAddress("contact@easemyoffice.in")).toBe(true);
    expect(isEmailAddress("first.last+tag@sub.domain.co.in")).toBe(true);
    expect(isEmailAddress("  padded@example.com  ")).toBe(true);
  });

  it("rejects what a typo looks like", () => {
    expect(isEmailAddress("no-at-sign.example.com")).toBe(false);
    expect(isEmailAddress("missing@domain")).toBe(false);
    expect(isEmailAddress("two words@example.com")).toBe(false);
    expect(isEmailAddress("@example.com")).toBe(false);
    expect(isEmailAddress("trailing@example.")).toBe(false);
    expect(isEmailAddress("")).toBe(false);
    expect(isEmailAddress(null)).toBe(false);
    expect(isEmailAddress(undefined)).toBe(false);
  });
});

describe("dedupeEmails", () => {
  it("removes repeats case-insensitively and keeps the first spelling", () => {
    // The same person typed two ways must not get two copies.
    expect(dedupeEmails(["Ravi@Example.com", "ravi@example.com", "RAVI@EXAMPLE.COM"])).toEqual([
      "Ravi@Example.com",
    ]);
  });

  it("drops blanks and nulls, and keeps the given order", () => {
    expect(dedupeEmails(["a@x.com", null, "  ", undefined, "b@x.com"])).toEqual([
      "a@x.com",
      "b@x.com",
    ]);
  });

  it("does not validate — that is the caller's choice", () => {
    expect(dedupeEmails(["not-an-email"])).toEqual(["not-an-email"]);
  });
});

describe("parseEmailList", () => {
  it("splits a typed CC list on commas", () => {
    expect(parseEmailList("a@x.com, b@y.com")).toEqual(["a@x.com", "b@y.com"]);
  });

  it("tolerates semicolons, extra spaces and trailing separators", () => {
    // People paste these from Outlook and from each other's messages.
    expect(parseEmailList("a@x.com; b@y.com,,  c@z.com , ")).toEqual([
      "a@x.com",
      "b@y.com",
      "c@z.com",
    ]);
  });

  it("drops invalid entries instead of blocking the send", () => {
    expect(parseEmailList("good@x.com, rubbish, also-bad@")).toEqual(["good@x.com"]);
  });

  it("dedupes", () => {
    expect(parseEmailList("a@x.com, A@X.COM")).toEqual(["a@x.com"]);
  });

  it("is empty for nothing at all", () => {
    expect(parseEmailList("")).toEqual([]);
    expect(parseEmailList(null)).toEqual([]);
    expect(parseEmailList("   ,  ")).toEqual([]);
  });
});

describe("everyEmailValid", () => {
  it("is true for an empty field — the field is optional", () => {
    expect(everyEmailValid("")).toBe(true);
    expect(everyEmailValid(null)).toBe(true);
  });

  it("is true only when every entry is an address", () => {
    expect(everyEmailValid("a@x.com")).toBe(true);
    expect(everyEmailValid("a@x.com, b@y.com")).toBe(true);
    expect(everyEmailValid("a@x.com, oops")).toBe(false);
    expect(everyEmailValid("oops")).toBe(false);
  });

  it("ignores a trailing comma rather than calling it invalid", () => {
    expect(everyEmailValid("a@x.com,")).toBe(true);
  });
});

describe("clientRecipients", () => {
  it("puts the record's own address first", () => {
    // The client must be the first person in the To line of their own email.
    expect(clientRecipients("client@x.com", "accounts@x.com")).toEqual([
      "client@x.com",
      "accounts@x.com",
    ]);
  });

  it("skips missing and invalid addresses", () => {
    expect(clientRecipients("client@x.com", null, "", "not-an-email", undefined)).toEqual([
      "client@x.com",
    ]);
  });

  it("does not send the same person twice", () => {
    expect(clientRecipients("client@x.com", "CLIENT@x.com")).toEqual(["client@x.com"]);
  });

  it("is empty when the record has no usable address", () => {
    // Callers use this to refuse the send rather than call Resend with nothing.
    expect(clientRecipients(null, undefined, "")).toEqual([]);
  });
});
