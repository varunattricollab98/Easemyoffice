// Reminds anyone who is still logged in after the working window closes.
//
// A day left open does not count its hours: `worked_minutes` only accumulates
// when a session is closed, and a session older than 16 h is written off as a
// missed punch out. People were simply forgetting, and only found out at
// month-end. This nudges them while they can still fix it themselves.
//
// Triggered by pg_cron at 19:30 IST (14:00 UTC) — see
// setup/ADD_LOGOUT_REMINDER_CRON.sql. Sends at most ONE reminder per person
// per day, so a schedule that fires more often is safe.
//
// Required Edge Function secrets:
//   CRON_SECRET             -> shared secret for auth
//   RESEND_API_KEY          -> Resend API key (email; the bell works without it)
//   CRM_FROM_EMAIL          -> sender address
//   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  istParts,
  minutesToTime,
  normalizeSchedules,
  timeToMinutes,
} from "../_shared/attendance-rules.ts";
import { notifyUser } from "../_shared/hr-notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const NOTIFICATION_TYPE = "hr_logout_reminder";
/** Used when the day has no window of its own (a week off worked anyway). */
const FALLBACK_WINDOW_END = 19 * 60 + 30;

const INACTIVE_STATUSES = new Set(["resigned", "terminated", "inactive"]);

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) ?? {};
    } catch {
      /* no body */
    }
    const secret = String(body.secret ?? "");
    const headerSecret = req.headers.get("x-cron-secret") ?? "";
    if (!CRON_SECRET || (secret !== CRON_SECRET && headerSecret !== CRON_SECRET)) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const now = istParts(new Date());

    // Only once the day's window has closed. `force` is for a manual check.
    const { data: settings } = await db
      .from("hr_settings")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    const schedules = normalizeSchedules(settings?.day_schedules);
    const today = schedules[now.weekday];
    const windowEnd =
      today && today.mode !== "off" ? timeToMinutes(today.end) : FALLBACK_WINDOW_END;
    if (body.force !== true && now.minutes < windowEnd) {
      return json({
        ok: true,
        skipped: "the working window has not closed yet",
        now: minutesToTime(now.minutes),
        window_end: minutesToTime(windowEnd),
      });
    }

    // Sessions still open for today.
    const { data: openRows, error: openErr } = await db
      .from("attendance")
      .select("id, employee_id, work_date, first_login_at, open_since")
      .eq("work_date", now.date)
      .not("open_since", "is", null)
      .is("last_logout_at", null);
    if (openErr) throw new Error(openErr.message);
    if (!openRows || openRows.length === 0) {
      return json({ ok: true, open_sessions: 0, notified: 0 });
    }

    const employeeIds = [...new Set(openRows.map((r) => r.employee_id).filter(Boolean))];
    const { data: employees } = await db
      .from("employees")
      .select("id, first_name, last_name, profile_id, employment_status")
      .in("id", employeeIds);

    const byId = new Map(
      (
        (employees ?? []) as {
          id: string;
          first_name: string | null;
          last_name: string | null;
          profile_id: string | null;
          employment_status: string | null;
        }[]
      ).map((e) => [e.id, e]),
    );

    // One reminder per person per day: skip anyone already told since IST
    // midnight, so a more frequent schedule cannot turn into spam.
    const profileIds = [...byId.values()].map((e) => e.profile_id).filter(Boolean) as string[];
    const sinceIso = new Date(Date.parse(`${now.date}T00:00:00+05:30`)).toISOString();
    const alreadyTold = new Set<string>();
    if (profileIds.length) {
      const { data: sent } = await db
        .from("notifications")
        .select("user_id")
        .eq("type", NOTIFICATION_TYPE)
        .in("user_id", profileIds)
        .gte("created_at", sinceIso);
      for (const n of (sent ?? []) as { user_id: string }[]) alreadyTold.add(n.user_id);
    }

    let notified = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of openRows) {
      const employee = byId.get(row.employee_id);
      if (!employee || !employee.profile_id) {
        skipped++;
        continue;
      }
      if (INACTIVE_STATUSES.has(String(employee.employment_status))) {
        skipped++;
        continue;
      }
      if (alreadyTold.has(employee.profile_id)) {
        skipped++;
        continue;
      }

      const name = employee.first_name?.trim() || "there";
      const since = row.open_since ?? row.first_login_at;
      const sinceTime = since ? minutesToTime(istParts(new Date(since)).minutes) : null;
      const emailError = await notifyUser(db, employee.profile_id, {
        type: NOTIFICATION_TYPE,
        title: "You are still logged in",
        body: `${name}, your attendance for today is still open${
          sinceTime ? ` (logged in at ${sinceTime})` : ""
        }. Open My Attendance and press LOGOUT, otherwise today's hours are not counted.`,
        details: [
          ["Date", row.work_date],
          ...(sinceTime ? ([["Logged in at", sinceTime]] as [string, string][]) : []),
        ],
        path: "/attendance",
        cta: "Open My Attendance",
      });
      if (emailError) errors.push(`${employee.profile_id}: ${emailError}`);
      alreadyTold.add(employee.profile_id);
      notified++;
    }

    return json({
      ok: true,
      date: now.date,
      open_sessions: openRows.length,
      notified,
      skipped,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 200);
  }
});
