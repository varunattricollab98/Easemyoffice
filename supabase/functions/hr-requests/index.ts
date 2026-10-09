// Leave requests, attendance requests and work-from-home decisions — the only
// writer of leave_requests, attendance_requests and of the attendance-row
// effects they produce.
//
// POST body (browser, via supabase.functions.invoke("hr-requests")):
//   employee: { action: "apply_leave", from, to, half_day?, reason }
//             { action: "cancel_leave", id }                 (own, pending only)
//             { action: "apply_attendance_request", type, work_date, to_date?,
//               reason, login?, logout? }                    (login/logout = "HH:MM")
//             { action: "cancel_attendance_request", id }    (own, pending only)
//   admin:    { action: "decide_leave", id, approve, note? }
//             { action: "decide_remote", attendance_id, approve, note? }
//             { action: "decide_attendance_request", id, approve, note? }
//             { action: "email_salary_slip", employee_id, month, pdf_base64, filename }
//
// Replies 200 { ok: true, ... } or 200 { ok: false, message } for business
// rule failures; non-2xx only for faults. Every new request emails + alerts the
// admins; every decision alerts the employee.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  expandLeave,
  istParts,
  addDays,
  lateMinutes,
  MANUAL_ATTENDANCE_BACKDATE_DAYS,
  normalizeSchedules,
  regularizedAttendance,
  remoteDayAttendance,
  validateAttendanceRequest,
  validateManualAttendanceEntry,
  weekdayOf,
  type AttendanceRequestType,
  type DaySchedule,
} from "../_shared/attendance-rules.ts";
import { esc, notifyAdmins, notifyUser, sendEmailWithAttachments } from "../_shared/hr-notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

/** How far back a leave can be applied for (e.g. a sick day reported late). */
const BACKDATE_DAYS = 7;

/** Human labels for the three attendance-request kinds (used in notifications). */
const ATTENDANCE_REQUEST_LABELS: Record<AttendanceRequestType, string> = {
  work_from_home: "Work from home",
  absence_clarification: "Absence clarification",
  missed_login_regularization: "Missed login regularization",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const fail = (message: string) => json({ ok: false, message });

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};

/** An embedded many-to-one relation arrives as an object; be tolerant of an array. */
const profileOf = (rel: unknown): string | null => {
  const r = (Array.isArray(rel) ? rel[0] : rel) as
    | { profile_id?: string | null }
    | null
    | undefined;
  return r?.profile_id ?? null;
};

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    weekday: "short",
    timeZone: "UTC",
  });

const rangeLabel = (from: string, to: string, half: boolean) =>
  from === to
    ? `${fmtDate(from)}${half ? " (half day)" : ""}`
    : `${fmtDate(from)} – ${fmtDate(to)}`;

/** "09:30" / "09:30:00" -> minutes since midnight, or null when absent/invalid. */
const parseHHMM = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(mins) && mins >= 0 && mins <= 24 * 60 ? mins : null;
};

/** Minutes since IST midnight on a date -> an ISO instant (fixed +05:30). */
const istInstant = (date: string, minutes: number): string =>
  new Date(Date.parse(`${date}T00:00:00+05:30`) + minutes * 60_000).toISOString();

/** Minutes since IST midnight on a date for a stored instant, or null. */
const minutesSinceIstMidnight = (date: string, iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.round((t - Date.parse(`${date}T00:00:00+05:30`)) / 60_000);
};

/** "3 Oct 2026" short-date for notification bodies. */
const requestRangeLabel = (from: string, to: string) =>
  from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`;

/** "09:30 AM" from minutes since midnight, for notification detail rows. */
const clockLabel = (minutes: number | null): string => {
  if (minutes === null) return "—";
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const am = h < 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${am ? "AM" : "PM"}`;
};

// A loose Supabase client type — the service-role client used by the handlers.
// deno-lint-ignore no-explicit-any
type Db = ReturnType<typeof createClient<any, any, any>>;

/** The day's schedule, snapshotted from the attendance row if present else the
 *  configured weekday schedule — exactly how attendance-punch picks it. */
