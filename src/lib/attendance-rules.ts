// Attendance, schedule and leave rules — pure functions shared by the browser
// and the HR edge functions.
//
// KEEP THIS FILE BYTE-IDENTICAL to supabase/functions/_shared/attendance-rules.ts
// (a unit test enforces it). The edge functions are the only things that ever
// decide whether a punch or request is accepted; the browser uses the same code
// to display the month and explain verdicts it already received. That is also
// why this file has no imports: it has to run unchanged under both Vite and Deno.

/** India has no daylight saving, so a fixed offset is exact. */
export const IST_OFFSET_MINUTES = 330;

/** Sessions left open longer than this cannot be closed by a normal logout. */
export const MAX_SESSION_MINUTES = 16 * 60;

export type PunchKind = "login" | "logout";

export type RejectionReason =
  | "not_linked"
  | "inactive_employee"
  | "device_revoked"
  | "device_not_approved"
  | "no_location"
  | "no_office"
  | "low_accuracy"
  | "outside_geofence"
  | "remote_reason_required"
  | "already_logged_in"
  | "not_logged_in"
  | "session_too_long";

export const REJECTION_MESSAGES: Record<RejectionReason, string> = {
  not_linked: "Your CRM login is not linked to an employee record. Ask the admin to link it.",
  inactive_employee: "Your employee record is not active, so attendance cannot be marked.",
  device_revoked: "This device has been blocked for attendance. Contact the admin.",
  device_not_approved: "This device is waiting for admin approval. Try again once it is approved.",
  no_location: "Location is required. Allow location access in the browser and try again.",
  no_office: "No office location is configured yet. Ask the admin to set it up.",
  low_accuracy: "Your GPS reading is too imprecise. Move near a window or step outside and retry.",
  outside_geofence: "You are outside the office area.",
  remote_reason_required: "Add a short reason for working from home.",
  already_logged_in: "You are already logged in.",
  not_logged_in: "You are not logged in, so there is nothing to log out of.",
  session_too_long:
    "Your last login is too old to close automatically. Ask the admin for a correction.",
};

/** Rejections that can be turned into a work-from-home request instead. */
export const REMOTE_ELIGIBLE: RejectionReason[] = ["outside_geofence", "low_accuracy"];

