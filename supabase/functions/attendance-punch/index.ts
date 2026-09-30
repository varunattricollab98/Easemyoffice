// Attendance LOGIN / LOGOUT — the ONLY writer of attendance data.
//
// POST body (from the signed-in user's browser via supabase.functions.invoke):
//   {
//     action: "login" | "logout",
//     latitude?, longitude?, accuracy?,   // from navigator.geolocation
//     client_error?,                      // geolocation error, when there is no fix
//     device_key, device_label?
//   }
//
// Always replies 200 with either
//   { ok: true,  action, attendance }            — accepted
//   { ok: false, reason, message }               — rejected (also audited)
// so the browser can show the reason; non-2xx is reserved for real faults.
//
// Security model: the verdict is decided here, never in the browser. The time
// is the server's clock, the distance is computed here, and every attempt —
// including rejections — is written to attendance_events. A browser cannot
// prove its GPS is genuine (DevTools can fake coordinates), so this is a strong
// deterrent with a complete audit trail, not tamper-proof location.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  checkPunch,
  closedDayStatus,
  istParts,
  lateMinutes,
  minutesBetween,
  overtimeMinutes,
  MAX_SESSION_MINUTES,
  REJECTION_MESSAGES,
  type DeviceStatus,
  type PunchKind,
  type RejectionReason,
} from "../_shared/attendance-rules.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const INACTIVE_STATUSES = new Set(["resigned", "terminated"]);

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    // 1) Caller from their JWT.
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not signed in." }, 401);

    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const action = body.action as PunchKind;
    if (action !== "login" && action !== "logout") {
      return json({ error: "action must be login or logout" }, 400);
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const latitude = num(body.latitude);
    const longitude = num(body.longitude);
    const accuracy = num(body.accuracy);
    const deviceKey = text(body.device_key, 100);
    const userAgent = text(req.headers.get("user-agent"), 400);
    const ip =
      text(req.headers.get("cf-connecting-ip"), 64) ??
      text((req.headers.get("x-forwarded-for") ?? "").split(",")[0], 64);

    const event = {
      profile_id: user.id,
      employee_id: null as string | null,
      attendance_id: null as string | null,
      event_type: action,
      latitude,
      longitude,
      accuracy_m: accuracy,
      distance_m: null as number | null,
      office_id: null as string | null,
      device_key: deviceKey,
      client_error: text(body.client_error, 200),
      ip,
      user_agent: userAgent,
    };

    const reject = async (reason: RejectionReason) => {
      await db.from("attendance_events").insert({ ...event, outcome: "rejected", reason });
      return json({ ok: false, reason, message: REJECTION_MESSAGES[reason] });
    };

    // 2) Employee + policy.
    const { data: employee } = await db
      .from("employees")
      .select("id, employment_status, office_id")
      .eq("profile_id", user.id)
      .maybeSingle();
    if (!employee) return reject("not_linked");
    event.employee_id = employee.id;
    if (INACTIVE_STATUSES.has(employee.employment_status)) return reject("inactive_employee");

    const { data: settings } = await db
      .from("hr_settings")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    const s = settings ?? {
      work_start: "09:30",
      grace_minutes: 15,
      required_minutes: 510,
      half_day_minutes: 240,
      default_office_id: null,
      require_geofence: true,
      require_device_approval: false,
    };

    // Employee's own office, else the default, else the first active one
    // (Phase 1 configures a single office).
    const officeId = employee.office_id ?? s.default_office_id;
    const officeQuery = db.from("office_locations").select("*").eq("active", true);
    const { data: offices } = officeId
      ? await officeQuery.eq("id", officeId).limit(1)
      : await officeQuery.order("created_at").limit(1);
    const office = offices?.[0] ?? null;
    event.office_id = office?.id ?? null;

    // 3) Device: first sight registers it. Pre-approved while approval is not
    //    required, so switching the requirement on later does not lock out
    //    devices that were already in use.
    let deviceStatus: DeviceStatus = "new";
    if (deviceKey) {
      const { data: device } = await db
        .from("attendance_devices")
        .select("id, status")
        .eq("employee_id", employee.id)
        .eq("device_key", deviceKey)
        .maybeSingle();
      if (device) {
        deviceStatus = device.status as DeviceStatus;
        await db
          .from("attendance_devices")
          .update({ last_seen_at: nowIso, user_agent: userAgent })
          .eq("id", device.id);
      } else {
        const status = s.require_device_approval ? "pending" : "approved";
        await db.from("attendance_devices").insert({
          employee_id: employee.id,
          device_key: deviceKey,
          label: text(body.device_label, 120),
          user_agent: userAgent,
          status,
        });
        deviceStatus = status;
      }
    }

    // 4) Device + location verdict (shared pure rules).
    const verdict = checkPunch({
      requireGeofence: !!s.require_geofence,
      requireDeviceApproval: !!s.require_device_approval,
      deviceStatus,
      office: office
        ? {
            latitude: Number(office.latitude),
            longitude: Number(office.longitude),
            radius_m: Number(office.radius_m),
            max_accuracy_m: Number(office.max_accuracy_m),
          }
        : null,
      latitude,
      longitude,
      accuracy,
    });
    event.distance_m = verdict.distance_m;
    if (!verdict.ok) return reject(verdict.reason);

    const today = istParts(now);
    const fix = {
      latitude,
      longitude,
      accuracy_m: accuracy,
      distance_m: verdict.distance_m,
    };

    // 5) State transition. Each update is conditional on the state that was
    //    read, so a double-tap cannot open or close a session twice.
    let attendance: Record<string, unknown> | null = null;

    if (action === "login") {
      const { data: row } = await db
        .from("attendance")
        .select("*")
        .eq("employee_id", employee.id)
        .eq("work_date", today.date)
        .maybeSingle();

      if (!row) {
        const late = lateMinutes(today.minutes, String(s.work_start), Number(s.grace_minutes));
        const { data: inserted, error } = await db
          .from("attendance")
          .insert({
            employee_id: employee.id,
            work_date: today.date,
            office_id: office?.id ?? null,
            first_login_at: nowIso,
            open_since: nowIso,
            status: "in_progress",
            is_late: late > 0,
            late_minutes: late,
            login_latitude: fix.latitude,
            login_longitude: fix.longitude,
            login_accuracy_m: fix.accuracy_m,
            login_distance_m: fix.distance_m,
          })
          .select("*")
          .maybeSingle();
        // Unique (employee_id, work_date) violation = a concurrent login won.
        if (error || !inserted) return reject("already_logged_in");
        attendance = inserted;
      } else {
        if (row.open_since) return reject("already_logged_in");
        const { data: reopened } = await db
          .from("attendance")
          .update({ open_since: nowIso, status: "in_progress" })
          .eq("id", row.id)
          .is("open_since", null)
          .select("*")
          .maybeSingle();
        if (!reopened) return reject("already_logged_in");
        attendance = reopened;
      }
    } else {
      // Close the most recent open session — it may have started before
      // midnight, so it is looked up by state rather than by today's date.
      const { data: open } = await db
        .from("attendance")
        .select("*")
        .eq("employee_id", employee.id)
        .not("open_since", "is", null)
        .order("work_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!open) return reject("not_logged_in");

      const session = minutesBetween(String(open.open_since), nowIso);
      if (session > MAX_SESSION_MINUTES) return reject("session_too_long");

      const worked = Number(open.worked_minutes ?? 0) + session;
      const { data: closed } = await db
        .from("attendance")
        .update({
          open_since: null,
          last_logout_at: nowIso,
          worked_minutes: worked,
          status: closedDayStatus(worked, Number(s.half_day_minutes)),
          overtime_minutes: overtimeMinutes(worked, Number(s.required_minutes)),
          logout_latitude: fix.latitude,
          logout_longitude: fix.longitude,
          logout_accuracy_m: fix.accuracy_m,
          logout_distance_m: fix.distance_m,
        })
        .eq("id", open.id)
        .eq("open_since", open.open_since)
        .select("*")
        .maybeSingle();
      if (!closed) return reject("not_logged_in");
      attendance = closed;
    }

    await db.from("attendance_events").insert({
      ...event,
      attendance_id: attendance?.id ?? null,
      outcome: "accepted",
    });
    return json({ ok: true, action, attendance });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
