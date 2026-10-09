// Read-side queries shared by the employee and admin attendance pages. All go
// through RLS: an employee only ever gets their own rows back.

import {
  daysInMonth,
  expandLeave,
  latestOnTimeStart,
  ledgerFor,
  leaveLedger,
  minutesToTime,
  normalizeSchedules,
  summarizeMonth,
  DEFAULT_LEAVE_POLICY,
  type DayCell,
  type DaySchedule,
  type LeavePolicy,
  type LedgerMonth,
  type MonthStats,
} from "@/lib/attendance-rules";
import {
  formatMinutes,
  hrmsDb,
  type AttendanceRequest,
  type AttendanceRow,
  type Employee,
  type Holiday,
  type HrSettings,
  type IdlePeriod,
  type LeaveRequest,
} from "@/lib/hrms";

export function monthRange(year: number, month: number) {
  const mm = String(month).padStart(2, "0");
  return {
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${String(daysInMonth(year, month)).padStart(2, "0")}`,
  };
}

export async function fetchHrSettings(): Promise<HrSettings | null> {
  const { data } = await hrmsDb().from("hr_settings").select("*").maybeSingle();
  return data ?? null;
}

export async function fetchHolidays(from: string, to: string): Promise<Holiday[]> {
  const { data } = await hrmsDb()
    .from("holidays")
    .select("*")
    .eq("active", true)
    .gte("date", from)
    .lte("date", to)
    .order("date");
  return data ?? [];
}

export async function fetchAttendance(
  from: string,
  to: string,
  employeeId?: string,
): Promise<AttendanceRow[]> {
  let q = hrmsDb().from("attendance").select("*").gte("work_date", from).lte("work_date", to);
  if (employeeId) q = q.eq("employee_id", employeeId);
  const { data, error } = await q.order("work_date");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Holidays that count as non-working days. Optional holidays are not days off for everyone. */
export const offDayHolidays = (holidays: Holiday[]) =>
  holidays
    .filter((h) => h.holiday_type !== "optional")
    .map((h) => ({ date: h.date, name: h.name }));

export const timeIST = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata",
      })
    : "—";

export const dateTimeIST = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });

// ---------------------------------------------------------------------------
// Leave + month assembly
// ---------------------------------------------------------------------------

export function leavePolicyOf(s: HrSettings | null | undefined): LeavePolicy {
  return {
    monthlyQuota: Number(s?.monthly_leave_quota ?? DEFAULT_LEAVE_POLICY.monthlyQuota),
    carryCap: Number(s?.leave_carry_cap ?? DEFAULT_LEAVE_POLICY.carryCap),
    policyStart: String(s?.leave_policy_start ?? DEFAULT_LEAVE_POLICY.policyStart).slice(0, 10),
  };
}

/**
 * Leave requests that matter for a month view AND its balance: the ledger
 * carries forward from the policy start, so everything since then is loaded.
 */
export async function fetchLeaves(opts: {
  employeeId?: string;
  since: string;
  until: string;
}): Promise<LeaveRequest[]> {
  let q = hrmsDb()
    .from("leave_requests")
    .select("*")
    .in("status", ["pending", "approved"])
    .gte("to_date", opts.since)
    .lte("from_date", opts.until);
  if (opts.employeeId) q = q.eq("employee_id", opts.employeeId);
  const { data, error } = await q.order("from_date");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * True when a PostgREST error means the relation does not exist yet: Postgres
 * `undefined_table` (SQLSTATE 42P01) or a "does not exist" message. Used so a
 * manually-applied migration's not-yet-created table reads as empty, not an error.
 */
function isMissingRelationError(error: { code?: string; message?: string }): boolean {
  return error.code === "42P01" || /does not exist/i.test(error.message ?? "");
}

/**
 * Attendance requests for the UI (My Attendance and admin Approvals). RLS
 * already scopes an employee to their own rows; the admin screen passes a
 * status filter to list the pending queue. Mirrors fetchLeaves.
 */
export async function fetchAttendanceRequests(opts: {
  employeeId?: string;
  status?: AttendanceRequest["status"];
}): Promise<AttendanceRequest[]> {
  let q = hrmsDb().from("attendance_requests").select("*");
  if (opts.employeeId) q = q.eq("employee_id", opts.employeeId);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) {
    // The migration is applied manually by the owner, so there is a window
    // where the table does not exist yet. Treat a missing-relation error as an
    // empty list (like the admin pending-count badge does) so the My
    // Attendance card degrades to empty rather than showing a failed query.
    if (isMissingRelationError(error)) return [];
    throw new Error(error.message);
  }
  return data ?? [];
}

export type EmployeeMonth = {
  days: DayCell[];
  stats: MonthStats;
  ledger: LedgerMonth;
};

/** Everything the month screens show for one employee, from already-fetched rows. */
export function buildEmployeeMonth(input: {
  employee: Pick<Employee, "joining_date" | "exit_date">;
  year: number;
  month: number;
  today: string;
  records: AttendanceRow[];
  holidays: Holiday[];
  settings: HrSettings | null | undefined;
  leaves: LeaveRequest[];
}): EmployeeMonth {
  const schedules = normalizeSchedules(input.settings?.day_schedules);
  const policy = leavePolicyOf(input.settings);
  const offDates = offDayHolidays(input.holidays).map((h) => h.date);
  const expanded = input.leaves.flatMap((l) =>
    expandLeave(l.from_date, l.to_date, l.half_day, schedules, offDates).map((d) => ({
      ...d,
      status: l.status as "approved" | "pending",
    })),
  );
  const ym = `${input.year}-${String(input.month).padStart(2, "0")}`;
  const ledger = ledgerFor(
    leaveLedger({
      policy,
      joiningDate: input.employee.joining_date,
      approved: expanded.filter((l) => l.status === "approved"),
      untilMonth: ym,
    }),
    ym,
    policy,
  );
  const summary = summarizeMonth({
    year: input.year,
    month: input.month,
    today: input.today,
    records: input.records.map((r) => ({
      ...r,
      window_minutes: r.window_minutes ?? 0,
      idle_minutes: r.idle_minutes ?? 0,
      work_mode: r.work_mode ?? "office",
      remote_status: r.remote_status ?? null,
      required_minutes: r.required_minutes ?? null,
    })),
    holidays: offDayHolidays(input.holidays),
    schedules,
    halfDayMinutes: Number(input.settings?.half_day_minutes ?? 240),
    leaves: expanded.filter((l) => l.date.startsWith(ym)),
    paidLeaveAvailable: ledger.available,
    joiningDate: input.employee.joining_date,
    exitDate: input.employee.exit_date,
  });
  return { ...summary, ledger };
}

/** "Flexible · 9h between 09:00–19:30 · on time by 10:30" */
export function describeSchedule(s: DaySchedule, graceMinutes: number): string {
  if (s.mode === "off") return "Week off";
  if (s.mode === "fixed")
    return `Fixed ${s.start}–${s.end} · late after ${minutesToTime(latestOnTimeStart(s, graceMinutes))}`;
  return `Flexible · ${formatMinutes(s.required_minutes)} between ${s.start}–${s.end} · start by ${minutesToTime(
    latestOnTimeStart(s, graceMinutes),
  )}`;
}

/** "3 Oct · half day" or "3 Oct – 5 Oct". */
export const leaveRange = (l: Pick<LeaveRequest, "from_date" | "to_date" | "half_day">) => {
  const f = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  return l.from_date === l.to_date
    ? `${f(l.from_date)}${l.half_day ? " · half day" : ""}`
    : `${f(l.from_date)} – ${f(l.to_date)}`;
};

/** Idle stretches for one employee in a date range (by start time, IST). */
export async function fetchIdlePeriods(
  employeeId: string,
  from: string,
  to: string,
): Promise<IdlePeriod[]> {
  const { data, error } = await hrmsDb()
    .from("attendance_idle_periods")
    .select("*")
    .eq("employee_id", employeeId)
    .gte("started_at", `${from}T00:00:00+05:30`)
    .lte("started_at", `${to}T23:59:59+05:30`)
    .order("started_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}