export type IstParts = {
  /** Calendar date in India, YYYY-MM-DD. */
  date: string;
  /** Minutes since midnight in India. */
  minutes: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Wall-clock parts of an instant in India. Attendance days are Indian calendar
 * days no matter where the server or the browser happens to run.
 */
export function istParts(at: Date): IstParts {
  const shifted = new Date(at.getTime() + IST_OFFSET_MINUTES * 60_000);
  const date = `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(
    shifted.getUTCDate(),
  )}`;
  return {
    date,
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

/** "09:30" or "09:30:00" -> 570. */
export function timeToMinutes(t: string): number {
  const [hh, mm] = String(t ?? "")
    .split(":")
    .map((v) => Number(v) || 0);
  return hh * 60 + mm;
}

/** 570 -> "09:30". */
export function minutesToTime(m: number): string {
  const v = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(v / 60))}:${pad2(v % 60)}`;
}

/** 0 = Sunday for a YYYY-MM-DD date. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** YYYY-MM-DD + n days. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** Great-circle distance in metres. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ---------------------------------------------------------------------------
// Weekly schedule
// ---------------------------------------------------------------------------

/**
 * off       — not a working day.
 * flexible  — complete `required_minutes` anywhere between start and end
 *             (Mon–Fri: 9h between 09:00 and 19:30).
 * fixed     — be there from start to end (Saturday: 10:00–17:00).
 */
export type ScheduleMode = "off" | "flexible" | "fixed";

export type DaySchedule = {
  mode: ScheduleMode;
  start: string;
  end: string;
  required_minutes: number;
};

const FLEX: DaySchedule = { mode: "flexible", start: "09:00", end: "19:30", required_minutes: 540 };

/** Index = weekday, 0 = Sunday. The company policy as of Oct 2026. */
export const DEFAULT_SCHEDULES: DaySchedule[] = [
  { mode: "off", start: "10:00", end: "17:00", required_minutes: 0 },
  FLEX,
  FLEX,
  FLEX,
  FLEX,
  FLEX,
  { mode: "fixed", start: "10:00", end: "17:00", required_minutes: 420 },
];

/**
 * Validates the stored jsonb schedule, falling back per day to the default.
 * A fixed day's requirement is always its full span, whatever was stored.
 */
export function normalizeSchedules(raw: unknown): DaySchedule[] {
  const arr = Array.isArray(raw) ? raw : [];
  return DEFAULT_SCHEDULES.map((fallback, i) => {
    const r = arr[i] as Partial<DaySchedule> | undefined;
    if (!r || (r.mode !== "off" && r.mode !== "flexible" && r.mode !== "fixed")) return fallback;
    const start = typeof r.start === "string" ? r.start.slice(0, 5) : fallback.start;
    const end = typeof r.end === "string" ? r.end.slice(0, 5) : fallback.end;
    const span = Math.max(0, timeToMinutes(end) - timeToMinutes(start));
    if (r.mode === "off") return { mode: "off", start, end, required_minutes: 0 };
    if (r.mode === "fixed") return { mode: "fixed", start, end, required_minutes: span };
    const req = Math.round(Number(r.required_minutes));
    return {
      mode: "flexible",
      start,
      end,
      required_minutes: Number.isFinite(req) && req > 0 ? Math.min(req, span) : Math.min(540, span),
    };
  });
}

/** Latest clock time (minutes) at which a login is still on time. */
export function latestOnTimeStart(s: DaySchedule, graceMinutes: number): number {
  if (s.mode === "fixed") return timeToMinutes(s.start) + (Number(graceMinutes) || 0);
  if (s.mode === "flexible") return timeToMinutes(s.end) - s.required_minutes;
  return 24 * 60;
}

/**
 * Minutes late.
 * - fixed: measured from the start time, once past the grace period (10:16 with
 *   a 10:00 start and 15 min grace is 16 minutes late, not 1).
 * - flexible: late only when the required hours no longer fit inside the window
 *   (after 10:30 for 9h between 09:00 and 19:30); measured from that point.
 * - off: never late.
 */
export function lateMinutes(loginMinutes: number, s: DaySchedule, graceMinutes: number): number {
  if (s.mode === "fixed") {
    const after = loginMinutes - timeToMinutes(s.start);
    return after > (Number(graceMinutes) || 0) ? after : 0;
  }
  if (s.mode === "flexible") return Math.max(0, loginMinutes - latestOnTimeStart(s, 0));
  return 0;
}

/** Epoch ms of midnight IST on a date. */
export function istMidnightMs(date: string): number {
  return Date.parse(`${date}T00:00:00+05:30`);
}

/**
 * Minutes of a session that fall inside the day's window. Only these count
 * toward the requirement — logging in at 08:30 on a flexible day starts the
 * clock at 09:00.
 */
export function windowMinutes(
  startIso: string,
  endIso: string,
  workDate: string,
  s: Pick<DaySchedule, "mode" | "start" | "end">,
): number {
  if (s.mode === "off") return 0;
  const base = istMidnightMs(workDate);
  const ws = base + timeToMinutes(s.start) * 60_000;
  const we = base + timeToMinutes(s.end) * 60_000;
  const a = Math.max(Date.parse(startIso), ws);
  const b = Math.min(Date.parse(endIso), we);
  return b > a ? Math.floor((b - a) / 60_000) : 0;
}

export type DayStatus = "in_progress" | "present" | "short" | "half_day";

/**
 * Status of a closed day.
 * - present: in-window time met the requirement. Everything logged beyond the
 *   requirement (including outside the window) is overtime.
 * - short: logged out early — at least the half-day threshold, below required.
 * - half_day: below the half-day threshold.
 * On an off day any work is present and all of it is overtime.
 */
export function closeDay(input: {
  workedMinutes: number;
  windowMinutes: number;
  requiredMinutes: number;
  halfDayMinutes: number;
  mode: ScheduleMode;
}): { status: DayStatus; overtimeMinutes: number } {
  if (input.mode === "off" || input.requiredMinutes <= 0)
    return { status: "present", overtimeMinutes: Math.round(input.workedMinutes) };
  if (input.windowMinutes >= input.requiredMinutes)
    return {
      status: "present",
      overtimeMinutes: Math.max(0, Math.round(input.workedMinutes - input.requiredMinutes)),
    };
  return {
    status: input.windowMinutes >= input.halfDayMinutes ? "short" : "half_day",
    overtimeMinutes: 0,
  };
}

/** Whole minutes between two ISO instants, never negative. */
export function minutesBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
}

// ---------------------------------------------------------------------------
// Punch checks
// ---------------------------------------------------------------------------

export type DeviceStatus = "new" | "pending" | "approved" | "revoked";

export type OfficeFence = {
  latitude: number;
  longitude: number;
  radius_m: number;
  max_accuracy_m: number;
};

export type PunchCheckInput = {
  requireGeofence: boolean;
  requireDeviceApproval: boolean;
  deviceStatus: DeviceStatus;
  office: OfficeFence | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
};

export type PunchCheckResult =
  | { ok: true; distance_m: number | null }
  | { ok: false; reason: RejectionReason; distance_m: number | null };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Device and location checks for a punch. Does not look at login state — that
 * needs the database and is checked by the caller afterwards.
 *
 * Order matters for the audit trail: the first failing rule is the recorded
 * reason, so the device (who) is checked before the location (where).
 */
export function checkPunch(input: PunchCheckInput): PunchCheckResult {
  const { office } = input;
  const hasFix = isNum(input.latitude) && isNum(input.longitude);
  // Distance is worth recording even when the geofence is switched off, so an
  // admin can see where people actually punched from.
  const distance_m =
    hasFix && office
      ? Math.round(
          haversineMeters(
            input.latitude as number,
            input.longitude as number,
            Number(office.latitude),
            Number(office.longitude),
          ),
        )
      : null;

  if (input.deviceStatus === "revoked") return { ok: false, reason: "device_revoked", distance_m };
  if (input.requireDeviceApproval && input.deviceStatus !== "approved")
    return { ok: false, reason: "device_not_approved", distance_m };

  if (!input.requireGeofence) return { ok: true, distance_m };

  if (!office) return { ok: false, reason: "no_office", distance_m };
  if (!hasFix || !isNum(input.accuracy)) return { ok: false, reason: "no_location", distance_m };
  if (input.accuracy > office.max_accuracy_m)
    return { ok: false, reason: "low_accuracy", distance_m };
  if ((distance_m as number) > office.radius_m)
    return { ok: false, reason: "outside_geofence", distance_m };
  return { ok: true, distance_m };
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

export type LeavePolicy = {
  /** Paid leaves granted each month. */
  monthlyQuota: number;
  /** Max unused leave carried into the next month. */
  carryCap: number;
  /** First date the policy applies, YYYY-MM-DD. */
  policyStart: string;
};

export const DEFAULT_LEAVE_POLICY: LeavePolicy = {
  monthlyQuota: 2,
  carryCap: 1,
  policyStart: "2026-10-01",
};

/**
 * Working days a leave request covers — week-offs and holidays inside the
 * range cost nothing. A half-day request is only valid for a single date.
 */
export function expandLeave(
  from: string,
  to: string,
  halfDay: boolean,
  schedules: DaySchedule[],
  holidayDates: Set<string> | string[],
): { date: string; amount: number }[] {
  const holidays = holidayDates instanceof Set ? holidayDates : new Set(holidayDates);
  const out: { date: string; amount: number }[] = [];
  if (!from || !to || to < from) return out;
  const amount = halfDay && from === to ? 0.5 : 1;
  for (let d = from, i = 0; d <= to && i < 366; d = addDays(d, 1), i++) {
    if (schedules[weekdayOf(d)]?.mode === "off" || holidays.has(d)) continue;
    out.push({ date: d, amount });
  }
  return out;
}

export type LedgerMonth = {
  /** YYYY-MM. */
  month: string;
  carriedIn: number;
  quota: number;
  available: number;
  /** Approved leave days dated in this month. */
  taken: number;
  paid: number;
  unpaid: number;
  carryOut: number;
};

const monthOf = (date: string) => date.slice(0, 7);

function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`;
}

/**
 * Month-by-month leave balance. Each month grants the quota; whatever is left
 * unused carries into the next month up to the cap (2 a month, 1 carried → at
 * most 3 available). Leave beyond the balance is unpaid (loss of pay).
 * Months before the policy start (or joining) get the quota with no carry.
 */
export function leaveLedger(input: {
  policy: LeavePolicy;
  joiningDate?: string | null;
  /** Approved leave, expanded to dates. */
  approved: { date: string; amount: number }[];
  /** Last month to compute, YYYY-MM. */
  untilMonth: string;
}): Map<string, LedgerMonth> {
  const { policy } = input;
  const taken = new Map<string, number>();
  for (const l of input.approved)
    taken.set(monthOf(l.date), (taken.get(monthOf(l.date)) ?? 0) + l.amount);
  let start = monthOf(policy.policyStart);
  if (input.joiningDate && monthOf(input.joiningDate) > start) start = monthOf(input.joiningDate);

  const out = new Map<string, LedgerMonth>();
  const row = (month: string, carriedIn: number): LedgerMonth => {
    const available = policy.monthlyQuota + carriedIn;
    const t = taken.get(month) ?? 0;
    const paid = Math.min(t, available);
    return {
      month,
      carriedIn,
      quota: policy.monthlyQuota,
      available,
      taken: t,
      paid,
      unpaid: t - paid,
      carryOut: Math.min(policy.carryCap, available - paid),
    };
  };
  // Months with leave before the start: quota only.
  for (const m of taken.keys()) if (m < start && m <= input.untilMonth) out.set(m, row(m, 0));
  let carry = 0;
  for (let m = start, i = 0; m <= input.untilMonth && i < 600; m = nextMonth(m), i++) {
    const r = row(m, carry);
    out.set(m, r);
    carry = r.carryOut;
  }
  return out;
}

/** Ledger entry for a month, or a fresh-quota entry when the month is not covered. */
export function ledgerFor(
  ledger: Map<string, LedgerMonth>,
  month: string,
  policy: LeavePolicy,
): LedgerMonth {
  return (
    ledger.get(month) ?? {
      month,
      carriedIn: 0,
      quota: policy.monthlyQuota,
      available: policy.monthlyQuota,
      taken: 0,
      paid: 0,
      unpaid: 0,
      carryOut: 0,
    }
  );
}

// ---------------------------------------------------------------------------
// Attendance requests
// ---------------------------------------------------------------------------

/**
 * The three kinds of attendance request an employee can raise:
 * - work_from_home: ask to count a day (or short range) as a remote day. May be
 *   raised ahead of time (planning) or for a recent past day.
 * - absence_clarification: explain a single day that already passed with no
 *   attendance (e.g. was on duty off-site). Never about the future.
 * - missed_login_regularization: forgot to punch on a single past day — supply
 *   the login (and usually logout) time so the admin can correct the row.
 */
export type AttendanceRequestType =
  | "work_from_home"
  | "absence_clarification"
  | "missed_login_regularization";

/** How many days back any request may reach — the day must have happened recently. */
export const ATTENDANCE_REQUEST_BACKDATE_DAYS = 7;

/**
 * How far ahead a work-from-home request may be planned. The other two kinds
 * explain a day that already happened, so they are capped at today (see the
 * validator) and never use this window.
 */
export const ATTENDANCE_REQUEST_AHEAD_DAYS = 60;

export type AttendanceRequestInput = {
  type: AttendanceRequestType;
  /** The day the request concerns, YYYY-MM-DD. For a WFH range this is its start. */
  work_date: string;
  /** End of a WFH range (inclusive). Defaults to work_date; ignored by the other kinds. */
  to_date?: string;
  reason: string;
  /** Minutes since IST midnight for a missed-login correction. */
  requested_login_minutes?: number | null;
  /** Minutes since IST midnight; when given must be after the login. */
  requested_logout_minutes?: number | null;
  /** Today in India, YYYY-MM-DD. */
  today: string;
};

export type NormalizedAttendanceRequest = {
  type: AttendanceRequestType;
  from_date: string;
  to_date: string;
  reason: string;
  requested_login_minutes: number | null;
  requested_logout_minutes: number | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real YYYY-MM-DD date (round-trips through addDays with 0). */
function isValidDate(date: string): boolean {
  return DATE_RE.test(date) && addDays(date, 0) === date;
}

const inDayRange = (m: unknown): m is number =>
  typeof m === "number" && Number.isFinite(m) && m >= 0 && m <= 24 * 60;

/**
 * Pure validator for a new attendance request. Returns the normalized row to
 * store on success, or a human message on failure. All date comparisons are on
 * YYYY-MM-DD strings so there is no timezone drift.
 */
export function validateAttendanceRequest(
  input: AttendanceRequestInput,
): { ok: true; normalized: NormalizedAttendanceRequest } | { ok: false; message: string } {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 3)
    return { ok: false, message: "Add a short reason (at least 3 characters)." };

  const from = String(input.work_date ?? "");
  if (!isValidDate(from)) return { ok: false, message: "Pick a valid date." };

  const earliest = addDays(input.today, -ATTENDANCE_REQUEST_BACKDATE_DAYS);
  if (from < earliest)
    return {
      ok: false,
      message: `The date is too far back — requests cover the last ${ATTENDANCE_REQUEST_BACKDATE_DAYS} days only.`,
    };

  if (input.type === "work_from_home") {
    const latest = addDays(input.today, ATTENDANCE_REQUEST_AHEAD_DAYS);
    if (from > latest)
      return {
        ok: false,
        message: `Work from home can be planned up to ${ATTENDANCE_REQUEST_AHEAD_DAYS} days ahead.`,
      };
    const to = input.to_date ? String(input.to_date) : from;
    if (!isValidDate(to)) return { ok: false, message: "Pick a valid end date." };
    if (to < from) return { ok: false, message: "The end date is before the start date." };
    if (to > latest)
      return {
        ok: false,
        message: `Work from home can be planned up to ${ATTENDANCE_REQUEST_AHEAD_DAYS} days ahead.`,
      };
    return {
      ok: true,
      normalized: {
        type: input.type,
        from_date: from,
        to_date: to,
        reason,
        requested_login_minutes: null,
        requested_logout_minutes: null,
      },
    };
  }

  // absence_clarification and missed_login_regularization explain a single day
  // that already happened, so no future date and no multi-day range.
  if (from > input.today)
    return { ok: false, message: "This request is only for a day that already passed." };
  if (input.to_date && input.to_date !== from)
    return { ok: false, message: "This request covers a single day only." };

  if (input.type === "missed_login_regularization") {
    const login = input.requested_login_minutes;
    if (!inDayRange(login))
      return { ok: false, message: "Enter the login time you missed punching." };
    const logout = input.requested_logout_minutes;
    if (logout !== null && logout !== undefined) {
      if (!inDayRange(logout)) return { ok: false, message: "Enter a valid logout time." };
      if (logout <= login)
        return { ok: false, message: "The logout time must be after the login time." };
    }
    return {
      ok: true,
      normalized: {
        type: input.type,
        from_date: from,
        to_date: from,
        reason,
        requested_login_minutes: login,
        requested_logout_minutes: logout === null || logout === undefined ? null : logout,
      },
    };
  }

  return {
    ok: true,
    normalized: {
      type: input.type,
      from_date: from,
      to_date: from,
      reason,
      requested_login_minutes: null,
      requested_logout_minutes: null,
    },
  };
}

/**
 * How far back an admin may enter or correct a day by hand. Comfortably covers
 * back-filling the 1st of the current month early in the next one (e.g. seeding
 * the 1st–11th on the 9th) and caps how old a hand-entered day can be.
 */
export const MANUAL_ATTENDANCE_BACKDATE_DAYS = 45;

export type ManualAttendanceEntryInput = {
  /** The day being entered or corrected, YYYY-MM-DD. */
  work_date: string;
  /** Minutes since IST midnight for the login. Required. */
  login_minutes: number | null;
  /** Minutes since IST midnight for the logout; optional (an open day). */
  logout_minutes: number | null;
  /** Today in India, YYYY-MM-DD. */
  today: string;
  /** How many days back entry is allowed (pass MANUAL_ATTENDANCE_BACKDATE_DAYS). */
  backdateDays: number;
};

export type NormalizedManualAttendanceEntry = {
  work_date: string;
  login_minutes: number;
  logout_minutes: number | null;
};

/**
 * Pure validator shared by the single-day admin entry and the bulk back-fill so
 * both apply identical rules. The caller (an admin edge action) still owns
 * permissions and the actual scoring via regularizedAttendance; this only
 * checks the shape of one day's input. Date comparisons are on YYYY-MM-DD
 * strings, so there is no timezone drift.
 */
export function validateManualAttendanceEntry(
  input: ManualAttendanceEntryInput,
):
  | { ok: true; normalized: NormalizedManualAttendanceEntry }
  | { ok: false; message: string } {
  const work_date = String(input.work_date ?? "");
  if (!isValidDate(work_date)) return { ok: false, message: "Pick a valid date." };

  if (work_date > input.today)
    return { ok: false, message: "You cannot enter attendance for a future date." };

  const backdateDays = Math.max(0, Math.floor(Number(input.backdateDays) || 0));
  const earliest = addDays(input.today, -backdateDays);
  if (work_date < earliest)
    return {
      ok: false,
      message: `The date is too far back — attendance can be entered for the last ${backdateDays} days only.`,
    };

  const login = input.login_minutes;
  if (!inDayRange(login)) return { ok: false, message: "Enter the login time." };

  const logout = input.logout_minutes;
  if (logout !== null && logout !== undefined) {
    if (!inDayRange(logout) || logout <= login)
      return { ok: false, message: "The logout time must be after the login time." };
  }

  return {
    ok: true,
    normalized: {
      work_date,
      login_minutes: login,
      logout_minutes: logout === null || logout === undefined ? null : logout,
    },
  };
}

/**
 * The fields a missed-login approval writes onto the attendance row, computed
 * with the SAME pure rules the logout flow uses (closeDay / lateMinutes /
 * windowMinutes / minutesBetween / istMidnightMs) so a corrected day matches a
 * normally-punched one.
 *
 * A status-producing correction needs both a login and a logout: with only a
 * login there are no worked minutes to judge, so callers requiring a status
 * must supply both. The ISO instants are built at the fixed IST offset from the
 * work_date plus the minutes-since-midnight.
 */
export function regularizedAttendance(input: {
  schedule: DaySchedule;
  halfDayMinutes: number;
  graceMinutes: number;
  work_date: string;
  requested_login_minutes: number;
  requested_logout_minutes: number;
}): {
  first_login_at: string;
  last_logout_at: string;
  worked_minutes: number;
  window_minutes: number;
  is_late: boolean;
  late_minutes: number;
  status: DayStatus;
  overtime_minutes: number;
} {
  const base = istMidnightMs(input.work_date);
  const firstLoginAt = new Date(base + input.requested_login_minutes * 60_000).toISOString();
  const lastLogoutAt = new Date(base + input.requested_logout_minutes * 60_000).toISOString();

  const worked = minutesBetween(firstLoginAt, lastLogoutAt);
  const inWindow = windowMinutes(firstLoginAt, lastLogoutAt, input.work_date, input.schedule);
  const late = lateMinutes(input.requested_login_minutes, input.schedule, input.graceMinutes);
  const closed = closeDay({
    workedMinutes: worked,
    windowMinutes: inWindow,
    requiredMinutes: input.schedule.required_minutes,
    halfDayMinutes: input.halfDayMinutes,
    mode: input.schedule.mode,
  });

  return {
    first_login_at: firstLoginAt,
    last_logout_at: lastLogoutAt,
    worked_minutes: worked,
    window_minutes: inWindow,
    is_late: late > 0,
    late_minutes: late,
    status: closed.status,
    overtime_minutes: closed.overtimeMinutes,
  };
}

/**
 * The attendance-row fields that credit a full scheduled working day without a
 * real punch — used when an approved work-from-home request falls on a day that
 * has no attendance row yet (a planned or already-absent date). The day must
 * count toward the month's hours exactly like a normally-worked full day, so it
 * is scored through the SAME pure path (regularizedAttendance → closeDay) by
 * pretending the whole scheduled window was worked: login at the window start,
 * logout once the required minutes are met.
 *
 * On a week-off / holiday schedule (mode "off" or required_minutes = 0) there
 * are no scheduled hours to credit, so the day stays present+remote but worth
 * zero — a WFH request on a non-working day must not fabricate hours.
 */
export function remoteDayAttendance(input: {
  schedule: DaySchedule;
  halfDayMinutes: number;
  graceMinutes: number;
  work_date: string;
}): {
  first_login_at: string;
  last_logout_at: string;
  worked_minutes: number;
  window_minutes: number;
  is_late: boolean;
  late_minutes: number;
  status: DayStatus;
  overtime_minutes: number;
} {
  const { schedule } = input;
  if (schedule.mode === "off" || schedule.required_minutes <= 0) {
    const at = new Date(istMidnightMs(input.work_date)).toISOString();
    return {
      first_login_at: at,
      last_logout_at: at,
      worked_minutes: 0,
      window_minutes: 0,
      is_late: false,
      late_minutes: 0,
      status: "present",
      overtime_minutes: 0,
    };
  }
  // Credit exactly the scheduled day: start at the window open, log out once the
  // required minutes are met (never past the window close). On a fixed day the
  // window span equals the requirement, so this is the whole window.
  const start = timeToMinutes(schedule.start);
  const end = timeToMinutes(schedule.end);
  const logout = Math.min(end, start + schedule.required_minutes);
  return regularizedAttendance({
    schedule,
    halfDayMinutes: input.halfDayMinutes,
    graceMinutes: input.graceMinutes,
    work_date: input.work_date,
    requested_login_minutes: start,
    requested_logout_minutes: logout,
  });
}

// ---------------------------------------------------------------------------
// Month view
// ---------------------------------------------------------------------------

export type AttendanceDayRecord = {
  work_date: string;
  status: DayStatus;
  is_late: boolean;
  worked_minutes: number;
  window_minutes: number;
  required_minutes: number | null;
  idle_minutes: number;
  open_since: string | null;
  work_mode: "office" | "remote";
  remote_status: "pending" | "approved" | "rejected" | null;
};

export type DayKind =
  | "present"
  | "short"
  | "half_day"
  | "absent"
  | "in_progress"
  | "action_needed"
  | "remote_pending"
  | "remote_rejected"
  | "paid_leave"
  | "unpaid_leave"
  | "leave_pending"
  | "holiday"
  | "week_off"
  | "today"
  | "upcoming"
  | "not_employed";

/** Plain-text labels for reports and exports. */
export const DAY_KIND_LABELS: Record<DayKind, string> = {
  present: "Present",
  short: "Left early",
  half_day: "Half day",
  absent: "Absent",
  in_progress: "Logged in",
  action_needed: "Logout missing",
  remote_pending: "WFH pending",
  remote_rejected: "WFH rejected",
  paid_leave: "Paid leave",
  unpaid_leave: "Unpaid leave",
  leave_pending: "Leave pending",
  holiday: "Holiday",
  week_off: "Week off",
  today: "Today",
  upcoming: "Upcoming",
  not_employed: "Not employed",
};

export type DayCell = {
  date: string;
  day: number;
  weekday: number;
  kind: DayKind;
  late: boolean;
  remote: boolean;
  /** Minutes that count toward the requirement (all worked time on an off day). */
  creditedMinutes: number;
  requiredMinutes: number;
  idleMinutes: number;
  /** Approved leave on this date: 0, 0.5 or 1. */
  leave: number;
  /** Week-off or holiday — worked time on it is all overtime. */
  nonWorking: boolean;
  holidayName: string | null;
};

export type MonthStats = {
  workingDays: number;
  elapsedWorkingDays: number;
  present: number;
  short: number;
  halfDays: number;
  absent: number;
  late: number;
  actionNeeded: number;
  remoteDays: number;
  remotePending: number;
  paidLeave: number;
  unpaidLeave: number;
  pendingLeave: number;
  /** Credited minutes, i.e. hours completed. */
  workedMinutes: number;
  requiredMinutes: number;
  overtimeMinutes: number;
  idleMinutes: number;
};

export type MonthInput = {
  year: number;
  /** 1–12. */
  month: number;
  /** Today in India, YYYY-MM-DD. */
  today: string;
  records: AttendanceDayRecord[];
  holidays: { date: string; name: string }[];
  schedules: DaySchedule[];
  halfDayMinutes: number;
  /** Leave expanded to dates, approved and pending. */
  leaves?: { date: string; amount: number; status: "approved" | "pending" }[];
  /** Paid leave available this month (from the ledger). */
  paidLeaveAvailable?: number;
  joiningDate?: string | null;
  exitDate?: string | null;
};

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Day-by-day picture of one employee's month plus the totals shown to them.
 *
 * - Absent: a past working day with no attendance and no leave (loss of pay).
 *   Today is never absent — the day is not over.
 * - A past day that was logged into but never logged out of is action_needed:
 *   its hours are unknown until the admin corrects it.
 * - Work-from-home days count only once the admin approves them; a rejected
 *   one is treated as absent.
 * - Approved leave draws on the month's paid balance in date order; anything
 *   beyond it is unpaid. A half-day leave halves that day's requirement.
 */
export function summarizeMonth(input: MonthInput): { days: DayCell[]; stats: MonthStats } {
  const byDate = new Map(input.records.map((r) => [r.work_date, r]));
  const holidayByDate = new Map(input.holidays.map((h) => [h.date, h.name]));
  const approvedLeave = new Map<string, number>();
  const pendingLeave = new Map<string, number>();
  for (const l of input.leaves ?? []) {
    const m = l.status === "approved" ? approvedLeave : pendingLeave;
    m.set(l.date, Math.min(1, (m.get(l.date) ?? 0) + l.amount));
  }
  let budget = Math.max(0, input.paidLeaveAvailable ?? 0);

  const stats: MonthStats = {
    workingDays: 0,
    elapsedWorkingDays: 0,
    present: 0,
    short: 0,
    halfDays: 0,
    absent: 0,
    late: 0,
    actionNeeded: 0,
    remoteDays: 0,
    remotePending: 0,
    paidLeave: 0,
    unpaidLeave: 0,
    pendingLeave: 0,
    workedMinutes: 0,
    requiredMinutes: 0,
    overtimeMinutes: 0,
    idleMinutes: 0,
  };
  const days: DayCell[] = [];
  const total = daysInMonth(input.year, input.month);

  for (let d = 1; d <= total; d++) {
    const date = `${input.year}-${pad2(input.month)}-${pad2(d)}`;
    const weekday = weekdayOf(date);
    const sched = input.schedules[weekday] ?? DEFAULT_SCHEDULES[weekday];
    const holidayName = holidayByDate.get(date) ?? null;
    const nonWorking = holidayName !== null || sched.mode === "off";
    const employed =
      (!input.joiningDate || date >= input.joiningDate) &&
      (!input.exitDate || date <= input.exitDate);
    const rec = byDate.get(date);
    const leave = nonWorking ? 0 : (approvedLeave.get(date) ?? 0);
    const pending = nonWorking ? 0 : (pendingLeave.get(date) ?? 0);
    const baseRequired = nonWorking ? 0 : (rec?.required_minutes ?? sched.required_minutes);
    const required = Math.round(baseRequired * (1 - leave));
    const cell: DayCell = {
      date,
      day: d,
      weekday,
      kind: "upcoming",
      late: false,
      remote: false,
      creditedMinutes: 0,
      requiredMinutes: required,
      idleMinutes: 0,
      leave,
      nonWorking,
      holidayName,
    };

    if (!employed && !rec) {
      cell.kind = "not_employed";
      days.push(cell);
      continue;
    }

    const isPast = date < input.today;
    const isToday = date === input.today;
    if (!nonWorking) stats.workingDays++;

    // Leave accounting happens whatever else the day holds, so the balance
    // always matches the ledger.
    let leaveKind: DayKind | null = null;
    if (leave > 0) {
      const paid = Math.min(leave, budget);
      budget -= paid;
      stats.paidLeave += paid;
      stats.unpaidLeave += leave - paid;
      leaveKind = paid >= leave ? "paid_leave" : "unpaid_leave";
    }
    if (pending > 0) stats.pendingLeave += pending;

    if (!nonWorking && (isPast || isToday || rec)) {
      if (isPast || rec) {
        stats.elapsedWorkingDays++;
        stats.requiredMinutes += required;
      }
    }

    if (rec) {
      cell.remote = rec.work_mode === "remote";
      cell.idleMinutes = rec.idle_minutes ?? 0;
      stats.idleMinutes += cell.idleMinutes;
      const credited = nonWorking ? rec.worked_minutes : (rec.window_minutes ?? 0);

      if (cell.remote && rec.remote_status === "rejected") {
        cell.kind = leaveKind ?? "remote_rejected";
        if (!leaveKind && !nonWorking) stats.absent++;
      } else if (cell.remote && rec.remote_status === "pending" && rec.status !== "in_progress") {
        cell.kind = "remote_pending";
        cell.creditedMinutes = credited;
        stats.remotePending++;
      } else if (rec.status === "in_progress") {
        cell.kind = isPast ? "action_needed" : "in_progress";
        cell.creditedMinutes = credited;
        if (isPast) stats.actionNeeded++;
      } else {
        cell.creditedMinutes = credited;
        cell.late = rec.is_late;
        stats.workedMinutes += credited;
        if (cell.remote) stats.remoteDays++;
        if (nonWorking) {
          cell.kind = "present";
          stats.overtimeMinutes += rec.worked_minutes;
        } else {
          // A half-day leave lowers the bar, so the status is re-derived here
          // rather than trusting the one stored at logout.
          const closed =
            leave > 0
              ? closeDay({
                  workedMinutes: rec.worked_minutes,
                  windowMinutes: credited,
                  requiredMinutes: required,
                  halfDayMinutes: Math.min(input.halfDayMinutes, required),
                  mode: sched.mode,
                })
              : null;
          const status = closed ? closed.status : rec.status;
          cell.kind = status === "in_progress" ? "present" : status;
          if (status === "present") {
            stats.present++;
            stats.overtimeMinutes += Math.max(0, rec.worked_minutes - required);
          }
          if (status === "short") stats.short++;
          if (status === "half_day") stats.halfDays++;
          if (rec.is_late) stats.late++;
        }
      }
    } else if (nonWorking) {
      cell.kind = holidayName !== null ? "holiday" : "week_off";
    } else if (leaveKind) {
      cell.kind = leaveKind;
    } else if (pending > 0) {
      cell.kind = "leave_pending";
    } else if (isPast) {
      cell.kind = "absent";
      stats.absent++;
    } else if (isToday) {
      cell.kind = "today";
    }
    days.push(cell);
  }
  return { days, stats };
}
