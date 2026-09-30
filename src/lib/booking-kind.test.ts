import { describe, expect, it } from "vitest";
import { isRenewalBooking, planCodeLabel } from "./booking-kind";

describe("isRenewalBooking", () => {
  it("treats a Booking ID ending in R1 / R2 as a renewal", () => {
    expect(isRenewalBooking({ external_booking_id: "EMO1234R1" })).toBe(true);
    expect(isRenewalBooking({ external_booking_id: " EMO88R2 " })).toBe(true);
    expect(isRenewalBooking({ external_booking_id: "EMO1234" })).toBe(false);
  });

  it("keeps booking_source Renewal as a renewal", () => {
    expect(isRenewalBooking({ external_booking_id: "EMO9", booking_source: "Renewal" })).toBe(true);
  });

  it("counts renewal-form bookings (no Booking ID) but not a fresh booking the pipeline marked renewed", () => {
    expect(isRenewalBooking({ external_booking_id: null, renewal_status: "renewed" })).toBe(true);
    expect(isRenewalBooking({ external_booking_id: "EMO77", renewal_status: "renewed" })).toBe(
      false,
    );
    expect(isRenewalBooking({ external_booking_id: null, renewal_status: "pending" })).toBe(false);
  });
});

describe("planCodeLabel", () => {
  it("names the known codes and passes others through", () => {
    expect(planCodeLabel("BR")).toBe("Business Registration");
    expect(planCodeLabel("ma")).toBe("Mailing Address");
    expect(planCodeLabel("GST")).toBe("GST");
    expect(planCodeLabel("VO")).toBe("VO");
  });
});
