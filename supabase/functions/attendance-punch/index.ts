// Attendance LOGIN / LOGOUT — the ONLY writer of attendance data.
//
// POST body (from the signed-in user's browser via supabase.functions.invoke):
//   {
//     action: "login" | "logout",
//     latitude?, longitude?, accuracy?,   // from navigator.geolocation
//     client_error?,                      // geolocation error, when there is no fix
//     device_key, device_label?,
//     remote?: true, remote_reason?       // work-from-home login request
//   }
//
// Always replies 200 with either
//   { ok: true,  action, attendance, remote? }             — accepted
//   { ok: false, reason, message, remote_allowed? }        — rejected (also audited)
// so the browser can show the reason; non-2xx is reserved for real faults.
//
// Security model: the verdict is decided here, never in the browser. The time
// is the server's clock, the distance is computed here, and every attempt —
// including rejections — is written to attendance_events. A browser cannot
// prove its GPS is genuine (DevTools can fake coordinates), so this is a strong
// deterrent with a complete audit trail, not tamper-proof location.
//
// Work from home: a login outside the office can be sent as a WFH request. It
// is accepted immediately (so the hours are tracked) but the day only counts
// once an admin approves it; admins get an email + CRM alert.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  checkPunch,
  closeDay,
  istParts,
  lateMinutes,
  minutesBetween,
  normalizeSchedules,
  windowMinutes,
  weekdayOf,
  MAX_SESSION_MINUTES,
  MAX_PUNCH_ATTEMPTS,
  spoofSignals,
  SPOOF_SIGNAL_LABELS,
  type SpoofSignal,
  PUNCH_ATTEMPT_WINDOW_MINUTES,
  REJECTION_MESSAGES,
  REMOTE_ELIGIBLE,
  type DaySchedule,
  type DeviceStatus,
  type PunchKind,
  type RejectionReason,
} from "../_shared/attendance-rules.ts";
import { notifyAdmins } from "../_shared/hr-notify.ts";

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

