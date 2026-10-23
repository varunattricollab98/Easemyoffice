import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addDays,
  checkPunch,
  closeDay,
  decimalPlaces,
  expandLeave,
  haversineMeters,
  istParts,
  latestOnTimeStart,
  lateMinutes,
  leaveLedger,
  minutesBetween,
  normalizeSchedules,
  regularizedAttendance,
  remoteDayAttendance,
  spoofSignals,
  summarizeMonth,
  validateAttendanceRequest,
  validateManualAttendanceEntry,
  windowMinutes,
  ATTENDANCE_REQUEST_AHEAD_DAYS,
  ATTENDANCE_REQUEST_BACKDATE_DAYS,
  MANUAL_ATTENDANCE_BACKDATE_DAYS,
  DEFAULT_LEAVE_POLICY,
  DEFAULT_SCHEDULES,
  MAX_TRAVEL_KMH,
  MIN_TRAVEL_CHECK_M,
  SPOOF_SIGNAL_LABELS,
  type AttendanceDayRecord,
  type PunchCheckInput,
  type SpoofSignal,
} from "./attendance-rules";

// ~ Connaught Place, New Delhi.
const OFFICE = { latitude: 28.6315, longitude: 77.2167, radius_m: 100, max_accuracy_m: 50 };
// ~55 m north of OFFICE (0.0005° latitude ≈ 55.6 m).
const NEAR = { latitude: 28.632, longitude: 77.2167 };
// ~1.1 km north.
const FAR = { latitude: 28.6415, longitude: 77.2167 };

const FLEX = DEFAULT_SCHEDULES[1]; // Mon: 9h between 09:00 and 19:30
const SAT = DEFAULT_SCHEDULES[6]; // fixed 10:00–17:00

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
  it("is byte-identical to the edge functions' copy", () => {
    const root = process.cwd();
    const a = readFileSync(resolve(root, "src/lib/attendance-rules.ts"), "utf8");
    const b = readFileSync(resolve(root, "supabase/functions/_shared/attendance-rules.ts"), "utf8");
    expect(b).toBe(a);
  });
});