async function scheduleFor(
  db: Db,
  workDate: string,
  row: {
    schedule_mode?: string | null;
    window_start?: string | null;
    window_end?: string | null;
    required_minutes?: number | null;
  } | null,
): Promise<DaySchedule> {
  if (row?.schedule_mode) {
    return {
      mode: row.schedule_mode as DaySchedule["mode"],
      start: String(row.window_start).slice(0, 5),
      end: String(row.window_end).slice(0, 5),
      required_minutes: Number(row.required_minutes ?? 0),
    };
  }
  const { data: settings } = await db
    .from("hr_settings")
    .select("day_schedules")
    .eq("id", true)
    .maybeSingle();
  return normalizeSchedules(settings?.day_schedules)[weekdayOf(workDate)];
}

/**
 * Mark one day as an approved work-from-home day, reusing the attendance
 * remote_* columns. Updates an existing row (so a reactive-WFH day converges)
 * or creates a minimal remote-approved row for a future/absent day.
 */
async function approveRemoteDay(
  db: Db,
  employeeId: string,
  workDate: string,
  reason: string,
  decidedBy: string,
  decidedAt: string,
) {
  const { data: existing } = await db
    .from("attendance")
    .select("id")
    .eq("employee_id", employeeId)
    .eq("work_date", workDate)
    .maybeSingle();
  const patch = {
    work_mode: "remote",
    remote_status: "approved",
    remote_reason: reason,
    remote_decided_by: decidedBy,
    remote_decided_at: decidedAt,
  };
  if (existing) {
    // The day was actually punched (e.g. a reactive-WFH day); keep its real
    // worked_minutes and schedule intact and only record the approval.
    await db.from("attendance").update(patch).eq("id", existing.id);
    return;
  }

  // A planned/absent WFH day has no real punch, so it would otherwise credit
  // zero minutes. Credit it the full scheduled working day through the SAME
  // pure path a normally-worked day uses, so it adds to the month's hours.
  const { data: settings } = await db
    .from("hr_settings")
    .select("day_schedules, grace_minutes, half_day_minutes")
    .eq("id", true)
    .maybeSingle();
  const schedule = normalizeSchedules(settings?.day_schedules)[weekdayOf(workDate)];
  const credited = remoteDayAttendance({
    schedule,
    graceMinutes: Number(settings?.grace_minutes ?? 15),
    halfDayMinutes: Number(settings?.half_day_minutes ?? 240),
    work_date: workDate,
  });
  await db.from("attendance").insert({
    employee_id: employeeId,
    work_date: workDate,
    open_since: null,
    first_login_at: credited.first_login_at,
    last_logout_at: credited.last_logout_at,
    worked_minutes: credited.worked_minutes,
    window_minutes: credited.window_minutes,
    is_late: credited.is_late,
    late_minutes: credited.late_minutes,
    status: credited.status,
    overtime_minutes: credited.overtime_minutes,
    schedule_mode: schedule.mode,
    window_start: schedule.start,
    window_end: schedule.end,
    required_minutes: schedule.required_minutes,
    ...patch,
  });
}

/**
 * Best-effort tag of a day's provenance. The entry_source column is added by a
 * migration the OWNER applies by hand (FEAT-002), so it may not exist yet; a
 * missing-column error here must never fail the request — the attendance row
 * itself was already written correctly by the core write above.
 */
async function tagEntrySource(
  db: Db,
  employeeId: string,
  workDate: string,
  entrySource: string | undefined,
) {
  if (!entrySource) return;
  try {
    const { error } = await db
      .from("attendance")
      .update({ entry_source: entrySource })
      .eq("employee_id", employeeId)
      .eq("work_date", workDate);
    if (error) {
      // A missing entry_source column on an un-migrated DB is expected and must
      // never fail the request (the attendance row was already written). Any
      // OTHER error (constraint, transient fault) is a genuine tag failure on a
      // migrated DB — log it so an untagged admin row is not silent, but still
      // do not throw: provenance is best-effort, the row itself is correct.
      const undefinedColumn =
        /entry_source/i.test(error.message) &&
        /(column|does not exist|schema cache|could not find)/i.test(error.message);
      if (!undefinedColumn) {
        console.error(
          `tagEntrySource: failed to tag ${employeeId}/${workDate} as ${entrySource}: ${error.message}`,
        );
      }
    }
  } catch (e) {
    // Defensive: the update should surface errors on the result object, but a
    // thrown fault must still never abort the write path.
    console.error(`tagEntrySource: unexpected throw for ${employeeId}/${workDate}: ${String(e)}`);
  }
}

