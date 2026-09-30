import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarCheck, LogIn, LogOut, MapPin, ShieldAlert, Loader2, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, getErrorMessage } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import {
  hrmsDb,
  formatMinutes,
  lateAfter,
  type AttendanceEvent,
  type AttendanceRow,
  type Employee,
} from "@/lib/hrms";
import {
  istParts,
  minutesBetween,
  summarizeMonth,
  REJECTION_MESSAGES,
  type RejectionReason,
} from "@/lib/attendance-rules";
import { punch } from "@/lib/attendance-client";
import {
  dateTimeIST,
  fetchAttendance,
  fetchHolidays,
  fetchHrSettings,
  monthRange,
  offDayHolidays,
  timeIST,
} from "@/lib/attendance-queries";
import { MonthCalendar, MonthNav, MonthStatsGrid } from "@/components/hrms/attendance-month";

export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({ meta: [{ title: "My Attendance — EaseMyOffice CRM" }] }),
  component: MyAttendancePage,
});

/** Re-renders every 30s so the running working time stays current. */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function MyAttendancePage() {
  const { user } = useAuth();
  const now = useNow();
  const today = istParts(now).date;
  const [ym, setYm] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
  }));

  const { data: employee, isLoading: loadingEmployee } = useQuery({
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

  if (loadingEmployee) {
    return (
      <div className="flex justify-center p-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-5 md:p-10">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold md:text-3xl">
          <CalendarCheck className="h-6 w-6 text-primary" /> My Attendance
        </h1>
        <p className="text-sm text-muted-foreground">
          Log in when you reach the office and log out when you leave. Your location is checked
          against the office area at each punch.
        </p>
      </div>
      {!employee ? (
        <Card>
          <CardContent className="flex items-start gap-3 p-6 text-sm">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-500" />
            <div>
              <div className="font-medium">Your login is not linked to an employee record yet.</div>
              <div className="text-muted-foreground">
                Ask the admin to add you under Employees and link your CRM login. Attendance becomes
                available right after.
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <TodayCard employee={employee} now={now} today={today} />
          <MonthCard
            employee={employee}
            year={ym.year}
            month={ym.month}
            today={today}
            onMonth={(year, month) => setYm({ year, month })}
          />
          <RecentAttemptsCard />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function TodayCard({ employee, now, today }: { employee: Employee; now: Date; today: string }) {
  const qc = useQueryClient();
  const [lastRejection, setLastRejection] = useState<string | null>(null);

  const { data: settings } = useQuery({ queryKey: ["hrms-settings"], queryFn: fetchHrSettings });

  // The open session can belong to yesterday (logged in before midnight), so
  // "today" is the latest row that is either today's or still open.
  const { data: current } = useQuery({
    queryKey: ["my-attendance-current", employee.id],
    queryFn: async (): Promise<AttendanceRow | null> => {
      const { data } = await hrmsDb()
        .from("attendance")
        .select("*")
        .eq("employee_id", employee.id)
        .order("work_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ?? null;
    },
  });
  const row = current && (current.work_date === today || current.open_since) ? current : null;
  const isIn = !!row?.open_since;
  const running =
    (row?.worked_minutes ?? 0) +
    (row?.open_since ? minutesBetween(row.open_since, now.toISOString()) : 0);

  const act = useMutation({
    mutationFn: () => punch(isIn ? "logout" : "login"),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["my-attendance-current", employee.id] });
      qc.invalidateQueries({ queryKey: ["my-attendance-month", employee.id] });
      qc.invalidateQueries({ queryKey: ["my-attendance-events"] });
      if (res.ok) {
        setLastRejection(null);
        toast.success(res.action === "login" ? "Logged in — have a good day" : "Logged out");
      } else {
        const msg = res.message || REJECTION_MESSAGES[res.reason as RejectionReason];
        setLastRejection(msg);
        toast.error(msg);
      }
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  const lateLine = settings
    ? `Office starts ${String(settings.work_start).slice(0, 5)} · late after ${lateAfter(
        String(settings.work_start),
        settings.grace_minutes,
      )}`
    : null;

  const statusBadge = isIn
    ? { label: "Logged in", className: "bg-primary/10 text-primary ring-primary/20" }
    : row
      ? { label: "Logged out", className: "bg-muted text-muted-foreground ring-border" }
      : {
          label: "Not logged in",
          className:
            "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
        };

  return (
    <Card className="overflow-hidden">
      <CardContent className="grid gap-5 p-5 md:grid-cols-[1fr_auto] md:items-center md:p-6">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Today</span>
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium ring-1",
                statusBadge.className,
              )}
            >
              {statusBadge.label}
            </span>
            {row?.is_late && (
              <Badge className="bg-amber-500/90 text-white hover:bg-amber-500/90">
                Late by {formatMinutes(row.late_minutes)}
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Login</div>
              <div className="font-semibold tabular-nums">{timeIST(row?.first_login_at)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Logout
              </div>
              <div className="font-semibold tabular-nums">
                {isIn ? "—" : timeIST(row?.last_logout_at)}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Working time
              </div>
              <div className="font-semibold tabular-nums">
                {formatMinutes(running)}
                {settings && (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    / {formatMinutes(settings.required_minutes)}
                  </span>
                )}
              </div>
            </div>
          </div>
          {lateLine && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> {lateLine}
            </div>
          )}
          {lastRejection && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {lastRejection}
            </div>
          )}
        </div>
        <Button
          size="lg"
          disabled={act.isPending}
          onClick={() => act.mutate()}
          className={cn(
            "h-14 min-w-[11rem] rounded-2xl text-base font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.08),0_10px_24px_-10px_rgba(0,0,0,0.35)] transition-all duration-300 active:scale-[0.97]",
            isIn
              ? "bg-gradient-to-b from-rose-500 to-rose-600 text-white hover:from-rose-500 hover:to-rose-700"
              : "bg-gradient-to-b from-emerald-500 to-emerald-600 text-white hover:from-emerald-500 hover:to-emerald-700",
          )}
        >
          {act.isPending ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Checking location…
            </>
          ) : isIn ? (
            <>
              <LogOut className="mr-2 h-5 w-5" /> LOGOUT
            </>
          ) : (
            <>
              <LogIn className="mr-2 h-5 w-5" /> LOGIN
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function MonthCard({
  employee,
  year,
  month,
  today,
  onMonth,
}: {
  employee: Employee;
  year: number;
  month: number;
  today: string;
  onMonth: (year: number, month: number) => void;
}) {
  const { from, to } = monthRange(year, month);
  const { data: settings } = useQuery({ queryKey: ["hrms-settings"], queryFn: fetchHrSettings });
  const { data: holidays = [] } = useQuery({
    queryKey: ["hrms-holidays-range", from, to],
    queryFn: () => fetchHolidays(from, to),
  });
  const { data: rows = [] } = useQuery({
    queryKey: ["my-attendance-month", employee.id, from],
    queryFn: () => fetchAttendance(from, to, employee.id),
  });

  const summary = useMemo(
    () =>
      summarizeMonth({
        year,
        month,
        today,
        records: rows,
        holidays: offDayHolidays(holidays),
        weekOffs: settings?.week_offs ?? [0, 6],
        requiredMinutes: settings?.required_minutes ?? 510,
        joiningDate: employee.joining_date,
        exitDate: employee.exit_date,
      }),
    [year, month, today, rows, holidays, settings, employee.joining_date, employee.exit_date],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="text-base">This month</CardTitle>
        <MonthNav year={year} month={month} onChange={onMonth} maxYearMonth={today.slice(0, 7)} />
      </CardHeader>
      <CardContent className="space-y-5">
        <MonthStatsGrid stats={summary.stats} />
        {summary.stats.actionNeeded > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            {summary.stats.actionNeeded} day(s) have a login without a logout, so their hours are
            not counted. Tell the admin so they can be corrected before month-end.
          </div>
        )}
        <MonthCalendar days={summary.days} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function RecentAttemptsCard() {
  const { user } = useAuth();
  const { data: events = [] } = useQuery({
    queryKey: ["my-attendance-events"],
    enabled: !!user,
    queryFn: async (): Promise<AttendanceEvent[]> => {
      const { data } = await hrmsDb()
        .from("attendance_events")
        .select("*")
        .eq("profile_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });
  if (events.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Recent punches</CardTitle>
      </CardHeader>
      <CardContent className="divide-y p-0">
        {events.map((e) => (
          <div key={e.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
            <div className="w-32 shrink-0 tabular-nums text-muted-foreground">
              {dateTimeIST(e.created_at)}
            </div>
            <div className="w-16 shrink-0 font-medium capitalize">{e.event_type}</div>
            <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {e.outcome === "accepted"
                ? e.distance_m != null
                  ? `${e.distance_m} m from office`
                  : "Accepted"
                : (REJECTION_MESSAGES[e.reason as RejectionReason] ?? e.reason)}
            </div>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                e.outcome === "accepted"
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
              )}
            >
              {e.outcome === "accepted" ? "Accepted" : "Rejected"}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