describe("istParts / dates", () => {
  it("rolls the date over at Indian midnight, not UTC midnight", () => {
    // 18:29 UTC = 23:59 IST, 18:31 UTC = 00:01 IST next day.
    expect(istParts(new Date("2026-09-30T18:29:00Z"))).toEqual({
      date: "2026-09-30",
      minutes: 23 * 60 + 59,
      weekday: 3,
    });
    expect(istParts(new Date("2026-09-30T18:31:00Z")).date).toBe("2026-10-01");
  });

  it("adds days across month ends", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
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

  it("rejects when there is no fix or no office", () => {
    expect(checkPunch({ ...base, latitude: null, longitude: null, accuracy: null })).toMatchObject({
      reason: "no_location",
    });
    expect(checkPunch({ ...base, office: null })).toMatchObject({ reason: "no_office" });
  });

  it("skips location checks when the geofence is off but still records distance", () => {
    const r = checkPunch({ ...base, ...FAR, requireGeofence: false });
    expect(r.ok).toBe(true);
    expect(r.distance_m).toBeGreaterThan(1000);
  });

  it("blocks revoked devices always and unapproved ones only when approval is on", () => {
    expect(checkPunch({ ...base, deviceStatus: "revoked", requireGeofence: false })).toMatchObject({
      reason: "device_revoked",
    });
    expect(checkPunch({ ...base, deviceStatus: "pending" }).ok).toBe(true);
    expect(checkPunch({ ...base, deviceStatus: "new", requireDeviceApproval: true })).toMatchObject(
      { reason: "device_not_approved" },
    );
  });

  it("checks the device before the location", () => {
    expect(checkPunch({ ...base, ...FAR, deviceStatus: "revoked" })).toMatchObject({
      reason: "device_revoked",
    });
  });
});

describe("schedules", () => {
  it("encodes the company policy by default", () => {
    expect(DEFAULT_SCHEDULES[0].mode).toBe("off");
    expect(FLEX).toMatchObject({
      mode: "flexible",
      start: "09:00",
      end: "19:30",
      required_minutes: 540,
    });
    expect(SAT).toMatchObject({
      mode: "fixed",
      start: "10:00",
      end: "17:00",
      required_minutes: 420,
    });
  });

  it("falls back per day on bad data and forces a fixed day's requirement to its span", () => {
    const s = normalizeSchedules([
      { mode: "nonsense" },
      { mode: "fixed", start: "09:00", end: "18:00", required_minutes: 5 },
    ]);
    expect(s[0]).toEqual(DEFAULT_SCHEDULES[0]);
    expect(s[1].required_minutes).toBe(540);
    expect(s[2]).toEqual(DEFAULT_SCHEDULES[2]);
    expect(normalizeSchedules(null)).toEqual(DEFAULT_SCHEDULES);
  });

  it("caps a flexible requirement at the window length", () => {
    const [, mon] = normalizeSchedules([
      DEFAULT_SCHEDULES[0],
      { mode: "flexible", start: "10:00", end: "12:00", required_minutes: 540 },
    ]);
    expect(mon.required_minutes).toBe(120);
  });
});

describe("lateMinutes", () => {
  it("flexible days are late only once 9h no longer fits the window (after 10:30)", () => {
    expect(latestOnTimeStart(FLEX, 15)).toBe(10 * 60 + 30);
    expect(lateMinutes(10 * 60 + 30, FLEX, 15)).toBe(0);
    expect(lateMinutes(10 * 60 + 45, FLEX, 15)).toBe(15);
    expect(lateMinutes(8 * 60, FLEX, 15)).toBe(0);
  });

  it("fixed days count from the start time once past the grace", () => {
    expect(lateMinutes(10 * 60 + 15, SAT, 15)).toBe(0);
    expect(lateMinutes(10 * 60 + 16, SAT, 15)).toBe(16);
  });

  it("is never late on an off day", () => {
    expect(lateMinutes(23 * 60, DEFAULT_SCHEDULES[0], 15)).toBe(0);
  });
});

describe("windowMinutes", () => {
  // 2026-10-05 is a Monday. 03:00Z = 08:30 IST.
  it("only counts time inside the window", () => {
    expect(windowMinutes("2026-10-05T03:00:00Z", "2026-10-05T05:30:00Z", "2026-10-05", FLEX)).toBe(
      120, // 09:00–11:00, not 08:30–11:00
    );
    // 13:00Z = 18:30 IST → 15:00Z = 20:30 IST: only 18:30–19:30 counts.
    expect(windowMinutes("2026-10-05T13:00:00Z", "2026-10-05T15:00:00Z", "2026-10-05", FLEX)).toBe(
      60,
    );
  });

  it("is zero on an off day or outside the window", () => {
    expect(
      windowMinutes(
        "2026-10-04T04:00:00Z",
        "2026-10-04T10:00:00Z",
        "2026-10-04",
        DEFAULT_SCHEDULES[0],
      ),
    ).toBe(0);
    expect(windowMinutes("2026-10-05T15:00:00Z", "2026-10-05T16:00:00Z", "2026-10-05", FLEX)).toBe(
      0,
    );
  });
});

describe("closeDay", () => {
  const day = { requiredMinutes: 540, halfDayMinutes: 240, mode: "flexible" as const };
  it("is present once the in-window time meets the requirement; extra logged time is overtime", () => {
    expect(closeDay({ ...day, workedMinutes: 600, windowMinutes: 540 })).toEqual({
      status: "present",
      overtimeMinutes: 60,
    });
  });

  it("marks an early logout as short and a very short day as half", () => {
    expect(closeDay({ ...day, workedMinutes: 420, windowMinutes: 420 }).status).toBe("short");
    expect(closeDay({ ...day, workedMinutes: 200, windowMinutes: 200 }).status).toBe("half_day");
  });

  it("does not let out-of-window time complete the day", () => {
    expect(closeDay({ ...day, workedMinutes: 600, windowMinutes: 500 })).toEqual({
      status: "short",
      overtimeMinutes: 0,
    });
  });

  it("treats all work on an off day as overtime", () => {
    expect(
      closeDay({
        workedMinutes: 180,
        windowMinutes: 0,
        requiredMinutes: 0,
        halfDayMinutes: 240,
        mode: "off",
      }),
    ).toEqual({ status: "present", overtimeMinutes: 180 });
  });

  it("measures whole minutes and never goes negative", () => {
    expect(minutesBetween("2026-09-30T04:00:00Z", "2026-09-30T12:30:59Z")).toBe(510);
    expect(minutesBetween("2026-09-30T05:00:00Z", "2026-09-30T04:00:00Z")).toBe(0);
  });
});

describe("leave", () => {
  it("counts only working days (Sunday off, Saturday working)", () => {
    // Fri 2 Oct → Mon 5 Oct 2026 with a holiday on Fri.
    const days = expandLeave("2026-10-02", "2026-10-05", false, DEFAULT_SCHEDULES, ["2026-10-02"]);
    expect(days.map((d) => d.date)).toEqual(["2026-10-03", "2026-10-05"]);
  });

  it("supports a single half day", () => {
    expect(expandLeave("2026-10-05", "2026-10-05", true, DEFAULT_SCHEDULES, [])).toEqual([
      { date: "2026-10-05", amount: 0.5 },
    ]);
  });

  it("grants 2 a month and carries at most 1 forward", () => {
    const ledger = leaveLedger({
      policy: DEFAULT_LEAVE_POLICY,
      approved: [
        // Oct: none taken → 1 carries (cap), Nov has 3.
        // Nov: 3 taken → all paid, 0 carries. Dec: 4 taken → 2 paid, 2 unpaid.
        { date: "2026-11-02", amount: 1 },
        { date: "2026-11-03", amount: 1 },
        { date: "2026-11-04", amount: 1 },
        { date: "2026-12-01", amount: 1 },
        { date: "2026-12-02", amount: 1 },
        { date: "2026-12-03", amount: 1 },
        { date: "2026-12-04", amount: 1 },
      ],
      untilMonth: "2027-01",
    });
    expect(ledger.get("2026-10")).toMatchObject({ available: 2, paid: 0, carryOut: 1 });
    expect(ledger.get("2026-11")).toMatchObject({
      carriedIn: 1,
      available: 3,
      paid: 3,
      carryOut: 0,
    });
    expect(ledger.get("2026-12")).toMatchObject({ available: 2, paid: 2, unpaid: 2, carryOut: 0 });
    expect(ledger.get("2027-01")).toMatchObject({ available: 2 });
  });

  it("carries a partial leave when one of two is used", () => {
    const ledger = leaveLedger({
      policy: DEFAULT_LEAVE_POLICY,
      approved: [{ date: "2026-10-05", amount: 1 }],
      untilMonth: "2026-11",
    });
    expect(ledger.get("2026-11")).toMatchObject({ carriedIn: 1, available: 3 });
  });

  it("starts the ledger at joining when that is later than the policy", () => {
    const ledger = leaveLedger({
      policy: DEFAULT_LEAVE_POLICY,
      joiningDate: "2026-12-10",
      approved: [],
      untilMonth: "2027-01",
    });
    expect(ledger.has("2026-10")).toBe(false);
    expect(ledger.get("2027-01")).toMatchObject({ carriedIn: 1, available: 3 });
  });
});

describe("summarizeMonth", () => {
  // October 2026: 1st is a Thursday. Sundays off (4, 11, 18, 25) → 27 working days.
  const rec = (work_date: string, r: Partial<AttendanceDayRecord> = {}): AttendanceDayRecord => ({
    work_date,
    status: "present",
    is_late: false,
    worked_minutes: 540,
    window_minutes: 540,
    required_minutes: 540,
    idle_minutes: 0,
    open_since: null,
    work_mode: "office",
    remote_status: null,
    ...r,
  });

  const run = (
    records: AttendanceDayRecord[],
    extra: Partial<Parameters<typeof summarizeMonth>[0]> = {},
  ) =>
    summarizeMonth({
      year: 2026,
      month: 10,
      today: "2026-10-10",
      records,
      holidays: [{ date: "2026-10-02", name: "Gandhi Jayanti" }],
      schedules: DEFAULT_SCHEDULES,
      halfDayMinutes: 240,
      paidLeaveAvailable: 2,
      ...extra,
    });

  it("counts Saturdays as working days and Sundays/holidays as off", () => {
    const { stats, days } = run([]);
    expect(stats.workingDays).toBe(26); // 27 − Gandhi Jayanti
    expect(days[1]).toMatchObject({ kind: "holiday", holidayName: "Gandhi Jayanti" });
    expect(days[3]).toMatchObject({ date: "2026-10-04", kind: "week_off" });
    expect(days[2].requiredMinutes).toBe(420); // Saturday 3rd
  });

  it("marks past working days without attendance or leave absent, never today", () => {
    const { stats, days } = run([]);
    // 1,3,5,6,7,8,9 → 7 absent.
    expect(stats.absent).toBe(7);
    expect(days[9]).toMatchObject({ date: "2026-10-10", kind: "today" });
  });

  it("totals present, early logouts, late, overtime and idle", () => {
    const { stats } = run([
      rec("2026-10-01", { is_late: true, idle_minutes: 70 }),
      rec("2026-10-05", { worked_minutes: 600, window_minutes: 570 }),
      rec("2026-10-06", { status: "short", worked_minutes: 420, window_minutes: 420 }),
    ]);
    expect(stats.present).toBe(2);
    expect(stats.short).toBe(1);
    expect(stats.late).toBe(1);
    expect(stats.idleMinutes).toBe(70);
    expect(stats.overtimeMinutes).toBe(60);
    expect(stats.workedMinutes).toBe(540 + 570 + 420);
  });

  it("counts WFH only once approved and a rejected WFH as absent", () => {
    const { stats, days } = run([
      rec("2026-10-05", { work_mode: "remote", remote_status: "approved" }),
      rec("2026-10-06", { work_mode: "remote", remote_status: "pending" }),
      rec("2026-10-07", { work_mode: "remote", remote_status: "rejected" }),
    ]);
    expect(days[4]).toMatchObject({ kind: "present", remote: true });
    expect(days[5].kind).toBe("remote_pending");
    expect(days[6].kind).toBe("remote_rejected");
    expect(stats.remoteDays).toBe(1);
    expect(stats.remotePending).toBe(1);
    expect(stats.present).toBe(1);
  });

  it("uses the paid balance in date order and the rest is unpaid", () => {
    const { stats, days } = run([], {
      leaves: [
        { date: "2026-10-05", amount: 1, status: "approved" },
        { date: "2026-10-06", amount: 1, status: "approved" },
        { date: "2026-10-07", amount: 1, status: "approved" },
        { date: "2026-10-12", amount: 1, status: "pending" },
      ],
    });
    expect(days[4].kind).toBe("paid_leave");
    expect(days[5].kind).toBe("paid_leave");
    expect(days[6].kind).toBe("unpaid_leave");
    expect(days[11].kind).toBe("leave_pending");
    expect(stats.paidLeave).toBe(2);
    expect(stats.unpaidLeave).toBe(1);
    expect(stats.pendingLeave).toBe(1);
    expect(stats.absent).toBe(4); // 1, 3, 8, 9
  });

  it("a half-day leave halves the requirement so 4.5h completes the day", () => {
    const { days, stats } = run(
      [rec("2026-10-05", { status: "short", worked_minutes: 270, window_minutes: 270 })],
      {
        leaves: [{ date: "2026-10-05", amount: 0.5, status: "approved" }],
      },
    );
    expect(days[4]).toMatchObject({ kind: "present", requiredMinutes: 270, leave: 0.5 });
    expect(stats.paidLeave).toBe(0.5);
  });

  it("flags a past login without logout", () => {
    const { stats, days } = run([
      rec("2026-10-08", {
        status: "in_progress",
        open_since: "2026-10-08T04:00:00Z",
        window_minutes: 0,
      }),
    ]);
    expect(days[7].kind).toBe("action_needed");
    expect(stats.actionNeeded).toBe(1);
  });

  it("does not mark days before joining as absent", () => {
    const { stats, days } = run([], { joiningDate: "2026-10-08" });
    expect(days[0].kind).toBe("not_employed");
    expect(stats.absent).toBe(2); // 8th and 9th
  });
});

describe("validateAttendanceRequest", () => {
  // 2026-10-10 is a Saturday; the backdate window reaches back to 2026-10-03.
  const TODAY = "2026-10-10";

  it("accepts a WFH day planned ahead and defaults the range to one day", () => {
    const r = validateAttendanceRequest({
      type: "work_from_home",
      work_date: "2026-10-20",
      reason: "Internet work from home",
      today: TODAY,
    });
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.normalized).toMatchObject({
        type: "work_from_home",
        from_date: "2026-10-20",
        to_date: "2026-10-20",
        reason: "Internet work from home",
        requested_login_minutes: null,
        requested_logout_minutes: null,
      });
  });

  it("accepts a WFH multi-day range and trims the reason", () => {
    const r = validateAttendanceRequest({
      type: "work_from_home",
      work_date: "2026-10-20",
      to_date: "2026-10-22",
      reason: "  Out of town  ",
      today: TODAY,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized).toMatchObject({ to_date: "2026-10-22", reason: "Out of town" });
  });

  it("rejects a reason shorter than 3 characters", () => {
    const r = validateAttendanceRequest({
      type: "work_from_home",
      work_date: TODAY,
      reason: "ok",
      today: TODAY,
    });
    expect(r).toMatchObject({ ok: false });
  });

  it("rejects a date beyond the backdate window", () => {
    const tooFar = addDays(TODAY, -(ATTENDANCE_REQUEST_BACKDATE_DAYS + 1));
    const r = validateAttendanceRequest({
      type: "absence_clarification",
      work_date: tooFar,
      reason: "Was on client site",
      today: TODAY,
    });
    expect(r).toMatchObject({ ok: false });
    // One day inside the window is accepted.
    const ok = validateAttendanceRequest({
      type: "absence_clarification",
      work_date: addDays(TODAY, -ATTENDANCE_REQUEST_BACKDATE_DAYS),
      reason: "Was on client site",
      today: TODAY,
    });
    expect(ok.ok).toBe(true);
  });

  it("forbids a future date for the two past-only kinds but allows it for WFH", () => {
    const future = addDays(TODAY, 1);
    expect(
      validateAttendanceRequest({
        type: "absence_clarification",
        work_date: future,
        reason: "placeholder",
        today: TODAY,
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateAttendanceRequest({
        type: "missed_login_regularization",
        work_date: future,
        reason: "placeholder",
        requested_login_minutes: 600,
        today: TODAY,
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateAttendanceRequest({
        type: "work_from_home",
        work_date: future,
        reason: "planned",
        today: TODAY,
      }).ok,
    ).toBe(true);
  });

  it("rejects a WFH date past the ahead window", () => {
    const r = validateAttendanceRequest({
      type: "work_from_home",
      work_date: addDays(TODAY, ATTENDANCE_REQUEST_AHEAD_DAYS + 1),
      reason: "too far ahead",
      today: TODAY,
    });
    expect(r).toMatchObject({ ok: false });
  });

  it("forbids a multi-day range for the past-only kinds", () => {
    const r = validateAttendanceRequest({
      type: "absence_clarification",
      work_date: "2026-10-05",
      to_date: "2026-10-06",
      reason: "two days",
      today: TODAY,
    });
    expect(r).toMatchObject({ ok: false });
  });

  it("requires a login time for a missed-login regularization", () => {
    const r = validateAttendanceRequest({
      type: "missed_login_regularization",
      work_date: "2026-10-05",
      reason: "Forgot to punch in",
      today: TODAY,
    });
    expect(r).toMatchObject({ ok: false });
  });

  it("rejects a logout at or before the login and accepts a valid pair", () => {
    const bad = validateAttendanceRequest({
      type: "missed_login_regularization",
      work_date: "2026-10-05",
      reason: "Forgot to punch",
      requested_login_minutes: 600,
      requested_logout_minutes: 600,
      today: TODAY,
    });
    expect(bad).toMatchObject({ ok: false });
    const ok = validateAttendanceRequest({
      type: "missed_login_regularization",
      work_date: "2026-10-05",
      reason: "Forgot to punch",
      requested_login_minutes: 600,
      requested_logout_minutes: 1080,
      today: TODAY,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok)
      expect(ok.normalized).toMatchObject({
        from_date: "2026-10-05",
        to_date: "2026-10-05",
        requested_login_minutes: 600,
        requested_logout_minutes: 1080,
      });
  });
});

describe("regularizedAttendance", () => {
  const FLEX = DEFAULT_SCHEDULES[1]; // Mon flexible 09:00–19:30, 540 required
  const SAT = DEFAULT_SCHEDULES[6]; // fixed 10:00–17:00, 420 required

  it("computes a normal flexible day: on-time, worked/window/overtime from closeDay", () => {
    // 2026-10-05 Monday, 09:00 (540) → 19:00 (1140): 10h worked, window 09:00–19:00.
    const r = regularizedAttendance({
      schedule: FLEX,
      halfDayMinutes: 240,
      graceMinutes: 15,
      work_date: "2026-10-05",
      requested_login_minutes: 540,
      requested_logout_minutes: 1140,
    });
    expect(r.first_login_at).toBe("2026-10-05T03:30:00.000Z"); // 09:00 IST
    expect(r.last_logout_at).toBe("2026-10-05T13:30:00.000Z"); // 19:00 IST
    expect(r.worked_minutes).toBe(600);
    expect(r.window_minutes).toBe(600); // all inside 09:00–19:30
    expect(r.is_late).toBe(false);
    expect(r.late_minutes).toBe(0);
    expect(r.status).toBe("present");
    expect(r.overtime_minutes).toBe(60); // 600 − 540
  });

  it("flags a late login on a fixed day", () => {
    // Saturday fixed 10:00: login 10:45 (645) is 45 min late past 15 grace.
    const r = regularizedAttendance({
      schedule: SAT,
      halfDayMinutes: 240,
      graceMinutes: 15,
      work_date: "2026-10-03",
      requested_login_minutes: 645,
      requested_logout_minutes: 1020, // 17:00
    });
    expect(r.is_late).toBe(true);
    expect(r.late_minutes).toBe(45);
  });

  it("yields short/half_day when the in-window time falls below the requirement", () => {
    // Flexible day, 09:00 → 14:00: 300 worked, below 540 but above half-day 240.
    const short = regularizedAttendance({
      schedule: FLEX,
      halfDayMinutes: 240,
      graceMinutes: 15,
      work_date: "2026-10-05",
      requested_login_minutes: 540,
      requested_logout_minutes: 840,
    });
    expect(short.status).toBe("short");
    expect(short.overtime_minutes).toBe(0);
    // 09:00 → 12:00: 180 worked, below the 240 half-day threshold.
    const half = regularizedAttendance({
      schedule: FLEX,
      halfDayMinutes: 240,
      graceMinutes: 15,
      work_date: "2026-10-05",
      requested_login_minutes: 540,
      requested_logout_minutes: 720,
    });
    expect(half.status).toBe("half_day");
  });

  it("credits a full flexible weekday as present with concrete worked/window minutes", () => {
    // The owner's common admin case: a normal 09:00→18:00 day on a flexible
    // weekday (540 required) is exactly present, no overtime, not late.
    const r = regularizedAttendance({
      schedule: FLEX,
      halfDayMinutes: 240,
      graceMinutes: 15,
      work_date: "2026-10-05", // Monday
      requested_login_minutes: 540, // 09:00
      requested_logout_minutes: 1080, // 18:00
    });
    expect(r.worked_minutes).toBe(540);
    expect(r.window_minutes).toBe(540);
    expect(r.status).toBe("present");
    expect(r.is_late).toBe(false);
    expect(r.late_minutes).toBe(0);
    expect(r.overtime_minutes).toBe(0);
  });

  it("credits an off-day entry as present with window 0 and all time overtime", () => {
    // An admin-entered day on a week-off (mode 'off', 0 required): the hours
    // worked are credited but none are inside a window, so the day is present
    // with window 0 and every worked minute is overtime — no fabricated
    // required hours (mirrors closeDay's off-day rule).
    const SUN = DEFAULT_SCHEDULES[0]; // off, 0 required
    const r = regularizedAttendance({
      schedule: SUN,
      halfDayMinutes: 240,
      graceMinutes: 15,
      work_date: "2026-10-04", // Sunday
      requested_login_minutes: 600, // 10:00
      requested_logout_minutes: 900, // 15:00
    });
    expect(r.worked_minutes).toBe(300);
    expect(r.window_minutes).toBe(0);
    expect(r.status).toBe("present");
    expect(r.is_late).toBe(false);
    expect(r.late_minutes).toBe(0);
    expect(r.overtime_minutes).toBe(300); // all of it is overtime
  });
});

describe("validateManualAttendanceEntry", () => {
  // 2026-10-10 is a Saturday.
  const TODAY = "2026-10-10";

  it("accepts a valid login + logout on a weekday and normalizes the values", () => {
    const r = validateManualAttendanceEntry({
      work_date: "2026-10-05", // Monday
      login_minutes: 540, // 09:00
      logout_minutes: 1080, // 18:00
      today: TODAY,
      backdateDays: MANUAL_ATTENDANCE_BACKDATE_DAYS,
    });
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.normalized).toEqual({
        work_date: "2026-10-05",
        login_minutes: 540,
        logout_minutes: 1080,
      });
  });

  it("accepts a login-only entry and leaves logout null", () => {
    const r = validateManualAttendanceEntry({
      work_date: "2026-10-05",
      login_minutes: 540,
      logout_minutes: null,
      today: TODAY,
      backdateDays: MANUAL_ATTENDANCE_BACKDATE_DAYS,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized.login_minutes).toBe(540);
      expect(r.normalized.logout_minutes).toBeNull();
    }
  });

  it("rejects a logout at or before the login", () => {
    const r = validateManualAttendanceEntry({
      work_date: "2026-10-05",
      login_minutes: 600,
      logout_minutes: 600,
      today: TODAY,
      backdateDays: MANUAL_ATTENDANCE_BACKDATE_DAYS,
    });
    expect(r).toMatchObject({
      ok: false,
      message: "The logout time must be after the login time.",
    });
  });

  it("rejects a future work_date", () => {
    const r = validateManualAttendanceEntry({
      work_date: addDays(TODAY, 1),
      login_minutes: 540,
      logout_minutes: 1080,
      today: TODAY,
      backdateDays: MANUAL_ATTENDANCE_BACKDATE_DAYS,
    });
    expect(r).toMatchObject({
      ok: false,
      message: "You cannot enter attendance for a future date.",
    });
  });

  it("rejects a date older than the back-date window and accepts the edge of it", () => {
    const tooFar = addDays(TODAY, -(MANUAL_ATTENDANCE_BACKDATE_DAYS + 1));
    const r = validateManualAttendanceEntry({
      work_date: tooFar,
      login_minutes: 540,
      logout_minutes: 1080,
      today: TODAY,
      backdateDays: MANUAL_ATTENDANCE_BACKDATE_DAYS,
    });
    expect(r.ok).toBe(false);
    // The oldest allowed day is accepted.
    const edge = validateManualAttendanceEntry({
      work_date: addDays(TODAY, -MANUAL_ATTENDANCE_BACKDATE_DAYS),
      login_minutes: 540,
      logout_minutes: 1080,
      today: TODAY,
      backdateDays: MANUAL_ATTENDANCE_BACKDATE_DAYS,
    });
    expect(edge.ok).toBe(true);
  });

  it("rejects a missing or out-of-range login", () => {
    const missing = validateManualAttendanceEntry({
      work_date: "2026-10-05",
      login_minutes: null,
      logout_minutes: null,
      today: TODAY,
      backdateDays: MANUAL_ATTENDANCE_BACKDATE_DAYS,
    });
    expect(missing).toMatchObject({ ok: false, message: "Enter the login time." });
    const outOfRange = validateManualAttendanceEntry({
      work_date: "2026-10-05",
      login_minutes: 1500, // > 24:00
      logout_minutes: null,
      today: TODAY,
      backdateDays: MANUAL_ATTENDANCE_BACKDATE_DAYS,
    });
    expect(outOfRange).toMatchObject({ ok: false, message: "Enter the login time." });
  });

  it("rejects an invalid date string", () => {
    const r = validateManualAttendanceEntry({
      work_date: "2026-13-40",
      login_minutes: 540,
      logout_minutes: 1080,
      today: TODAY,
      backdateDays: MANUAL_ATTENDANCE_BACKDATE_DAYS,
    });
    expect(r).toMatchObject({ ok: false, message: "Pick a valid date." });
  });
});

describe("remoteDayAttendance", () => {
  const FLEX = DEFAULT_SCHEDULES[1]; // Mon flexible 09:00–19:30, 540 required
  const SAT = DEFAULT_SCHEDULES[6]; // fixed 10:00–17:00, 420 required
  const SUN = DEFAULT_SCHEDULES[0]; // off, 0 required

  it("credits a full flexible weekday the scheduled hours as a present day", () => {
    // 2026-10-05 is a Monday: 09:00 start, 540 required → logout 18:00.
    const r = remoteDayAttendance({
      schedule: FLEX,
      halfDayMinutes: 240,
      graceMinutes: 15,
      work_date: "2026-10-05",
    });
    expect(r.worked_minutes).toBe(540);
    expect(r.window_minutes).toBe(540);
    expect(r.status).toBe("present");
    expect(r.is_late).toBe(false);
    expect(r.late_minutes).toBe(0);
    expect(r.overtime_minutes).toBe(0);
    expect(r.first_login_at).toBe("2026-10-05T03:30:00.000Z"); // 09:00 IST
    expect(r.last_logout_at).toBe("2026-10-05T12:30:00.000Z"); // 18:00 IST
  });

  it("credits a fixed day its whole window", () => {
    // 2026-10-03 Saturday fixed 10:00–17:00, 420 required.
    const r = remoteDayAttendance({
      schedule: SAT,
      halfDayMinutes: 240,
      graceMinutes: 15,
      work_date: "2026-10-03",
    });
    expect(r.worked_minutes).toBe(420);
    expect(r.window_minutes).toBe(420);
    expect(r.status).toBe("present");
    expect(r.overtime_minutes).toBe(0);
  });

  it("credits zero on a week-off but still reads as present", () => {
    // 2026-10-04 is a Sunday (off).
    const r = remoteDayAttendance({
      schedule: SUN,
      halfDayMinutes: 240,
      graceMinutes: 15,
      work_date: "2026-10-04",
    });
    expect(r.worked_minutes).toBe(0);
    expect(r.window_minutes).toBe(0);
    expect(r.status).toBe("present");
    expect(r.overtime_minutes).toBe(0);
    expect(r.first_login_at).toBe("2026-10-03T18:30:00.000Z"); // IST midnight of the 4th
    expect(r.last_logout_at).toBe("2026-10-03T18:30:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Fake-GPS detection (#220). "block" signals must be near-impossible for a
// real reading, because blocking a genuine fix stops someone from marking
// attendance at all; everything merely suspicious is warned about and
// alerted to the admin instead.
// ---------------------------------------------------------------------------

describe("decimalPlaces", () => {
  it("counts the digits as the number prints", () => {
    expect(decimalPlaces(28.4595)).toBe(4);
    expect(decimalPlaces(28.631512)).toBe(6);
    expect(decimalPlaces(28.5)).toBe(1);
    expect(decimalPlaces(28)).toBe(0);
    expect(decimalPlaces(-77.2167)).toBe(4);
  });

  it("treats exponential notation as precise rather than hand-typed", () => {
    // 1e-7 prints as "1e-7"; counting characters would say 0 decimals and
    // wrongly read a real (tiny) coordinate as typed by hand.
    expect(decimalPlaces(1e-7)).toBe(10);
  });
});

describe("spoofSignals", () => {
  const NOW = Date.UTC(2026, 9, 23, 4, 30); // 10:00 IST
  // A real phone fix near the office: plenty of decimals, several readings.
  const REAL = {
    latitude: 28.631512,
    longitude: 77.216734,
    accuracy: 12,
    nowMs: NOW,
    fixTimestampMs: NOW - 5_000,
    samples: 4,
    spreadM: 3.2,
  };

  it("passes a normal phone fix with nothing flagged", () => {
    expect(spoofSignals(REAL)).toEqual({ block: [], warn: [] });
  });

  it("blocks coordinates typed by hand (4 or fewer decimals on both axes)", () => {
    const { block } = spoofSignals({ ...REAL, latitude: 28.6315, longitude: 77.2167 });
    expect(block).toContain("low_precision");
  });

  it("does not block when only one axis is short", () => {
    // A genuine reading can land on a round value for one axis.
    expect(spoofSignals({ ...REAL, latitude: 28.6315 }).block).toEqual([]);
    expect(spoofSignals({ ...REAL, longitude: 77.2167 }).block).toEqual([]);
  });

  it("blocks whole-number coordinates", () => {
    expect(spoofSignals({ ...REAL, latitude: 28, longitude: 77 }).block).toContain("low_precision");
  });

  it("blocks impossible travel since the last accepted punch", () => {
    // Delhi → Mumbai (~1150 km) an hour after the previous punch.
    const previous = { latitude: 19.07609, longitude: 72.877426, atMs: NOW - 3_600_000 };
    const d = haversineMeters(previous.latitude, previous.longitude, REAL.latitude, REAL.longitude);
    expect(d).toBeGreaterThan(1_000_000);
    expect(spoofSignals({ ...REAL, previous }).block).toContain("impossible_travel");
  });

  it("allows the same distance when there was time to travel it", () => {
    // Same two cities, 12 hours apart — a normal flight or train.
    const previous = { latitude: 19.07609, longitude: 72.877426, atMs: NOW - 12 * 3_600_000 };
    expect(spoofSignals({ ...REAL, previous }).block).toEqual([]);
  });

  it("ignores speed over short distances", () => {
    // ~11 km in a minute is nonsense as a speed, but short hops are where GPS
    // error lives, so the rule only looks at jumps of 20 km or more.
    const previous = {
      latitude: REAL.latitude + 0.1,
      longitude: REAL.longitude,
      atMs: NOW - 60_000,
    };
    const d = haversineMeters(previous.latitude, previous.longitude, REAL.latitude, REAL.longitude);
    expect(d).toBeLessThan(MIN_TRAVEL_CHECK_M);
    expect(spoofSignals({ ...REAL, previous }).block).toEqual([]);
  });

  it("floors the elapsed time at a minute so two instant punches still trip", () => {
    // Without the floor, a near-zero gap divides by ~0 and the speed check
    // could be skipped or blow up.
    const previous = {
      latitude: REAL.latitude + 0.25, // ~27.6 km
      longitude: REAL.longitude,
      atMs: NOW - 1_000,
    };
    const d = haversineMeters(previous.latitude, previous.longitude, REAL.latitude, REAL.longitude);
    expect(d).toBeGreaterThan(MIN_TRAVEL_CHECK_M);
    expect(d / 1000 / (1 / 60)).toBeGreaterThan(MAX_TRAVEL_KMH);
    expect(spoofSignals({ ...REAL, previous }).block).toContain("impossible_travel");
  });

  it("has no travel opinion without a previous punch", () => {
    expect(spoofSignals({ ...REAL, previous: null }).block).toEqual([]);
    expect(spoofSignals({ ...REAL, previous: undefined }).block).toEqual([]);
  });

  it("warns about sub-metre accuracy", () => {
    // Consumer GPS does not do this; a mocking tool reports it happily.
    expect(spoofSignals({ ...REAL, accuracy: 0.5 }).warn).toContain("too_precise");
    expect(spoofSignals({ ...REAL, accuracy: 1 }).warn).not.toContain("too_precise");
  });

  it("warns about an exact repeat only when the fix was sharp", () => {
    // A laptop's Wi-Fi location repeats to the digit every day and is vague,
    // so only a precise repeat is worth reporting.
    expect(spoofSignals({ ...REAL, repeatOfEarlierDay: true, accuracy: 20 }).warn).toContain(
      "exact_repeat",
    );
    expect(spoofSignals({ ...REAL, repeatOfEarlierDay: true, accuracy: 2000 }).warn).not.toContain(
      "exact_repeat",
    );
    expect(spoofSignals({ ...REAL, repeatOfEarlierDay: false }).warn).not.toContain("exact_repeat");
  });

  it("warns when several readings did not move at all", () => {
    const frozen = { ...REAL, samples: 3, spreadM: 0, accuracy: 10 };
    expect(spoofSignals(frozen).warn).toContain("frozen_fix");
    // Needs at least three readings, real stillness and a sharp fix.
    expect(spoofSignals({ ...frozen, samples: 2 }).warn).not.toContain("frozen_fix");
    expect(spoofSignals({ ...frozen, spreadM: 0.4 }).warn).not.toContain("frozen_fix");
    expect(spoofSignals({ ...frozen, accuracy: 25 }).warn).not.toContain("frozen_fix");
  });

  it("warns when the reading is older than five minutes", () => {
    expect(spoofSignals({ ...REAL, fixTimestampMs: NOW - 6 * 60_000 }).warn).toContain("stale_fix");
    expect(spoofSignals({ ...REAL, fixTimestampMs: NOW - 4 * 60_000 }).warn).not.toContain(
      "stale_fix",
    );
    expect(spoofSignals({ ...REAL, fixTimestampMs: null }).warn).not.toContain("stale_fix");
  });

  it("stays quiet when the browser reported no accuracy", () => {
    // Every accuracy-based warning is gated on a real number, so a missing
    // one must not be treated as 0 (which would look impossibly precise).
    const { block, warn } = spoofSignals({
      ...REAL,
      accuracy: null,
      repeatOfEarlierDay: true,
      samples: 5,
      spreadM: 0,
    });
    expect(block).toEqual([]);
    expect(warn).toEqual([]);
  });

  it("reports every signal it finds at once", () => {
    const { block, warn } = spoofSignals({
      latitude: 28.6315,
      longitude: 77.2167,
      accuracy: 0.5,
      nowMs: NOW,
      fixTimestampMs: NOW - 10 * 60_000,
      samples: 4,
      spreadM: 0,
      repeatOfEarlierDay: true,
      previous: { latitude: 19.07609, longitude: 72.877426, atMs: NOW - 600_000 },
    });
    expect(block).toEqual(["low_precision", "impossible_travel"]);
    expect(warn).toEqual(["too_precise", "exact_repeat", "frozen_fix", "stale_fix"]);
  });

  it("has an admin-readable label for every signal", () => {
    const all: SpoofSignal[] = [
      "impossible_travel",
      "low_precision",
      "exact_repeat",
      "frozen_fix",
      "too_precise",
      "stale_fix",
    ];
    for (const s of all) expect(SPOOF_SIGNAL_LABELS[s]?.length ?? 0).toBeGreaterThan(5);
  });
});