/**
 * Write one day's attendance by hand, scoring it IDENTICALLY to a real punch.
 * The single row-writing core shared by the missed-login approval path and the
 * admin manual-entry actions. A correct attendance row is always written first
 * WITHOUT entry_source; the provenance tag is a best-effort follow-up so an
 * un-migrated DB still succeeds.
 *
 * With both a login and a logout the day is fully scored through
 * regularizedAttendance (worked / window / late / status / overtime). With only
 * a login the day is written as an open/in-progress row shaped exactly like
 * attendance-punch's open insert — no fabricated hours. In both cases this is a
 * create-OR-update that overwrites any existing row for that employee+date.
 */
async function writeManualAttendance(
  db: Db,
  input: {
    employeeId: string;
    workDate: string;
    loginMinutes: number;
    logoutMinutes: number | null;
    entrySource?: string;
  },
) {
  const { data: existing } = await db
    .from("attendance")
    .select("*")
    .eq("employee_id", input.employeeId)
    .eq("work_date", input.workDate)
    .maybeSingle();

  const { data: settings } = await db
    .from("hr_settings")
    .select("day_schedules, grace_minutes, half_day_minutes")
    .eq("id", true)
    .maybeSingle();
  const schedule = await scheduleFor(db, input.workDate, existing);
  const graceMinutes = Number(settings?.grace_minutes ?? 15);
  const halfDayMinutes = Number(settings?.half_day_minutes ?? 240);

  let patch: Record<string, unknown>;
  if (input.logoutMinutes === null) {
    // Login-only: mirror attendance-punch's open-row shape exactly.
    const loginInstant = istInstant(input.workDate, input.loginMinutes);
    const late = lateMinutes(input.loginMinutes, schedule, graceMinutes);
    patch = {
      first_login_at: loginInstant,
      open_since: loginInstant,
      last_activity_at: loginInstant,
      last_logout_at: null,
      worked_minutes: 0,
      window_minutes: 0,
      is_late: late > 0,
      late_minutes: late,
      status: "in_progress",
      overtime_minutes: 0,
      schedule_mode: schedule.mode,
      window_start: schedule.start,
      window_end: schedule.end,
      required_minutes: schedule.required_minutes,
    };
  } else {
    const r = regularizedAttendance({
      schedule,
      graceMinutes,
      halfDayMinutes,
      work_date: input.workDate,
      requested_login_minutes: input.loginMinutes,
      requested_logout_minutes: input.logoutMinutes,
    });
    patch = {
      first_login_at: r.first_login_at,
      last_logout_at: r.last_logout_at,
      open_since: null,
      worked_minutes: r.worked_minutes,
      window_minutes: r.window_minutes,
      is_late: r.is_late,
      late_minutes: r.late_minutes,
      status: r.status,
      overtime_minutes: r.overtime_minutes,
      schedule_mode: schedule.mode,
      window_start: schedule.start,
      window_end: schedule.end,
      required_minutes: schedule.required_minutes,
    };
  }

  if (existing) {
    const { error } = await db.from("attendance").update(patch).eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await db.from("attendance").insert({
      employee_id: input.employeeId,
      work_date: input.workDate,
      work_mode: "office",
      ...patch,
    });
    if (error) throw new Error(error.message);
  }

  await tagEntrySource(db, input.employeeId, input.workDate, input.entrySource);
}

/**
 * Correct a missed-login day: recompute the attendance row through the shared
 * regularizedAttendance helper (closeDay / lateMinutes / windowMinutes) so a
 * corrected day matches a normally-punched one. Needs both a login and logout;
 * with only a login there is nothing to score, so it is skipped.
 */
