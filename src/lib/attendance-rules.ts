// Attendance rules — pure functions shared by the browser and the
// `attendance-punch` edge function.
//
// KEEP THIS FILE BYTE-IDENTICAL to supabase/functions/_shared/attendance-rules.ts
// (a unit test enforces it). The edge function is the only thing that ever
// decides whether a punch is accepted; the browser uses the same code purely to
// display the month and explain a verdict it already received. That is also why
// this file has no imports: it has to run unchanged under both Vite and Deno.

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
  outside_geofence: "You are outside the office area. Attendance can only be marked at the office.",
  already_logged_in: "You are already logged in.",
  not_logged_in: "You are not logged in, so there is nothing to log out of.",
  session_too_long:
    "Your last login is too old to close automatically. Ask the admin for a correction.",
};

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
  // admin can see where people actually punched from during a trial rollout.
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

/**
 * Minutes late, measured from the office start time. Zero while inside the
 * grace period: 09:44 with a 09:30 start and 15 min grace is on time, 09:46 is
 * 16 minutes late (not 1) — the grace is a tolerance, not a new start time.
 */
export function lateMinutes(loginMinutes: number, workStart: string, graceMinutes: number): number {
  const start = timeToMinutes(workStart);
  const after = loginMinutes - start;
  return after > (Number(graceMinutes) || 0) ? after : 0;
}

export type DayStatus = "in_progress" | "present" | "half_day";

/** Status of a closed day: below the half-day threshold it is a half day. */
export function closedDayStatus(workedMinutes: number, halfDayMinutes: number): DayStatus {
  return workedMinutes < halfDayMinutes ? "half_day" : "present";
}

export function overtimeMinutes(workedMinutes: number, requiredMinutes: number): number {
  return Math.max(0, Math.round(workedMinutes - requiredMinutes));
}

/** Whole minutes between two ISO instants, never negative. */
export function minutesBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
}

// ---------------------------------------------------------------------------
// Month view
// ---------------------------------------------------------------------------

export type AttendanceDayRecord = {
  work_date: string;
  status: DayStatus;
  is_late: boolean;
  worked_minutes: number;
  open_since: string | null;
};

export type DayKind =
  | "present"
  | "half_day"
  | "absent"
  | "in_progress"
  | "action_needed"
  | "holiday"
  | "week_off"
  | "today"
  | "upcoming"
  | "not_employed";

export type DayCell = {
  date: string;
  day: number;
  weekday: number;
  kind: DayKind;
  late: boolean;
  workedMinutes: number;
  /** Week-off or holiday — worked time on it is all overtime. */
  nonWorking: boolean;
  holidayName: string | null;
};

export type MonthStats = {
  workingDays: number;
  elapsedWorkingDays: number;
  present: number;
  halfDays: number;
  absent: number;
  late: number;
  actionNeeded: number;
  workedMinutes: number;
  requiredMinutes: number;
  overtimeMinutes: number;
};

export type MonthInput = {
  year: number;
  /** 1–12. */
  month: number;
  /** Today in India, YYYY-MM-DD. */
  today: string;
  records: AttendanceDayRecord[];
  holidays: { date: string; name: string }[];
  weekOffs: number[];
  requiredMinutes: number;
  joiningDate?: string | null;
  exitDate?: string | null;
};

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Day-by-day picture of one employee's month plus the totals shown to them.
 *
 * Absent means "a past working day with no attendance at all". Today is never
 * absent — the day is not over. A past day that was logged into but never
 * logged out of is `action_needed`: its hours are unknown until the admin corrects it.
 */
export function summarizeMonth(input: MonthInput): { days: DayCell[]; stats: MonthStats } {
  const byDate = new Map(input.records.map((r) => [r.work_date, r]));
  const holidayByDate = new Map(input.holidays.map((h) => [h.date, h.name]));
  const offs = new Set(input.weekOffs);
  const stats: MonthStats = {
    workingDays: 0,
    elapsedWorkingDays: 0,
    present: 0,
    halfDays: 0,
    absent: 0,
    late: 0,
    actionNeeded: 0,
    workedMinutes: 0,
    requiredMinutes: 0,
    overtimeMinutes: 0,
  };
  const days: DayCell[] = [];
  const total = daysInMonth(input.year, input.month);

  for (let d = 1; d <= total; d++) {
    const date = `${input.year}-${pad2(input.month)}-${pad2(d)}`;
    const weekday = new Date(Date.UTC(input.year, input.month - 1, d)).getUTCDay();
    const holidayName = holidayByDate.get(date) ?? null;
    const nonWorking = holidayName !== null || offs.has(weekday);
    const employed =
      (!input.joiningDate || date >= input.joiningDate) &&
      (!input.exitDate || date <= input.exitDate);
    const rec = byDate.get(date);
    const cell: DayCell = {
      date,
      day: d,
      weekday,
      kind: "upcoming",
      late: false,
      workedMinutes: 0,
      nonWorking,
      holidayName,
    };

    if (!employed && !rec) {
      cell.kind = "not_employed";
      days.push(cell);
      continue;
    }

    if (!nonWorking) stats.workingDays++;
    const isPast = date < input.today;
    const isToday = date === input.today;

    if (rec) {
      cell.late = rec.is_late;
      cell.workedMinutes = rec.worked_minutes;
      stats.workedMinutes += rec.worked_minutes;
      if (rec.status === "in_progress") {
        cell.kind = isPast ? "action_needed" : "in_progress";
        if (isPast) stats.actionNeeded++;
      } else {
        cell.kind = rec.status;
        stats.overtimeMinutes += nonWorking
          ? rec.worked_minutes
          : overtimeMinutes(rec.worked_minutes, input.requiredMinutes);
      }
      if (!nonWorking) {
        stats.elapsedWorkingDays++;
        stats.requiredMinutes += input.requiredMinutes;
        if (rec.status === "present") stats.present++;
        if (rec.status === "half_day") stats.halfDays++;
        if (rec.is_late) stats.late++;
      }
    } else if (nonWorking) {
      cell.kind = holidayName !== null ? "holiday" : "week_off";
    } else if (isPast) {
      cell.kind = "absent";
      stats.absent++;
      stats.elapsedWorkingDays++;
      stats.requiredMinutes += input.requiredMinutes;
    } else if (isToday) {
      cell.kind = "today";
    }
    days.push(cell);
  }
  return { days, stats };
}
