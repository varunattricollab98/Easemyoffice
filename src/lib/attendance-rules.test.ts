import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkPunch,
  closedDayStatus,
  haversineMeters,
  istParts,
  lateMinutes,
  minutesBetween,
  overtimeMinutes,
  summarizeMonth,
  type AttendanceDayRecord,
  type PunchCheckInput,
} from "./attendance-rules";

// ~ Connaught Place, New Delhi.
const OFFICE = { latitude: 28.6315, longitude: 77.2167, radius_m: 100, max_accuracy_m: 50 };
// ~55 m north of OFFICE (0.0005° latitude ≈ 55.6 m).
const NEAR = { latitude: 28.632, longitude: 77.2167 };
// ~1.1 km north.
const FAR = { latitude: 28.6415, longitude: 77.2167 };

const base: PunchCheckInput = {
  requireGeofence: true,
  requireDeviceApproval: false,
  deviceStatus: "approved",
  office: OFFICE,
  latitude: NEAR.latitude,
  longitude: NEAR.longitude,
  accuracy: 20,
};

describe("shared copy", () => {
  it("is byte-identical to the edge function's copy", () => {
    const root = process.cwd();
    const a = readFileSync(resolve(root, "src/lib/attendance-rules.ts"), "utf8");
    const b = readFileSync(resolve(root, "supabase/functions/_shared/attendance-rules.ts"), "utf8");
    expect(b).toBe(a);
  });
});

describe("istParts", () => {
  it("rolls the date over at Indian midnight, not UTC midnight", () => {
    // 18:29 UTC = 23:59 IST, 18:31 UTC = 00:01 IST next day.
    expect(istParts(new Date("2026-09-30T18:29:00Z"))).toEqual({
      date: "2026-09-30",
      minutes: 23 * 60 + 59,
      weekday: 3,
    });
    expect(istParts(new Date("2026-09-30T18:31:00Z")).date).toBe("2026-10-01");
  });

  it("gives minutes since Indian midnight", () => {
    // 04:00 UTC = 09:30 IST.
    expect(istParts(new Date("2026-09-30T04:00:00Z")).minutes).toBe(570);
  });
});

describe("haversineMeters", () => {
  it("is ~55 m for 0.0005° of latitude", () => {
    const d = haversineMeters(OFFICE.latitude, OFFICE.longitude, NEAR.latitude, NEAR.longitude);
    expect(d).toBeGreaterThan(54);
    expect(d).toBeLessThan(57);
  });
});

describe("checkPunch", () => {
  it("accepts a precise fix inside the radius and reports the distance", () => {
    const r = checkPunch(base);
    expect(r.ok).toBe(true);
    expect(r.distance_m).toBeGreaterThan(50);
    expect(r.distance_m).toBeLessThan(60);
  });

  it("rejects outside the radius", () => {
    expect(checkPunch({ ...base, ...FAR })).toMatchObject({
      ok: false,
      reason: "outside_geofence",
    });
  });

  it("rejects a vague fix even when it centres on the office", () => {
    expect(
      checkPunch({
        ...base,
        latitude: OFFICE.latitude,
        longitude: OFFICE.longitude,
        accuracy: 900,
      }),
    ).toMatchObject({ ok: false, reason: "low_accuracy" });
  });

  it("rejects when there is no fix", () => {
    expect(checkPunch({ ...base, latitude: null, longitude: null, accuracy: null })).toMatchObject({
      ok: false,
      reason: "no_location",
    });
  });

  it("rejects when no office is configured", () => {
    expect(checkPunch({ ...base, office: null })).toMatchObject({ ok: false, reason: "no_office" });
  });

  it("skips location checks when the geofence is off but still records distance", () => {
    const r = checkPunch({ ...base, ...FAR, requireGeofence: false });
    expect(r.ok).toBe(true);
    expect(r.distance_m).toBeGreaterThan(1000);
  });

  it("blocks a revoked device even with approval switched off and no geofence", () => {
    expect(checkPunch({ ...base, deviceStatus: "revoked", requireGeofence: false })).toMatchObject({
      ok: false,
      reason: "device_revoked",
    });
  });

  it("requires an approved device only when approval is on", () => {
    expect(checkPunch({ ...base, deviceStatus: "pending" }).ok).toBe(true);
    expect(
      checkPunch({ ...base, deviceStatus: "pending", requireDeviceApproval: true }),
    ).toMatchObject({ ok: false, reason: "device_not_approved" });
    expect(checkPunch({ ...base, deviceStatus: "new", requireDeviceApproval: true })).toMatchObject(
      { ok: false, reason: "device_not_approved" },
    );
  });

  it("checks the device before the location", () => {
    expect(checkPunch({ ...base, ...FAR, deviceStatus: "revoked" })).toMatchObject({
      reason: "device_revoked",
    });
  });
});

