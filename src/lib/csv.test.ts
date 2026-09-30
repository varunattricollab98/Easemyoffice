import { describe, expect, it } from "vitest";
import { hoursDecimal, toCsv } from "./csv";

describe("csv", () => {
  it("quotes only cells that need it", () => {
    expect(toCsv([["a", 'say "hi"', "x,y", null, 3]])).toBe('a,"say ""hi""","x,y",,3');
  });

  it("uses CRLF between rows", () => {
    expect(toCsv([["a"], ["b"]])).toBe("a\r\nb");
  });

  it("converts minutes to decimal hours", () => {
    expect(hoursDecimal(510)).toBe(8.5);
    expect(hoursDecimal(100)).toBe(1.67);
    expect(hoursDecimal(0)).toBe(0);
  });
});
