import { describe, it, expect } from "vitest";
import { buildPaymentAckEmailHtml } from "./payment-ack-email";

const details = {
  client_name: "Acme Traders",
  booking_id: "EMO-BK-20260923-AB12",
  plan_name: "Premium VO",
  invoice_number: "INV-HR-0001",
  amount: "₹35,400",
  payment_mode: "UPI",
  date: "23 Sep 2026",
  payment_id_utr: "UTR123456789",
  state: "Haryana",
  sales_person_name: "Ravi Kumar",
  phone: "919876543210",
};

describe("buildPaymentAckEmailHtml", () => {
  it("returns a full HTML document", () => {
    const html = buildPaymentAckEmailHtml(details);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });

  it("injects the client name and payment reference", () => {
    const html = buildPaymentAckEmailHtml(details);
    expect(html).toContain("Acme Traders");
    expect(html).toContain("UTR123456789");
    expect(html).toContain("23 Sep 2026");
  });

  it("shows PAID status for a full payment", () => {
    const html = buildPaymentAckEmailHtml({ ...details, payment_type: "full" });
    expect(html).toContain("PAID");
    expect(html).not.toContain("PARTIAL PAYMENT");
  });

  it("shows PARTIAL PAYMENT status for a partial payment", () => {
    const html = buildPaymentAckEmailHtml({ ...details, payment_type: "partial" });
    expect(html).toContain("PARTIAL PAYMENT");
  });

  it("falls back to an em dash when no UTR is provided", () => {
    const html = buildPaymentAckEmailHtml({ ...details, payment_id_utr: "" });
    expect(html).toContain("Payment ID / UTR: \u2014");
  });

  it("does not throw on missing optional fields", () => {
    expect(() =>
      buildPaymentAckEmailHtml({
        client_name: "",
        booking_id: "",
        plan_name: "",
        invoice_number: "",
        amount: "",
        payment_mode: "",
        date: "",
        payment_id_utr: "",
        state: "",
        sales_person_name: "",
        phone: "",
      }),
    ).not.toThrow();
  });
});