const timeIST = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });

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
    const wantsRemote = body.remote === true;
    const remoteReason = text(body.remote_reason, 300);
    const lateReason = text(body.late_reason, 300);
    const deviceFp = text(body.device_fp, 64);
    const fixTimestamp = num(body.fix_timestamp);
    const fixSamples = num(body.fix_samples);
    const fixSpread = num(body.fix_spread_m);
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

    // Cross-employee shared-device flags, set by the device block below. Kept
    // in this scope so a rejected attempt from a shared device is still flagged.
    let sharedDevice = false;
    let sharedWithEmployeeId: string | null = null;
    // Failed attempts already made in the current window (set once the
    // employee is known); every rejection tells the user how many are left.
    let priorRejections = 0;
    // Location-spoofing signal tokens, recorded on the event (accepted or not).
    let spoofTokens: string[] = [];
    const reject = async (reason: RejectionReason, extra: Record<string, unknown> = {}) => {
      const flagged = [reason, sharedDevice ? "shared_device" : null, ...spoofTokens]
        .filter(Boolean)
        .join("|");
      await db.from("attendance_events").insert({ ...event, outcome: "rejected", reason: flagged });
      const attempts_left = event.employee_id
        ? Math.max(0, MAX_PUNCH_ATTEMPTS - priorRejections - 1)
        : undefined;
      return json({ ok: false, reason, message: REJECTION_MESSAGES[reason], attempts_left, ...extra });
    };

    // 2) Employee + policy.
    const { data: employee } = await db
      .from("employees")
      .select("id, first_name, last_name, employee_code, employment_status, office_id")
      .eq("profile_id", user.id)
      .maybeSingle();
    if (!employee) return reject("not_linked");
    event.employee_id = employee.id;
    if (INACTIVE_STATUSES.has(employee.employment_status)) return reject("inactive_employee");

    // At most MAX_PUNCH_ATTEMPTS failed punches per window. Beyond that the
    // attempt is refused without another audit row, so repeated tapping no
    // longer floods the security log. A work-from-home login stays allowed:
    // it is the way out offered to the user.
    if (body.remote !== true) {
      const since = new Date(Date.now() - PUNCH_ATTEMPT_WINDOW_MINUTES * 60_000).toISOString();
      const { count } = await db
        .from("attendance_events")
        .select("id", { count: "exact", head: true })
        .eq("employee_id", employee.id)
        .eq("outcome", "rejected")
        .gte("created_at", since);
      priorRejections = count ?? 0;
      if (priorRejections >= MAX_PUNCH_ATTEMPTS) {
        return json({
          ok: false,
          reason: "too_many_attempts",
          message: REJECTION_MESSAGES.too_many_attempts,
          attempts_left: 0,
          remote_allowed: true,
        });
      }
    }
    const employeeName = [employee.first_name, employee.last_name].filter(Boolean).join(" ");

    const { data: settings } = await db
      .from("hr_settings")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    const s = settings ?? {};
    const schedules = normalizeSchedules(s.day_schedules);
    const grace = Number(s.grace_minutes ?? 15);
    const halfDay = Number(s.half_day_minutes ?? 240);
    const idleThreshold = Number(s.idle_threshold_minutes ?? 60);
    const allowRemote = s.allow_remote_requests !== false;

    // Employee's own office, else the default, else the first active one.
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
    // Live cross-employee sharing detection. A device_key registered to a
    // DIFFERENT employee means this machine is shared — we FLAG + ALERT but
    // never block (families and shared office PCs are legitimate; a false
    // block would lock a real employee out). Fully defensive: a failure here
    // must never reject or 500 the punch. The flags are declared earlier so
    // the reject() helper can mark a rejected attempt as shared too.
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
        // Best-effort: remember the hardware fingerprint (optional column).
        if (deviceFp) {
          await db
            .from("attendance_devices")
            .update({ fingerprint: deviceFp })
            .eq("id", device.id)
            .then(() => undefined, () => undefined);
        }
      } else {
        // Unknown browser key. If the same hardware (fingerprint) is already
        // approved or blocked for this employee, it is the same phone/laptop
        // whose browser storage was cleared: keep its decision instead of
        // asking the admin to approve it again.
        let inherited: DeviceStatus | null = null;
        if (deviceFp) {
          try {
            const { data: twin, error: twinErr } = await db
              .from("attendance_devices")
              .select("status")
              .eq("employee_id", employee.id)
              .eq("fingerprint", deviceFp)
              .in("status", ["approved", "revoked"])
              .order("last_seen_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (!twinErr && twin) inherited = twin.status as DeviceStatus;
          } catch {
            /* fingerprint column not added yet */
          }
        }
        const status = inherited ?? (s.require_device_approval ? "pending" : "approved");
        const row = {
          employee_id: employee.id,
          device_key: deviceKey,
          label: text(body.device_label, 120),
          user_agent: userAgent,
          status,
        };
        const { error: insErr } = await db
          .from("attendance_devices")
          .insert(deviceFp ? { ...row, fingerprint: deviceFp } : row);
        if (insErr && deviceFp) await db.from("attendance_devices").insert(row);
        deviceStatus = status as DeviceStatus;
      }

      try {
        // The user's ask is specifically another employee's APPROVED device, so
        // the alert signal is scoped to status = 'approved' (a revoked or
        // pending registration under someone else is not an active shared
        // device). Defensive: a detection failure must never block the punch.
        const { data: others } = await db
          .from("attendance_devices")
          .select("employee_id, status")
          .eq("device_key", deviceKey)
          .eq("status", "approved")
          .neq("employee_id", employee.id)
          .limit(1);
        const other = others?.[0] ?? null;
        if (other?.employee_id) {
          sharedDevice = true;
          sharedWithEmployeeId = other.employee_id as string;
        }
      } catch {
        /* best-effort — never block the punch on a detection failure */
      }
    }

    // The open session decides whether a logout needs the office geofence: a
    // work-from-home session is logged out of from home.
    const { data: openRow } = await db
      .from("attendance")
      .select("*")
      .eq("employee_id", employee.id)
      .not("open_since", "is", null)
      .order("work_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    let open = openRow;

    // A session left open on an earlier day (forgot to log out) can never be
    // closed by a punch: it is past MAX_SESSION_MINUTES. Left alone it blocked
    // the person for good (LOGOUT refused, LOGIN never offered). Close it as a
    // missed punch out (no logout time, so it stays "Logout missing" for the
    // admin to correct), then carry on with today.
    if (
      open &&
      String(open.work_date) < istParts(now).date &&
      minutesBetween(String(open.open_since), nowIso) > MAX_SESSION_MINUTES
    ) {
      const note = "Missed punch out";
      await db
        .from("attendance")
        .update({
          open_since: null,
          remarks: open.remarks ? `${open.remarks} · ${note}` : note,
        })
        .eq("id", open.id)
        .eq("open_since", open.open_since);
      open = null;
      if (action === "logout") return reject("stale_session_closed");
    }
    const remoteLogout = action === "logout" && open?.work_mode === "remote";
    const today = istParts(now);
    const { data: todayRow } =
      action === "login"
        ? await db
            .from("attendance")
            .select("*")
            .eq("employee_id", employee.id)
            .eq("work_date", today.date)
            .maybeSingle()
        : { data: null };
    // Logging in again from home on a day that is already WFH continues it
    // without asking for a reason a second time.
    const continuingRemote =
      todayRow?.work_mode === "remote" && todayRow?.remote_status !== "rejected";

    // 4) Device + location verdict (shared pure rules).
    const verdict = checkPunch({
      requireGeofence: !!(s.require_geofence ?? true) && !remoteLogout,
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

    // 4b) Location-spoofing signals. "block" ones are near-impossible for a
    //     real reading (hand-typed coordinates, teleporting); "warn" ones are
    //     recorded and alerted but allowed, because they can be legitimate.
    let spoofWarn: SpoofSignal[] = [];
    if (latitude !== null && longitude !== null) {
      try {
        const { data: prev } = await db
          .from("attendance_events")
          .select("latitude, longitude, created_at")
          .eq("employee_id", employee.id)
          .eq("outcome", "accepted")
          .not("latitude", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const { data: same } = await db
          .from("attendance_events")
          .select("id")
          .eq("employee_id", employee.id)
          .eq("outcome", "accepted")
          .eq("latitude", latitude)
          .eq("longitude", longitude)
          .lt("created_at", `${today.date}T00:00:00+05:30`)
          .limit(1);
        const sig = spoofSignals({
          latitude,
          longitude,
          accuracy,
          nowMs: now.getTime(),
          fixTimestampMs: fixTimestamp,
          samples: fixSamples,
          spreadM: fixSpread,
          previous: prev
            ? {
                latitude: Number(prev.latitude),
                longitude: Number(prev.longitude),
                atMs: Date.parse(String(prev.created_at)),
              }
            : null,
          repeatOfEarlierDay: !!(same && same.length),
        });
        spoofWarn = sig.warn;
        spoofTokens = [...sig.block, ...sig.warn].map((x) => `suspect_${x}`);
        // Alert on every block; on warnings only when they are not just the
        // (common, laptop Wi-Fi) exact repeat on its own.
        const alert =
          sig.block.length > 0 ||
          sig.warn.length >= 2 ||
          sig.warn.some((w) => w !== "exact_repeat");
        if (alert) {
          const all = [...sig.block, ...sig.warn];
          await notifyAdmins(db, {
            type: "hr_spoof_suspect",
            title: `${sig.block.length ? "Fake location blocked" : "Suspicious location"} — ${employeeName}`,
            body: `${employeeName} tried to ${action === "login" ? "log in" : "log out"} at ${timeIST(nowIso)}: ${all
              .map((x) => SPOOF_SIGNAL_LABELS[x])
              .join("; ")}.`,
            details: [
              ["Employee", `${employeeName} (${employee.employee_code})`],
              ["Signals", all.map((x) => SPOOF_SIGNAL_LABELS[x]).join("; ")],
              ["Result", sig.block.length ? "Blocked" : "Allowed, flagged"],
              ["Location", `${latitude}, ${longitude} (±${accuracy ?? "?"} m)`],
              ["When", timeIST(nowIso)],
              ["IP", ip ?? "—"],
            ],
            path: "/hrms/attendance",
            cta: "Open Security",
          }).catch(() => undefined);
        }
        if (sig.block.length) return reject("location_suspicious");
      } catch {
        /* detection must never break a genuine punch */
      }
    }

    let remote = false;
    if (!verdict.ok) {
      const eligible =
        action === "login" && allowRemote && REMOTE_ELIGIBLE.includes(verdict.reason);
      if (!eligible) return reject(verdict.reason);
      // Outside the office: the browser offers a WFH request. A location is
      // still required so the admin can see where it came from.
      if (!wantsRemote && !continuingRemote)
        return reject(verdict.reason, { remote_allowed: true });
      if (latitude === null || longitude === null) return reject("no_location");
      if (!continuingRemote && (!remoteReason || remoteReason.length < 3))
        return reject("remote_reason_required", { remote_allowed: true });
      remote = true;
    }

    const fix = { latitude, longitude, accuracy_m: accuracy, distance_m: verdict.distance_m };

    // 5) State transition. Each update is conditional on the state that was
    //    read, so a double-tap cannot open or close a session twice.
    let attendance: Record<string, unknown> | null = null;
    let newRemotePending = false;

    if (action === "login") {
      const row = todayRow;
      if (!row) {
        // Snapshot today's rule. A company holiday behaves like a day off.
        const { data: hol } = await db
          .from("holidays")
          .select("id")
          .eq("date", today.date)
          .eq("active", true)
          .neq("holiday_type", "optional")
          .limit(1);
        const base = schedules[today.weekday];
        const sched: DaySchedule =
          hol && hol.length ? { ...base, mode: "off", required_minutes: 0 } : base;
        const late = lateMinutes(today.minutes, sched, grace);
        const { data: inserted, error } = await db
          .from("attendance")
          .insert({
            employee_id: employee.id,
            work_date: today.date,
            office_id: office?.id ?? null,
            first_login_at: nowIso,
            open_since: nowIso,
            last_activity_at: nowIso,
            status: "in_progress",
            is_late: late > 0,
            late_minutes: late,
            schedule_mode: sched.mode,
            window_start: sched.start,
            window_end: sched.end,
            required_minutes: sched.required_minutes,
            work_mode: remote ? "remote" : "office",
            remote_status: remote ? "pending" : null,
            remote_reason: remote ? remoteReason : null,
            // Reason given in the CRM when logging in late (shown in the Daily log).
            remarks: lateReason ? `Late login: ${lateReason}` : null,
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
        newRemotePending = remote;
      } else {
        if (row.open_since) return reject("already_logged_in");
        const patch: Record<string, unknown> = {
          open_since: nowIso,
          last_activity_at: nowIso,
          status: "in_progress",
        };
        // Coming back from home turns the day into a WFH day that needs approval
        // (unless it was already approved).
        if (remote) {
          patch.work_mode = "remote";
          patch.remote_reason = [row.remote_reason, remoteReason].filter(Boolean).join(" | ");
          if (row.remote_status !== "approved") {
            patch.remote_status = "pending";
            newRemotePending = row.remote_status !== "pending";
          }
        }
        const { data: reopened } = await db
          .from("attendance")
          .update(patch)
          .eq("id", row.id)
          .is("open_since", null)
          .select("*")
          .maybeSingle();
        if (!reopened) return reject("already_logged_in");
        attendance = reopened;
      }
    } else {
      if (!open) return reject("not_logged_in");
      const openSince = String(open.open_since);
      const session = minutesBetween(openSince, nowIso);
      if (session > MAX_SESSION_MINUTES) return reject("session_too_long");

      // Rows from before schedules existed fall back to today's rule for that weekday.
      const sched: DaySchedule = open.schedule_mode
        ? {
            mode: open.schedule_mode,
            start: String(open.window_start).slice(0, 5),
            end: String(open.window_end).slice(0, 5),
            required_minutes: Number(open.required_minutes ?? 0),
          }
        : schedules[weekdayOf(String(open.work_date))];

      const worked = Number(open.worked_minutes ?? 0) + session;
      const inWindow =
        Number(open.window_minutes ?? 0) +
        windowMinutes(openSince, nowIso, String(open.work_date), sched);
      const closed = closeDay({
        workedMinutes: worked,
        windowMinutes: inWindow,
        requiredMinutes: sched.required_minutes,
        halfDayMinutes: halfDay,
        mode: sched.mode,
      });

      // Idle up to logout: the last stretch since the previous CRM activity.
      const lastActivity =
        open.last_activity_at && open.last_activity_at > openSince
          ? open.last_activity_at
          : openSince;
      const idleGap = minutesBetween(String(lastActivity), nowIso);
      const idleAdd = idleGap >= idleThreshold ? idleGap : 0;

      const { data: closedRow } = await db
        .from("attendance")
        .update({
          open_since: null,
          last_logout_at: nowIso,
          last_activity_at: nowIso,
          worked_minutes: worked,
          window_minutes: inWindow,
          idle_minutes: Number(open.idle_minutes ?? 0) + idleAdd,
          status: closed.status,
          overtime_minutes: closed.overtimeMinutes,
          schedule_mode: sched.mode,
          window_start: sched.start,
          window_end: sched.end,
          required_minutes: sched.required_minutes,
          logout_latitude: fix.latitude,
          logout_longitude: fix.longitude,
          logout_accuracy_m: fix.accuracy_m,
          logout_distance_m: fix.distance_m,
        })
        .eq("id", open.id)
        .eq("open_since", open.open_since)
        .select("*")
        .maybeSingle();
      if (!closedRow) return reject("not_logged_in");
      if (idleAdd > 0) {
        await db.from("attendance_idle_periods").insert({
          attendance_id: open.id,
          employee_id: employee.id,
          started_at: lastActivity,
          ended_at: nowIso,
          minutes: idleAdd,
          ended_by: "logout",
        });
      }
      attendance = closedRow;
    }

    // Compose the accepted reason: remote_request and/or shared_device.
    const acceptedReason =
      [
        remote ? "remote_request" : null,
        sharedDevice ? "shared_device" : null,
        ...spoofWarn.map((x) => `suspect_${x}`),
      ]
        .filter(Boolean)
        .join("|") || null;
    const { data: acceptedEvent } = await db
      .from("attendance_events")
      .insert({
        ...event,
        attendance_id: attendance?.id ?? null,
        outcome: "accepted",
        reason: acceptedReason,
      })
      .select("id")
      .maybeSingle();

    // Best-effort: record the other owner on the event when the optional
    // shared_with_employee_id column exists. Done as a SEPARATE update so the
    // insert above still succeeds (punches keep working) when the migration is
    // not yet applied.
    if (sharedDevice && sharedWithEmployeeId && acceptedEvent?.id) {
      try {
        await db
          .from("attendance_events")
          .update({ shared_with_employee_id: sharedWithEmployeeId })
          .eq("id", acceptedEvent.id);
      } catch {
        /* column may not exist yet — the reason token still records sharing */
      }
    }

    // Alert admins once per punch when a shared device is detected on an
    // accepted login/logout. The admin can then Block or Delete the device.
    if (sharedDevice) {
      try {
        const { data: otherEmp } = sharedWithEmployeeId
          ? await db
              .from("employees")
              .select("first_name, last_name, employee_code")
              .eq("id", sharedWithEmployeeId)
              .maybeSingle()
          : { data: null };
        const otherName =
          [otherEmp?.first_name, otherEmp?.last_name].filter(Boolean).join(" ") ||
          "another employee";
        const otherCode = otherEmp?.employee_code ? ` (${otherEmp.employee_code})` : "";
        const deviceLabel = text(body.device_label, 120);
        await notifyAdmins(db, {
          type: "hr_shared_device",
          title: `Shared device detected — ${employeeName}`,
          body: `${employeeName} ${action === "login" ? "logged in" : "logged out"} at ${timeIST(nowIso)} from a device that is also registered to ${otherName}${otherCode}.`,
          details: [
            ["Employee", `${employeeName} (${employee.employee_code})`],
            [
              "Device",
              [deviceKey ? deviceKey.slice(0, 8) : "—", deviceLabel].filter(Boolean).join(" · "),
            ],
            ["Also registered to", `${otherName}${otherCode}`],
            ["Date", today.date],
            ["When", timeIST(nowIso)],
            ["IP", ip ?? "—"],
          ],
          path: "/hrms/attendance",
          cta: "Open Devices",
        });
      } catch {
        /* best-effort — detection must never break the punch */
      }
    }

    if (newRemotePending) {
      const where =
        verdict.distance_m != null
          ? `${(verdict.distance_m / 1000).toFixed(1)} km from the office`
          : "unknown";
      await notifyAdmins(db, {
        type: "hr_remote_request",
        title: `Work from home request — ${employeeName}`,
        body: `${employeeName} logged in from outside the office at ${timeIST(nowIso)} and asked to work from home today.`,
        details: [
          ["Employee", `${employeeName} (${employee.employee_code})`],
          ["Date", today.date],
          ["Reason", remoteReason ?? "—"],
          ["Location", where],
          ["GPS accuracy", accuracy != null ? `±${Math.round(accuracy)} m` : "—"],
          [
            "Map",
            latitude != null && longitude != null
              ? `https://maps.google.com/?q=${latitude},${longitude}`
              : "—",
          ],
        ],
        path: "/hrms/approvals",
        cta: "Review in CRM",
      });
    }

    return json({ ok: true, action, attendance, remote });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