async function regularizeDay(
  db: Db,
  input: {
    employeeId: string;
    workDate: string;
    loginMinutes: number | null;
    logoutMinutes: number | null;
  },
) {
  if (input.loginMinutes === null || input.logoutMinutes === null) return;
  await writeManualAttendance(db, {
    employeeId: input.employeeId,
    workDate: input.workDate,
    loginMinutes: input.loginMinutes,
    logoutMinutes: input.logoutMinutes,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not signed in." }, 401);

    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    const { data: roles } = await db.from("user_roles").select("role").eq("user_id", user.id);
    const isAdmin = ((roles ?? []) as { role: string }[]).some((r) => r.role === "admin");

    const nameOf = (e: { first_name: string; last_name: string | null }) =>
      [e.first_name, e.last_name].filter(Boolean).join(" ");

    // ---------------------------------------------------------------- employee
    if (
      action === "apply_leave" ||
      action === "cancel_leave" ||
      action === "apply_attendance_request" ||
      action === "cancel_attendance_request"
    ) {
      const { data: employee } = await db
        .from("employees")
        .select("id, first_name, last_name, employee_code, employment_status")
        .eq("profile_id", user.id)
        .maybeSingle();
      if (!employee) return fail("Your login is not linked to an employee record. Ask the admin.");

      if (action === "cancel_leave") {
        const { data: done } = await db
          .from("leave_requests")
          .update({ status: "cancelled" })
          .eq("id", String(body.id ?? ""))
          .eq("employee_id", employee.id)
          .eq("status", "pending")
          .select("id")
          .maybeSingle();
        return done
          ? json({ ok: true })
          : fail("Only a pending request of yours can be cancelled.");
      }

      if (action === "cancel_attendance_request") {
        const { data: done } = await db
          .from("attendance_requests")
          .update({ status: "cancelled" })
          .eq("id", String(body.id ?? ""))
          .eq("employee_id", employee.id)
          .eq("status", "pending")
          .select("id")
          .maybeSingle();
        return done
          ? json({ ok: true })
          : fail("Only a pending request of yours can be cancelled.");
      }

      if (action === "apply_attendance_request") {
        const type = String(body.type ?? "") as AttendanceRequestType;
        if (!(type in ATTENDANCE_REQUEST_LABELS)) return fail("Pick a valid request type.");
        const today = istParts(new Date()).date;
        const check = validateAttendanceRequest({
          type,
          work_date: String(body.work_date ?? ""),
          to_date: typeof body.to_date === "string" ? body.to_date : undefined,
          reason: text(body.reason, 500) ?? "",
          requested_login_minutes: parseHHMM(body.login),
          requested_logout_minutes: parseHHMM(body.logout),
          today,
        });
        if (!check.ok) return fail(check.message);
        const n = check.normalized;

        // Duplicate / overlap guard: a pending or approved request of the same
        // type already covering any of these dates. WFH is a range; the other
        // two are single-day.
        const { data: clash } = await db
          .from("attendance_requests")
          .select("id")
          .eq("employee_id", employee.id)
          .eq("type", type)
          .in("status", ["pending", "approved"])
          .lte("from_date", n.to_date)
          .gte("to_date", n.from_date)
          .limit(1);
        if (clash && clash.length)
          return fail("You already have a request of this type covering these dates.");

        // Lenient sanity checks against actual attendance — only block when the
        // data clearly contradicts the request, so edge cases are not stuck.
        if (type === "missed_login_regularization" || type === "absence_clarification") {
          const { data: existing } = await db
            .from("attendance")
            .select("status, open_since, first_login_at")
            .eq("employee_id", employee.id)
            .eq("work_date", n.from_date)
            .maybeSingle();
          if (existing) {
            if (type === "missed_login_regularization") {
              // A completed day (logged out) needs no missed-login fix.
              const settled =
                !existing.open_since &&
                existing.first_login_at &&
                existing.status !== "in_progress";
              if (settled)
                return fail("That day already has a completed attendance record — nothing to fix.");
            } else if (existing.first_login_at) {
              // absence_clarification is for a day with no present attendance.
              return fail("That day already has an attendance record, so it is not an absence.");
            }
          }
        }

        const row: Record<string, unknown> = {
          employee_id: employee.id,
          type,
          work_date: n.from_date,
          from_date: n.from_date,
          to_date: n.to_date,
          reason: n.reason,
          requested_login_at:
            n.requested_login_minutes === null
              ? null
              : istInstant(n.from_date, n.requested_login_minutes),
          requested_logout_at:
            n.requested_logout_minutes === null
              ? null
              : istInstant(n.from_date, n.requested_logout_minutes),
        };
        const { data: created, error } = await db
          .from("attendance_requests")
          .insert(row)
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        const name = nameOf(employee);
        const label = ATTENDANCE_REQUEST_LABELS[type];
        const details: [string, string][] = [
          ["Employee", `${name} (${employee.employee_code})`],
          ["Type", label],
          [type === "work_from_home" ? "Dates" : "Date", requestRangeLabel(n.from_date, n.to_date)],
          ["Reason", n.reason],
        ];
        if (type === "missed_login_regularization") {
          details.push(["Login", clockLabel(n.requested_login_minutes)]);
          details.push(["Logout", clockLabel(n.requested_logout_minutes)]);
        }
        await notifyAdmins(db, {
          type: "hr_attendance_request",
          title: `${label} request — ${name}`,
          body: `${name} raised a ${label.toLowerCase()} request for ${requestRangeLabel(
            n.from_date,
            n.to_date,
          )}.`,
          details,
          path: "/hrms/approvals",
          cta: "Review in CRM",
        });
        return json({ ok: true, request: created });
      }

      const from = body.from;
      const to = body.to ?? body.from;
      const halfDay = body.half_day === true;
      const reason = text(body.reason, 500);
      if (!isDate(from) || !isDate(to) || to < from) return fail("Pick a valid date range.");
      if (halfDay && from !== to) return fail("A half-day leave must be a single date.");
      if (!reason || reason.length < 3) return fail("Add a short reason.");
      const today = istParts(new Date()).date;
      if (from < addDays(today, -BACKDATE_DAYS))
        return fail(`Leave can be applied at most ${BACKDATE_DAYS} days back.`);
      if (to > addDays(today, 180)) return fail("Leave can be applied at most 6 months ahead.");

      const { data: settings } = await db
        .from("hr_settings")
        .select("day_schedules")
        .eq("id", true)
        .maybeSingle();
      const { data: hol } = await db
        .from("holidays")
        .select("date")
        .eq("active", true)
        .neq("holiday_type", "optional")
        .gte("date", from)
        .lte("date", to);
      const dates = expandLeave(
        from,
        to,
        halfDay,
        normalizeSchedules(settings?.day_schedules),
        ((hol ?? []) as { date: string }[]).map((h) => h.date),
      );
      const days = dates.reduce((a, d) => a + d.amount, 0);
      if (days <= 0) return fail("Those dates are all week-offs or holidays — no leave needed.");

      const { data: overlap } = await db
        .from("leave_requests")
        .select("id")
        .eq("employee_id", employee.id)
        .in("status", ["pending", "approved"])
        .lte("from_date", to)
        .gte("to_date", from)
        .limit(1);
      if (overlap && overlap.length)
        return fail("You already have a leave request covering these dates.");

      const { data: created, error } = await db
        .from("leave_requests")
        .insert({
          employee_id: employee.id,
          from_date: from,
          to_date: to,
          half_day: halfDay,
          days,
          reason,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);

      const name = nameOf(employee);
      await notifyAdmins(db, {
        type: "hr_leave_request",
        title: `Leave request — ${name}`,
        body: `${name} applied for ${days} day${days === 1 ? "" : "s"} of leave.`,
        details: [
          ["Employee", `${name} (${employee.employee_code})`],
          ["Dates", rangeLabel(from, to, halfDay)],
          ["Working days", String(days)],
          ["Reason", reason],
        ],
        path: "/hrms/approvals",
        cta: "Review in CRM",
      });
      return json({ ok: true, request: created });
    }

    // ------------------------------------------------------------------- admin
    if (action === "decide_attendance_request") {
      if (!isAdmin) return json({ error: "Admins only." }, 403);
      const approve = body.approve === true;
      const note = text(body.note, 500);
      const decidedAt = new Date().toISOString();

      const { data: request } = await db
        .from("attendance_requests")
        .select("*, employees(profile_id, first_name, last_name, employee_code)")
        .eq("id", String(body.id ?? ""))
        .eq("status", "pending")
        .maybeSingle();
      if (!request) return fail("That request is no longer pending.");

      const { data: decided } = await db
        .from("attendance_requests")
        .update({
          status: approve ? "approved" : "rejected",
          admin_note: note,
          decided_by: user.id,
          decided_at: decidedAt,
        })
        .eq("id", request.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (!decided) return fail("That request is no longer pending.");

      const type = request.type as AttendanceRequestType;
      const label = ATTENDANCE_REQUEST_LABELS[type];

      // On approval, apply the per-type effect on the attendance row through the
      // shared pure rules, reusing the existing remote_* columns for WFH so the
      // reactive flow and command center stay consistent.
      if (approve) {
        if (type === "work_from_home") {
          for (
            let d = request.from_date, i = 0;
            d <= request.to_date && i < 366;
            d = addDays(d, 1), i++
          ) {
            await approveRemoteDay(db, request.employee_id, d, request.reason, user.id, decidedAt);
          }
        } else if (type === "missed_login_regularization") {
          await regularizeDay(db, {
            employeeId: request.employee_id,
            workDate: request.from_date,
            loginMinutes: minutesSinceIstMidnight(request.from_date, request.requested_login_at),
            logoutMinutes: minutesSinceIstMidnight(request.from_date, request.requested_logout_at),
          });
        }
        // absence_clarification: the approved request itself is the record; no
        // attendance mutation.
      }

      await notifyUser(db, profileOf(request.employees), {
        type: "hr_attendance_decision",
        title: `${label} ${approve ? "approved" : "rejected"} — ${requestRangeLabel(
          request.from_date,
          request.to_date,
        )}`,
        body: note
          ? `Admin note: ${note}`
          : `Your ${label.toLowerCase()} request for ${requestRangeLabel(
              request.from_date,
              request.to_date,
            )} was ${approve ? "approved" : "rejected"}.`,
        path: "/attendance",
        cta: "Open My Attendance",
      });
      return json({ ok: true });
    }

    // Admin single-day manual attendance entry: create or correct ONE day's
    // login/logout by hand (e.g. seeding a past day from the WhatsApp log). The
    // day is scored identically to a real punch; login-only writes an open row.
    if (action === "admin_set_attendance") {
      if (!isAdmin) return json({ error: "Admins only." }, 403);
      const employeeId = text(body.employee_id, 64);
      if (!employeeId) return fail("Pick an employee.");
      const { data: employee } = await db
        .from("employees")
        .select("id, first_name, last_name, employee_code, joining_date")
        .eq("id", employeeId)
        .maybeSingle();
      if (!employee) return fail("Employee not found.");

      const today = istParts(new Date()).date;
      const check = validateManualAttendanceEntry({
        work_date: String(body.work_date ?? ""),
        login_minutes: parseHHMM(body.login),
        logout_minutes: parseHHMM(body.logout),
        today,
        backdateDays: MANUAL_ATTENDANCE_BACKDATE_DAYS,
      });
      if (!check.ok) return fail(check.message);

      // Re-apply the client's "joined by this date" rule server-side: the picker
      // hides anyone not yet joined, but that is cosmetic — a crafted request
      // could otherwise write a day before the employee joined. Plain YYYY-MM-DD
      // string comparison, matching the client filter (joining_date <= date).
      if (employee.joining_date && check.normalized.work_date < employee.joining_date) {
        return fail("That date is before the employee's joining date.");
      }

      await writeManualAttendance(db, {
        employeeId: employee.id,
        workDate: check.normalized.work_date,
        loginMinutes: check.normalized.login_minutes,
        logoutMinutes: check.normalized.logout_minutes,
        entrySource: "admin_manual",
      });
      return json({ ok: true });
    }

    // Admin bulk back-fill: write many days in one submit (e.g. the 1st–11th
    // for the whole team). Each entry is processed independently — a bad or
    // blank row is recorded and skipped, never aborting the batch.
    if (action === "admin_bulk_set_attendance") {
      if (!isAdmin) return json({ error: "Admins only." }, 403);
      const entries = Array.isArray(body.entries) ? body.entries : [];
      if (entries.length > 500) return fail("Too many entries in one submit.");

      const today = istParts(new Date()).date;
      // Cache employee lookups by id so a day-per-employee grid refetches once.
      const employeeCache = new Map<string, { id: string; joining_date: string | null } | null>();
      const results: {
        index: number;
        employee_id: string;
        work_date: string;
        ok: boolean;
        message?: string;
      }[] = [];

      for (let index = 0; index < entries.length; index++) {
        const entry = (entries[index] ?? {}) as Record<string, unknown>;
        const employeeId = text(entry.employee_id, 64) ?? "";
        const workDate = typeof entry.work_date === "string" ? entry.work_date : "";

        // A blank/absent login is a deliberate skip, not a hard error.
        if (parseHHMM(entry.login) === null) {
          results.push({
            index,
            employee_id: employeeId,
            work_date: workDate,
            ok: false,
            message: "No login time — skipped.",
          });
          continue;
        }

        if (!employeeId) {
          results.push({
            index,
            employee_id: employeeId,
            work_date: workDate,
            ok: false,
            message: "Pick an employee.",
          });
          continue;
        }

        let employee = employeeCache.get(employeeId);
        if (employee === undefined) {
          const { data } = await db
            .from("employees")
            .select("id, joining_date")
            .eq("id", employeeId)
            .maybeSingle();
          employee = data ?? null;
          employeeCache.set(employeeId, employee);
        }
        if (!employee) {
          results.push({
            index,
            employee_id: employeeId,
            work_date: workDate,
            ok: false,
            message: "Employee not found.",
          });
          continue;
        }

        const check = validateManualAttendanceEntry({
          work_date: workDate,
          login_minutes: parseHHMM(entry.login),
          logout_minutes: parseHHMM(entry.logout),
          today,
          backdateDays: MANUAL_ATTENDANCE_BACKDATE_DAYS,
        });
        if (!check.ok) {
          results.push({
            index,
            employee_id: employeeId,
            work_date: workDate,
            ok: false,
            message: check.message,
          });
          continue;
        }

        // Re-apply the "joined by this date" rule server-side (same plain
        // YYYY-MM-DD comparison as the single-day path and the client picker).
        if (employee.joining_date && check.normalized.work_date < employee.joining_date) {
          results.push({
            index,
            employee_id: employeeId,
            work_date: check.normalized.work_date,
            ok: false,
            message: "That date is before the employee's joining date.",
          });
          continue;
        }

        // Isolate the write per row: a write-time failure (CHECK violation,
        // transient DB error) must record a failed result and move on, never
        // abort the batch and lose the results already accumulated.
        try {
          await writeManualAttendance(db, {
            employeeId: employee.id,
            workDate: check.normalized.work_date,
            loginMinutes: check.normalized.login_minutes,
            logoutMinutes: check.normalized.logout_minutes,
            entrySource: "admin_bulk",
          });
          results.push({
            index,
            employee_id: employeeId,
            work_date: check.normalized.work_date,
            ok: true,
          });
        } catch (e) {
          results.push({
            index,
            employee_id: employeeId,
            work_date: check.normalized.work_date,
            ok: false,
            message: e instanceof Error ? e.message : "Could not save this day.",
          });
        }
      }

      const written = results.filter((r) => r.ok).length;
      const failed = results.length - written;
      return json({ ok: true, results, written, failed });
    }

    if (action === "decide_leave" || action === "decide_remote") {
      if (!isAdmin) return json({ error: "Admins only." }, 403);
      const approve = body.approve === true;
      const note = text(body.note, 500);
      const decided = { decided_by: user.id, decided_at: new Date().toISOString() };

      if (action === "decide_leave") {
        const { data: row } = await db
          .from("leave_requests")
          .update({ status: approve ? "approved" : "rejected", admin_note: note, ...decided })
          .eq("id", String(body.id ?? ""))
          .eq("status", "pending")
          .select("*, employees(profile_id, first_name, last_name)")
          .maybeSingle();
        if (!row) return fail("That request is no longer pending.");
        const label = rangeLabel(row.from_date, row.to_date, row.half_day);
        await notifyUser(db, profileOf(row.employees), {
          type: "hr_leave_decision",
          title: `Leave ${approve ? "approved" : "rejected"} — ${label}`,
          body: note
            ? `Admin note: ${note}`
            : `Your leave for ${label} was ${approve ? "approved" : "rejected"}.`,
          path: "/attendance",
          cta: "Open My Attendance",
        });
        return json({ ok: true });
      }

      const { data: row } = await db
        .from("attendance")
        .update({
          remote_status: approve ? "approved" : "rejected",
          remote_note: note,
          remote_decided_by: decided.decided_by,
          remote_decided_at: decided.decided_at,
        })
        .eq("id", String(body.attendance_id ?? ""))
        .eq("remote_status", "pending")
        .select("work_date, employees(profile_id)")
        .maybeSingle();
      if (!row) return fail("That request is no longer pending.");
      await notifyUser(db, profileOf(row.employees), {
        type: "hr_remote_decision",
        title: `Work from home ${approve ? "approved" : "rejected"} — ${fmtDate(row.work_date)}`,
        body: note
          ? `Admin note: ${note}`
          : approve
            ? "The day counts as a working day."
            : "The day will be treated as absent unless you apply for leave.",
        path: "/attendance",
        cta: "Open My Attendance",
      });
      return json({ ok: true });
    }

    // Salary slips are admin-only in the CRM; the admin sends one to the
    // employee's email when they ask for it. Only a FINALISED slip can be sent,
    // so what the employee receives always matches the locked record.
    if (action === "email_salary_slip") {
      if (!isAdmin) return json({ error: "Admins only." }, 403);
      const employeeId = String(body.employee_id ?? "");
      const month = String(body.month ?? "");
      const pdf = typeof body.pdf_base64 === "string" ? body.pdf_base64 : "";
      if (!/^\d{4}-\d{2}-01$/.test(month)) return fail("Invalid month.");
      if (!pdf || pdf.length > 4_000_000) return fail("The slip PDF is missing or too large.");
      const { data: slip } = await db
        .from("salary_slips")
        .select("status")
        .eq("employee_id", employeeId)
        .eq("month", month)
        .maybeSingle();
      if (slip?.status !== "final") return fail("Finalise the slip before emailing it.");
      const { data: emp } = await db
        .from("employees")
        .select("first_name, last_name, email, profile_id")
        .eq("id", employeeId)
        .maybeSingle();
      if (!emp) return fail("Employee not found.");
      let to = String(emp.email ?? "").trim();
      if (!to.includes("@") && emp.profile_id) {
        const { data: p } = await db
          .from("profiles")
          .select("email")
          .eq("id", emp.profile_id)
          .maybeSingle();
        to = String(p?.email ?? "").trim();
      }
      if (!to.includes("@")) return fail("This employee has no email address on record.");
      const label = new Date(`${month}T00:00:00Z`).toLocaleDateString("en-IN", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
      const name = nameOf(emp);
      const filename =
        text(body.filename, 120)?.replace(/[^\w.\-]+/g, "-") ||
        `Salary-Slip-${month.slice(0, 7)}.pdf`;
      await sendEmailWithAttachments({
        to,
        subject: `Salary slip — ${label}`,
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;color:#111827;line-height:1.6">
<p>Hi ${esc(emp.first_name)},</p>
<p>Please find attached your salary slip for <strong>${esc(label)}</strong>.</p>
<p>For any questions about it, reply to this email.</p>
<p>Regards,<br/>EaseMyOffice</p></div>`,
        attachments: [{ filename, content: pdf }],
      });
      return json({ ok: true, to, name });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
