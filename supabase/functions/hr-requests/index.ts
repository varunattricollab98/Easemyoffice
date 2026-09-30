// Leave requests and work-from-home decisions — the only writer of
// leave_requests and of the WFH decision on attendance.
//
// POST body (browser, via supabase.functions.invoke("hr-requests")):
//   employee: { action: "apply_leave", from, to, half_day?, reason }
//             { action: "cancel_leave", id }                 (own, pending only)
//   admin:    { action: "decide_leave", id, approve, note? }
//             { action: "decide_remote", attendance_id, approve, note? }
//
// Replies 200 { ok: true, ... } or 200 { ok: false, message } for business
// rule failures; non-2xx only for faults. Every new request emails + alerts the
// admins; every decision alerts the employee.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { expandLeave, istParts, addDays, normalizeSchedules } from "../_shared/attendance-rules.ts";
import { notifyAdmins, notifyUser } from "../_shared/hr-notify.ts";

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
    if (action === "apply_leave" || action === "cancel_leave") {
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

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
