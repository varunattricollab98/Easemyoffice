// Compact LOGIN / LOGOUT for the dashboard header, so nobody has to open
// My Attendance just to punch. Same edge function, same WFH flow, and the same
// react-query keys as the attendance page, so both stay in sync.
//
// Renders nothing for logins that are not linked to an employee record.

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Home, Loader2, LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, getErrorMessage } from "@/lib/utils";
import { useLocationGate } from "@/components/hrms/location-gate";
import { useLoginOptions, type PunchOpts } from "@/components/hrms/login-options";
import { LOCATION_CANCELLED } from "@/lib/location-access";
import { useAuth } from "@/lib/auth";
import { formatMinutes, hrmsDb, type AttendanceRow, type Employee } from "@/lib/hrms";
import {
  istParts,
  lateMinutes,
  minutesBetween,
  normalizeSchedules,
  windowMinutes,
  MAX_SESSION_MINUTES,
  REJECTION_MESSAGES,
  type RejectionReason,
} from "@/lib/attendance-rules";
import { punch } from "@/lib/attendance-client";
import { fetchHrSettings, timeIST } from "@/lib/attendance-queries";
import { ATTENDANCE_CHANGED_EVENT } from "@/components/activity-heartbeat";

export function QuickPunch() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const { data: employee } = useQuery({
    queryKey: ["my-employee", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Employee | null> => {
      const { data } = await hrmsDb()
        .from("employees")
        .select("*")
        .eq("profile_id", user!.id)
        .maybeSingle();
      return data ?? null;
    },
  });
  const { data: settings } = useQuery({
    queryKey: ["hrms-settings"],
    queryFn: fetchHrSettings,
    enabled: !!employee,
  });
  const { data: current } = useQuery({
    queryKey: ["my-attendance-current", employee?.id],
    enabled: !!employee,
    queryFn: async (): Promise<AttendanceRow | null> => {
      const { data } = await hrmsDb()
        .from("attendance")
        .select("*")
        .eq("employee_id", employee!.id)
        .order("work_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ?? null;
    },
  });

  const ist = istParts(now);
  // A session left open on an earlier day (forgot to log out) is not "today":
  // show LOGIN, and the punch function closes the old one as a missed punch
  // out when the person logs in. Overnight sessions (< 16h) still count.
  const staleOpen =
    !!current?.open_since &&
    current.work_date < ist.date &&
    minutesBetween(current.open_since, now.toISOString()) > MAX_SESSION_MINUTES;
  const row =
    current && !staleOpen && (current.work_date === ist.date || current.open_since)
      ? current
      : null;
  const isIn = !!row?.open_since;

  const { getFix, dialog: locationDialog } = useLocationGate();
  // Late or refused login: Late login / Work from home / Half day / Leave.
  const options = useLoginOptions({
    doPunch: (o) => act.mutate(o),
    onRequestSent: () => {
      qc.invalidateQueries({ queryKey: ["my-attendance-current", employee?.id] });
      qc.invalidateQueries({ queryKey: ["my-attendance-month", employee?.id] });
    },
  });
  const act = useMutation({
    mutationFn: async (opts: PunchOpts = {}) => {
      // Location first: if it is off or blocked, a dialog explains how to turn
      // it on for this device and retries, instead of a silent rejection.
      const fix = opts.fix ?? (await getFix());
      if (!fix) throw new Error(LOCATION_CANCELLED);
      const action = isIn ? "logout" : "login";
      // First login of the day after the on-time start: ask why first.
      if (action === "login" && !row && !opts.remote && opts.lateReason === undefined) {
        const lateBy = lateMinutes(
          istParts(new Date()).minutes,
          normalizeSchedules(settings?.day_schedules)[istParts(new Date()).weekday],
          Number(settings?.grace_minutes ?? 15),
        );
        if (lateBy > 0) {
          options.open({
            mode: "late",
            fix,
            message: `You are ${formatMinutes(lateBy)} late today.`,
          });
          throw new Error(LOCATION_CANCELLED);
        }
      }
      return punch(action, { ...opts, fix });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["my-attendance-current", employee?.id] });
      qc.invalidateQueries({ queryKey: ["my-attendance-month", employee?.id] });
      qc.invalidateQueries({ queryKey: ["my-attendance-events"] });
      window.dispatchEvent(new Event(ATTENDANCE_CHANGED_EVENT));
      if (res.ok) {
        toast.success(
          res.action === "login"
            ? res.remote
              ? "Logged in from home — sent to the admin for approval"
              : "Logged in — have a good day"
            : "Logged out",
        );
      } else if (res.remote_allowed) {
        options.open({
          mode: "blocked",
          fix: res.fix,
          message: res.message || REJECTION_MESSAGES[res.reason as RejectionReason],
        });
      } else {
        const base = res.message || REJECTION_MESSAGES[res.reason as RejectionReason];
        const msg =
          typeof res.attempts_left === "number" && res.reason !== "too_many_attempts"
            ? `${base} (${res.attempts_left} of 3 attempts left)`
            : base;
        toast.error(msg);
      }
    },
    onError: (e: unknown) => {
      if (e instanceof Error && e.message === LOCATION_CANCELLED) return;
      toast.error(getErrorMessage(e));
    },
  });

  if (!employee) return null;

  const todaySchedule = normalizeSchedules(settings?.day_schedules)[ist.weekday];
  const sched = row?.schedule_mode
    ? {
        mode: row.schedule_mode,
        start: String(row.window_start).slice(0, 5),
        end: String(row.window_end).slice(0, 5),
      }
    : todaySchedule;
  const required = row?.required_minutes ?? todaySchedule.required_minutes;
  const completed =
    (row?.window_minutes ?? 0) +
    (row?.open_since ? windowMinutes(row.open_since, now.toISOString(), row.work_date, sched) : 0);

  const status = isIn
    ? `In since ${timeIST(row!.first_login_at)}`
    : row
      ? `Out at ${timeIST(row.last_logout_at)}`
      : "Not logged in";

  return (
    <>
      {locationDialog}
      <div className="flex items-center gap-3 rounded-2xl border border-black/[0.06] bg-white/60 py-1.5 pl-3 pr-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_3px_rgba(0,0,0,0.04)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]">
        <Link to="/attendance" className="min-w-0 text-xs leading-tight" title="Open My Attendance">
          <div className="flex items-center gap-1.5 font-medium">
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                isIn
                  ? "animate-pulse bg-emerald-500"
                  : row
                    ? "bg-muted-foreground/50"
                    : "bg-amber-500",
              )}
            />
            <span className="truncate">{status}</span>
            {row?.work_mode === "remote" && <Home className="h-3 w-3 text-indigo-500" />}
          </div>
          <div className="tabular-nums text-muted-foreground">
            {formatMinutes(completed)}
            {required > 0 && ` / ${formatMinutes(required)}`} today
          </div>
        </Link>
        <Button
          size="sm"
          disabled={act.isPending}
          onClick={() => act.mutate({})}
          className={cn(
            "h-9 rounded-xl px-4 font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.08),0_6px_14px_-6px_rgba(0,0,0,0.35)] active:scale-[0.97]",
            isIn
              ? "bg-gradient-to-b from-rose-500 to-rose-600 hover:from-rose-500 hover:to-rose-700"
              : "bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-500 hover:to-emerald-700",
          )}
        >
          {act.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isIn ? (
            <>
              <LogOut className="mr-1 h-4 w-4" /> Logout
            </>
          ) : (
            <>
              <LogIn className="mr-1 h-4 w-4" /> Login
            </>
          )}
        </Button>
      </div>

      {options.dialog}
    </>
  );
}