describe("lateMinutes", () => {
  it("is zero up to and including the grace period", () => {
    expect(lateMinutes(9 * 60 + 30, "09:30", 15)).toBe(0);
    expect(lateMinutes(9 * 60 + 45, "09:30:00", 15)).toBe(0);
  });

  it("counts from the start time, not from the end of grace", () => {
    expect(lateMinutes(9 * 60 + 46, "09:30", 15)).toBe(16);
  });

  it("is zero for early arrivals", () => {
    expect(lateMinutes(8 * 60, "09:30", 15)).toBe(0);
  });
});

describe("day status and overtime", () => {
  it("is a half day below the threshold, present at or above it", () => {
    expect(closedDayStatus(239, 240)).toBe("half_day");
    expect(closedDayStatus(240, 240)).toBe("present");
  });

  it("counts overtime beyond the required minutes only", () => {
    expect(overtimeMinutes(500, 510)).toBe(0);
    expect(overtimeMinutes(560, 510)).toBe(50);
  });

  it("measures whole minutes and never goes negative", () => {
    expect(minutesBetween("2026-09-30T04:00:00Z", "2026-09-30T12:30:59Z")).toBe(510);
    expect(minutesBetween("2026-09-30T05:00:00Z", "2026-09-30T04:00:00Z")).toBe(0);
  });
});

describe("summarizeMonth", () => {
  // September 2026: 1st is a Tuesday. Week-offs Sat + Sun → 22 working days.
  const rec = (work_date: string, r: Partial<AttendanceDayRecord> = {}): AttendanceDayRecord => ({
    work_date,
    status: "present",
    is_late: false,
    worked_minutes: 510,
    open_since: null,
    ...r,
  });

  const run = (
    records: AttendanceDayRecord[],
    extra: Partial<Parameters<typeof summarizeMonth>[0]> = {},
  ) =>
    summarizeMonth({
      year: 2026,
      month: 9,
      today: "2026-09-10",
      records,
      holidays: [{ date: "2026-09-04", name: "Test holiday" }],
      weekOffs: [0, 6],
      requiredMinutes: 510,
      ...extra,
    });

  it("counts working days without week-offs and holidays", () => {
    const { stats, days } = run([]);
    expect(days).toHaveLength(30);
    expect(stats.workingDays).toBe(21); // 22 weekdays − 1 holiday
    expect(days[3]).toMatchObject({
      date: "2026-09-04",
      kind: "holiday",
      holidayName: "Test holiday",
    });
    expect(days[5]).toMatchObject({ date: "2026-09-06", kind: "week_off" });
  });

  it("marks past working days without attendance absent, but never today", () => {
    const { stats, days } = run([]);
    // 1–9 Sep weekdays: 1,2,3,(4 holiday),7,8,9 → 6 absent.
    expect(stats.absent).toBe(6);
    expect(days[9]).toMatchObject({ date: "2026-09-10", kind: "today" });
    expect(days[10].kind).toBe("upcoming");
  });

  it("flags a past login without logout as action needed and today's as in progress", () => {
    const { stats, days } = run([
      rec("2026-09-08", {
        status: "in_progress",
        open_since: "2026-09-08T04:00:00Z",
        worked_minutes: 0,
      }),
      rec("2026-09-10", {
        status: "in_progress",
        open_since: "2026-09-10T04:00:00Z",
        worked_minutes: 0,
      }),
    ]);
    expect(days[7].kind).toBe("action_needed");
    expect(days[9].kind).toBe("in_progress");
    expect(stats.actionNeeded).toBe(1);
  });

  it("totals present, half days, late and overtime", () => {
    const { stats } = run([
      rec("2026-09-01", { is_late: true }),
      rec("2026-09-02", { worked_minutes: 570 }),
      rec("2026-09-03", { status: "half_day", worked_minutes: 200 }),
    ]);
    expect(stats.present).toBe(2);
    expect(stats.halfDays).toBe(1);
    expect(stats.late).toBe(1);
    expect(stats.workedMinutes).toBe(510 + 570 + 200);
    expect(stats.overtimeMinutes).toBe(60);
    expect(stats.absent).toBe(3); // 7, 8, 9
  });

  it("treats all work on a week-off as overtime and does not count it as a working day", () => {
    const { stats, days } = run([rec("2026-09-05", { worked_minutes: 240 })]);
    expect(days[4]).toMatchObject({ kind: "present", nonWorking: true });
    expect(stats.overtimeMinutes).toBe(240);
    expect(stats.present).toBe(0);
  });

  it("does not mark days before joining as absent", () => {
    const { stats, days } = run([], { joiningDate: "2026-09-08" });
    expect(days[0].kind).toBe("not_employed");
    expect(stats.absent).toBe(2); // the 8th and 9th
  });
});
