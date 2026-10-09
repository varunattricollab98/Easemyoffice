import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  CalendarCheck,
  CalendarPlus,
  ClipboardCheck,
  Clock,
  Home,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  MoonStar,
  ShieldAlert,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, getErrorMessage } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import {
  hrmsDb,
  formatMinutes,
  ATTENDANCE_REQUEST_TYPES,
  type AttendanceEvent,
  type AttendanceRequest,
  type AttendanceRow,
  type Employee,
  type LeaveRequest,
} from "@/lib/hrms";
import {
  expandLeave,
  istParts,
  minutesBetween,
  normalizeSchedules,
  windowMinutes,
  REJECTION_MESSAGES,
  type RejectionReason,
} from "@/lib/attendance-rules";
import { hrRequest, punch, type Fix } from "@/lib/attendance-client";
import {
  buildEmployeeMonth,
  dateTimeIST,
  describeSchedule,
  fetchAttendance,
  fetchAttendanceRequests,
  fetchHolidays,
  fetchHrSettings,
  fetchIdlePeriods,
  fetchLeaves,
  leavePolicyOf,
  leaveRange,
  monthRange,
  offDayHolidays,
  timeIST,
} from "@/lib/attendance-queries";
import {
  DailyLog,
  IdlePeriods,
  LeaveBalance,
  MonthCalendar,
  MonthNav,
  MonthStatsGrid,
} from "@/components/hrms/attendance-month";
import { ATTENDANCE_CHANGED_EVENT } from "@/components/activity-heartbeat";

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
          Log in when you start and log out when you finish. At the office your location is checked
          against the office area; from home you can send a work-from-home request.
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
          <MonthSection
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
  const [remoteOffer, setRemoteOffer] = useState<{ fix: Fix; message: string } | null>(null);
  const [remoteReason, setRemoteReason] = useState("");

  const { data: settings } = useQuery({ queryKey: ["hrms-settings"], queryFn: fetchHrSettings });
  const schedules = normalizeSchedules(settings?.day_schedules);
  const todaySchedule = schedules[istParts(now).weekday];

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
  const nowIso = now.toISOString();
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
    (row?.open_since ? windowMinutes(row.open_since, nowIso, row.work_date, sched) : 0);
  const loggedTotal =
    (row?.worked_minutes ?? 0) + (row?.open_since ? minutesBetween(row.open_since, nowIso) : 0);
  const pct = required ? Math.min(100, Math.round((completed / required) * 100)) : 0;
  const idleNow =
    row?.open_since && row.last_activity_at ? minutesBetween(row.last_activity_at, nowIso) : 0;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["my-attendance-current", employee.id] });
    qc.invalidateQueries({ queryKey: ["my-attendance-month", employee.id] });
    qc.invalidateQueries({ queryKey: ["my-attendance-events"] });
    window.dispatchEvent(new Event(ATTENDANCE_CHANGED_EVENT));
  };

  const act = useMutation({
    mutationFn: (opts: { remote?: boolean; reason?: string; fix?: Fix } = {}) =>
      punch(isIn ? "logout" : "login", opts),
    onSuccess: (res) => {
      refresh();
      if (res.ok) {
        setLastRejection(null);
        setRemoteOffer(null);
        setRemoteReason("");
        toast.success(
          res.action === "login"
            ? res.remote
              ? "Logged in from home — sent to the admin for approval"
              : "Logged in — have a good day"
            : "Logged out",
        );
      } else if (res.remote_allowed) {
        setRemoteOffer({
          fix: res.fix,
          message: res.message || REJECTION_MESSAGES[res.reason as RejectionReason],
        });
      } else {
        const msg = res.message || REJECTION_MESSAGES[res.reason as RejectionReason];
        setLastRejection(msg);
        toast.error(msg);
      }
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

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
            {row?.work_mode === "remote" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900">
                <Home className="h-3 w-3" /> WFH ·{" "}
                {row.remote_status === "approved"
                  ? "approved"
                  : row.remote_status === "rejected"
                    ? "rejected"
                    : "awaiting approval"}
              </span>
            )}
            {row?.is_late && (
              <Badge className="bg-amber-500/90 text-white hover:bg-amber-500/90">
                Late by {formatMinutes(row.late_minutes)}
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Login" value={timeIST(row?.first_login_at)} />
            <Stat label="Logout" value={isIn ? "—" : timeIST(row?.last_logout_at)} />
            <Stat
              label="Hours completed"
              value={
                <>
                  {formatMinutes(completed)}
                  {required > 0 && (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      / {formatMinutes(required)}
                    </span>
                  )}
                </>
              }
            />
            <Stat
              label={isIn ? "Idle right now" : "CRM idle today"}
              value={formatMinutes(isIn ? idleNow : (row?.idle_minutes ?? 0))}
            />
          </div>
          {required > 0 && row && (
            <div className="space-y-1">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-700",
                    pct >= 100 ? "bg-emerald-500" : "bg-primary",
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="text-xs text-muted-foreground">
                {pct >= 100
                  ? `Day complete${loggedTotal > required ? ` · ${formatMinutes(loggedTotal - required)} overtime` : ""}`
                  : `${formatMinutes(required - completed)} left to complete the day`}
                {!isIn && row && completed < required && " — you logged out early"}
              </div>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {settings ? describeSchedule(todaySchedule, settings.grace_minutes) : "…"}
          </div>
          {lastRejection && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {lastRejection}
            </div>
          )}
        </div>
        <Button
          size="lg"
          disabled={act.isPending}
          onClick={() => act.mutate({})}
          className={cn(
            "h-14 w-full rounded-2xl md:w-auto md:min-w-[11rem] text-base font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.08),0_10px_24px_-10px_rgba(0,0,0,0.35)] transition-all duration-300 active:scale-[0.97]",
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

      <Dialog open={!!remoteOffer} onOpenChange={(v) => !v && setRemoteOffer(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Home className="h-5 w-5 text-indigo-500" /> Work from home today?
            </DialogTitle>
            <DialogDescription>
              {remoteOffer?.message} You can still log in — the admin gets an email and approves the
              day. Your hours and CRM activity are tracked as usual.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Reason</Label>
            <Textarea
              value={remoteReason}
              placeholder="e.g. Client calls from home, feeling unwell…"
              onChange={(e) => setRemoteReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoteOffer(null)}>
              Cancel
            </Button>
            <Button
              disabled={act.isPending || remoteReason.trim().length < 3}
              onClick={() =>
                remoteOffer &&
                act.mutate({ remote: true, reason: remoteReason.trim(), fix: remoteOffer.fix })
              }
            >
              {act.isPending ? "Sending…" : "Log in & request WFH"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MonthSection({
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
  // Holidays since the policy start too: the leave balance carries forward
  // from there, and a holiday inside an old leave must not count as leave.
  const policyStart = leavePolicyOf(settings).policyStart;
  const holidayFrom = policyStart < from ? policyStart : from;
  const { data: holidays = [] } = useQuery({
    queryKey: ["hrms-holidays-range", holidayFrom, to],
    queryFn: () => fetchHolidays(holidayFrom, to),
  });
  const { data: rows = [] } = useQuery({
    queryKey: ["my-attendance-month", employee.id, from],
    queryFn: () => fetchAttendance(from, to, employee.id),
  });
  const { data: idle = [] } = useQuery({
    queryKey: ["my-idle", employee.id, from],
    queryFn: () => fetchIdlePeriods(employee.id, from, to),
  });
  const { data: leaves = [] } = useQuery({
    queryKey: ["my-leaves", employee.id],
    queryFn: () =>
      fetchLeaves({ employeeId: employee.id, since: "2000-01-01", until: "2100-01-01" }),
  });

  const view = useMemo(
    () =>
      buildEmployeeMonth({
        employee,
        year,
        month,
        today,
        records: rows,
        holidays,
        settings,
        leaves,
      }),
    [employee, year, month, today, rows, holidays, settings, leaves],
  );

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <CardTitle className="text-base">Month overview</CardTitle>
          <MonthNav year={year} month={month} onChange={onMonth} maxYearMonth={today.slice(0, 7)} />
        </CardHeader>
        <CardContent className="space-y-5">
          <MonthStatsGrid stats={view.stats} />
          {view.stats.actionNeeded > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              {view.stats.actionNeeded} day(s) have a login without a logout, so their hours are not
              counted. Tell the admin so they can be corrected before month-end.
            </div>
          )}
          <MonthCalendar days={view.days} />
        </CardContent>
      </Card>

      <LeaveCard
        employee={employee}
        ledgerView={view}
        month={`${year}-${String(month).padStart(2, "0")}`}
      />

      <AttendanceRequestsCard employee={employee} today={today} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Daily attendance</CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          <DailyLog days={view.days} records={rows} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">CRM idle periods</CardTitle>
        </CardHeader>
        <CardContent>
          <IdlePeriods periods={idle} />
        </CardContent>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------

const LEAVE_STATUS_CLASS: Record<LeaveRequest["status"], string> = {
  pending: "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
  approved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  rejected: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  cancelled: "bg-muted text-muted-foreground",
};

function LeaveCard({
  employee,
  ledgerView,
  month,
}: {
  employee: Employee;
  ledgerView: ReturnType<typeof buildEmployeeMonth>;
  month: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ from: "", to: "", half: false, reason: "" });
  const { data: settings } = useQuery({ queryKey: ["hrms-settings"], queryFn: fetchHrSettings });
  const { data: history = [] } = useQuery({
    queryKey: ["my-leave-history", employee.id],
    queryFn: async (): Promise<LeaveRequest[]> => {
      const { data } = await hrmsDb()
        .from("leave_requests")
        .select("*")
        .eq("employee_id", employee.id)
        .order("from_date", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });
  const { data: rangeHolidays = [] } = useQuery({
    queryKey: ["hrms-holidays-range", f.from, f.to || f.from],
    enabled: !!f.from,
    queryFn: () => fetchHolidays(f.from, f.to || f.from),
  });

  const pendingThisMonth = ledgerView.stats.pendingLeave;
  const preview = f.from
    ? expandLeave(
        f.from,
        f.half ? f.from : f.to || f.from,
        f.half,
        normalizeSchedules(settings?.day_schedules),
        offDayHolidays(rangeHolidays).map((h) => h.date),
      ).reduce((a, d) => a + d.amount, 0)
    : 0;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["my-leaves", employee.id] });
    qc.invalidateQueries({ queryKey: ["my-leave-history", employee.id] });
  };
  const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const apply = useMutation({
    mutationFn: () =>
      hrRequest({
        action: "apply_leave",
        from: f.from,
        to: f.half ? f.from : f.to || f.from,
        half_day: f.half,
        reason: f.reason,
      }),
    onSuccess: () => {
      toast.success("Leave request sent to the admin");
      setOpen(false);
      setF({ from: "", to: "", half: false, reason: "" });
      refresh();
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => hrRequest({ action: "cancel_leave", id }),
    onSuccess: () => {
      toast.success("Leave request cancelled");
      refresh();
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  const policy = leavePolicyOf(settings);
  const left = Math.max(0, ledgerView.ledger.available - ledgerView.ledger.paid);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MoonStar className="h-4 w-4 text-teal-500" /> Leave
        </CardTitle>
        <Button size="sm" onClick={() => setOpen(true)}>
          <CalendarPlus className="mr-1 h-4 w-4" /> Apply for leave
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <LeaveBalance ledger={ledgerView.ledger} pending={pendingThisMonth} />
        <p className="text-xs text-muted-foreground">
          {policy.monthlyQuota} flexible leaves every month; up to {policy.carryCap} unused leave
          carries into the next month. Leave beyond the balance is unpaid. Balance shown for{" "}
          {monthLabel}.
        </p>
        {history.length > 0 && (
          <div className="divide-y rounded-lg border">
            {history.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <div className="w-36 shrink-0 font-medium tabular-nums">{leaveRange(l)}</div>
                <div className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {Number(l.days)} day{Number(l.days) === 1 ? "" : "s"}
                </div>
                <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {l.reason}
                  {l.admin_note && (
                    <span className="text-foreground"> · Admin: {l.admin_note}</span>
                  )}
                </div>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                    LEAVE_STATUS_CLASS[l.status],
                  )}
                >
                  {l.status}
                </span>
                {l.status === "pending" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate(l.id)}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Apply for leave</DialogTitle>
            <DialogDescription>
              {left > 0
                ? `You have ${left} paid leave left this month.`
                : "No paid leave left this month — this will be unpaid."}{" "}
              The admin gets an email to approve it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">From</Label>
                <Input
                  type="date"
                  value={f.from}
                  onChange={(e) => setF({ ...f, from: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Input
                  type="date"
                  value={f.half ? f.from : f.to}
                  disabled={f.half}
                  min={f.from}
                  onChange={(e) => setF({ ...f, to: e.target.value })}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={f.half}
                onCheckedChange={(v) => setF({ ...f, half: v === true })}
              />
              Half day (single date)
            </label>
            <div>
              <Label className="text-xs">Reason</Label>
              <Textarea
                rows={3}
                value={f.reason}
                onChange={(e) => setF({ ...f, reason: e.target.value })}
              />
            </div>
            {f.from && (
              <div className="rounded-md bg-muted/40 p-2 text-xs">
                Counts as <strong>{preview}</strong> working day{preview === 1 ? "" : "s"}{" "}
                (week-offs and holidays are free).
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={apply.isPending || !f.from || preview <= 0 || f.reason.trim().length < 3}
              onClick={() => apply.mutate()}
            >
              {apply.isPending ? "Sending…" : "Send request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------

const REQUEST_STATUS_CLASS: Record<AttendanceRequest["status"], string> = {
  pending: "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
  approved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  rejected: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  cancelled: "bg-muted text-muted-foreground",
};

/** Friendlier dialog labels than the stored type labels; ids stay exact. */
const REQUEST_TYPE_UI: Record<AttendanceRequest["type"], string> = {
  work_from_home: "Work from home",
  absence_clarification: "Explain an absence",
  missed_login_regularization: "I forgot to log in",
};

const requestTypeLabel = (type: AttendanceRequest["type"]) =>
  ATTENDANCE_REQUEST_TYPES.find((t) => t.id === type)?.label ?? type;

type RequestType = AttendanceRequest["type"];

const EMPTY_REQUEST_FORM = {
  type: "work_from_home" as RequestType,
  work_date: "",
  to_date: "",
  reason: "",
  login: "",
  logout: "",
};

function requestDateRange(r: AttendanceRequest) {
  const f = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  return r.to_date && r.to_date !== r.work_date
    ? `${f(r.work_date)} – ${f(r.to_date)}`
    : f(r.work_date);
}

/**
 * Lets an employee raise one of three attendance requests to the admin — work
 * from home, explaining an absence, or regularizing a day they forgot to log in
 * — and track/cancel them. Mirrors LeaveCard's structure exactly.
 */
function AttendanceRequestsCard({ employee, today }: { employee: Employee; today: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(EMPTY_REQUEST_FORM);

  const { data: history = [] } = useQuery({
    queryKey: ["my-attendance-requests", employee.id],
    queryFn: () => fetchAttendanceRequests({ employeeId: employee.id }),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["my-attendance-requests", employee.id] });
    qc.invalidateQueries({ queryKey: ["hrms-approval-counts"] });
  };

  const openDialog = () => {
    setF({ ...EMPTY_REQUEST_FORM, work_date: today });
    setOpen(true);
  };

  const isMissedLogin = f.type === "missed_login_regularization";
  const isWfh = f.type === "work_from_home";
  const canSubmit =
    !!f.work_date &&
    f.reason.trim().length >= 3 &&
    (!isMissedLogin || (!!f.login && !!f.logout && f.logout > f.login)) &&
    (!isWfh || !f.to_date || f.to_date >= f.work_date);

  const apply = useMutation({
    mutationFn: () =>
      hrRequest({
        action: "apply_attendance_request",
        type: f.type,
        work_date: f.work_date,
        ...(isWfh && f.to_date ? { to_date: f.to_date } : {}),
        reason: f.reason.trim(),
        ...(isMissedLogin ? { login: f.login, logout: f.logout } : {}),
      }),
    onSuccess: () => {
      toast.success("Request sent to the admin");
      setOpen(false);
      setF(EMPTY_REQUEST_FORM);
      refresh();
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => hrRequest({ action: "cancel_attendance_request", id }),
    onSuccess: () => {
      toast.success("Request cancelled");
      refresh();
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="h-4 w-4 text-indigo-500" /> Attendance requests
        </CardTitle>
        <Button size="sm" onClick={openDialog}>
          <CalendarPlus className="mr-1 h-4 w-4" /> Raise a request
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Ask the admin to work from home, explain a day you were absent, or regularize a day you
          forgot to log in. The admin gets an email and approves it.
        </p>
        {history.length > 0 && (
          <div className="divide-y rounded-lg border">
            {history.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <div className="w-36 shrink-0 font-medium tabular-nums">{requestDateRange(r)}</div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {requestTypeLabel(r.type)}
                </span>
                <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {r.type === "missed_login_regularization" &&
                    (r.requested_login_at || r.requested_logout_at) && (
                      <span className="text-foreground">
                        {timeIST(r.requested_login_at)} – {timeIST(r.requested_logout_at)} ·{" "}
                      </span>
                    )}
                  {r.reason}
                  {r.admin_note && (
                    <span className="text-foreground"> · Admin: {r.admin_note}</span>
                  )}
                </div>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                    REQUEST_STATUS_CLASS[r.status],
                  )}
                >
                  {r.status}
                </span>
                {r.status === "pending" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate(r.id)}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Raise a request</DialogTitle>
            <DialogDescription>
              Pick what you need and the admin gets an email to approve it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">What do you need?</Label>
              <Select
                value={f.type}
                onValueChange={(v) =>
                  setF((prev) => ({ ...prev, type: v as RequestType, to_date: "" }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ATTENDANCE_REQUEST_TYPES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {REQUEST_TYPE_UI[t.id]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{isWfh ? "From" : "Date"}</Label>
                <Input
                  type="date"
                  value={f.work_date}
                  onChange={(e) => setF({ ...f, work_date: e.target.value })}
                />
              </div>
              {isWfh && (
                <div>
                  <Label className="text-xs">To (optional)</Label>
                  <Input
                    type="date"
                    value={f.to_date}
                    min={f.work_date}
                    onChange={(e) => setF({ ...f, to_date: e.target.value })}
                  />
                </div>
              )}
            </div>
            {isMissedLogin && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Login time</Label>
                  <Input
                    type="time"
                    value={f.login}
                    onChange={(e) => setF({ ...f, login: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Logout time</Label>
                  <Input
                    type="time"
                    value={f.logout}
                    onChange={(e) => setF({ ...f, logout: e.target.value })}
                  />
                </div>
              </div>
            )}
            <div>
              <Label className="text-xs">Reason</Label>
              <Textarea
                rows={3}
                value={f.reason}
                onChange={(e) => setF({ ...f, reason: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={apply.isPending || !canSubmit} onClick={() => apply.mutate()}>
              {apply.isPending ? "Sending…" : "Send request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
                ? e.reason === "remote_request"
                  ? "Work from home request"
                  : e.distance_m != null
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
