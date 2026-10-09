import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CalendarCheck,
  ShieldAlert,
  Smartphone,
  UserCheck,
  UserX,
  Clock,
  LogIn,
  Check,
  Ban,
  Home,
  Coffee,
  MoonStar,
  Download,
  CalendarPlus,
  CalendarRange,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, getErrorMessage } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import {
  hrmsDb,
  employeeName,
  formatMinutes,
  type AttendanceDevice,
  type AttendanceEvent,
  type AttendanceRow,
  type Department,
  type Employee,
  type LeaveRequest,
} from "@/lib/hrms";
import {
  istParts,
  minutesBetween,
  normalizeSchedules,
  weekdayOf,
  windowMinutes,
  DAY_KIND_LABELS,
  REJECTION_MESSAGES,
  type RejectionReason,
} from "@/lib/attendance-rules";
import { downloadCsv, hoursDecimal } from "@/lib/csv";
import {
  buildEmployeeMonth,
  dateTimeIST,
  describeSchedule,
  fetchAttendance,
  fetchHolidays,
  fetchHrSettings,
  fetchIdlePeriods,
  fetchLeaves,
  leavePolicyOf,
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
import { GlassTabs } from "@/components/hrms/glass-tabs";
import { hrRequest } from "@/lib/attendance-client";
import { logAudit } from "@/lib/audit";

export const Route = createFileRoute("/_authenticated/hrms/attendance")({
  head: () => ({ meta: [{ title: "Attendance — EaseMyOffice CRM" }] }),
  // Admin guard lives on the /hrms layout route.
  component: AttendanceAdminPage,
});

type Tab = "today" | "monthly" | "security" | "devices";

const INACTIVE = new Set(["resigned", "terminated"]);

function useEmployees() {
  return useQuery({
    queryKey: ["hrms-employees-lite"],
    queryFn: async (): Promise<Employee[]> => {
      const { data } = await hrmsDb().from("employees").select("*").order("first_name");
      return data ?? [];
    },
  });
}

function useDepartments() {
  return useQuery({
    queryKey: ["hrms-departments"],
    queryFn: async (): Promise<Department[]> => {
      const { data } = await hrmsDb().from("departments").select("*").order("name");
      return data ?? [];
    },
  });
}

function AttendanceAdminPage() {
  const [tab, setTab] = useState<Tab>("today");
  const today = istParts(new Date()).date;

  // Counts for the tab badges.
  const { data: rejectedToday = 0 } = useQuery({
    queryKey: ["hrms-rejected-today", today],
    queryFn: async (): Promise<number> => {
      const { count } = await hrmsDb()
        .from("attendance_events")
        .select("id", { count: "exact", head: true })
        .eq("outcome", "rejected")
        .gte("created_at", `${today}T00:00:00+05:30`);
      return count ?? 0;
    },
  });
  const { data: pendingDevices = 0 } = useQuery({
    queryKey: ["hrms-pending-devices"],
    queryFn: async (): Promise<number> => {
      const { count } = await hrmsDb()
        .from("attendance_devices")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      return count ?? 0;
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <CalendarCheck className="h-5 w-5 text-primary" /> Attendance
        </h2>
        <p className="text-sm text-muted-foreground">
          Geo-tagged logins and logouts. Every attempt is recorded, including rejected ones.
        </p>
      </div>
      <GlassTabs
        ariaLabel="Attendance view"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "today", label: "Today" },
          { id: "monthly", label: "Monthly" },
          { id: "security", label: "Security", count: rejectedToday, alert: true },
          { id: "devices", label: "Devices", count: pendingDevices, alert: true },
        ]}
      />
      {tab === "today" && <TodayView today={today} />}
      {tab === "monthly" && <MonthlyView today={today} />}
      {tab === "security" && <SecurityView />}
      {tab === "devices" && <DevicesView />}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Same "Download report" button on every tab — CSV that opens in Excel. */
function DownloadButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button variant="outline" size="sm" className="h-9" disabled={disabled} onClick={onClick}>
      <Download className="mr-1 h-4 w-4" /> Download report
    </Button>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Clock;
  label: string;
  value: number | string;
  tone: string;
}) {
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white/60 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_3px_rgba(0,0,0,0.04)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className={cn("rounded-lg p-1.5", tone)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function TodayView({ today }: { today: string }) {
  const { data: employees = [] } = useEmployees();
  const { data: departments = [] } = useDepartments();
  const { data: settings } = useQuery({ queryKey: ["hrms-settings"], queryFn: fetchHrSettings });
  const { data: holidays = [] } = useQuery({
    queryKey: ["hrms-holidays-range", today, today],
    queryFn: () => fetchHolidays(today, today),
  });
  const { data: rows = [] } = useQuery({
    queryKey: ["hrms-attendance-day", today],
    queryFn: () => fetchAttendance(today, today),
    refetchInterval: 60_000,
  });
  const { data: leavesToday = [] } = useQuery({
    queryKey: ["hrms-leaves-day", today],
    queryFn: () => fetchLeaves({ since: today, until: today }),
  });
  const { data: rejected = 0 } = useQuery({
    queryKey: ["hrms-rejected-today", today],
    queryFn: async (): Promise<number> => {
      const { count } = await hrmsDb()
        .from("attendance_events")
        .select("id", { count: "exact", head: true })
        .eq("outcome", "rejected")
        .gte("created_at", `${today}T00:00:00+05:30`);
      return count ?? 0;
    },
  });

  const schedule = normalizeSchedules(settings?.day_schedules)[weekdayOf(today)];
  const offDay = offDayHolidays(holidays)[0]?.name ?? null;
  const nonWorking = !!offDay || schedule.mode === "off";

  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const byEmployee = new Map(rows.map((r) => [r.employee_id, r]));
  const onLeave = new Map(
    leavesToday.filter((l) => l.status === "approved").map((l) => [l.employee_id, l]),
  );
  const active = employees.filter(
    (e) => !INACTIVE.has(e.employment_status) && (!e.joining_date || e.joining_date <= today),
  );
  const nowIso = new Date().toISOString();
  const inNow = rows.filter((r) => r.open_since).length;
  const remote = rows.filter((r) => r.work_mode === "remote").length;
  const late = rows.filter((r) => r.is_late).length;
  const idleNow = rows.filter(
    (r) =>
      r.open_since &&
      r.last_activity_at &&
      minutesBetween(r.last_activity_at, nowIso) >= (settings?.idle_threshold_minutes ?? 60),
  ).length;
  const notIn = nonWorking
    ? 0
    : active.filter((e) => !byEmployee.has(e.id) && !onLeave.has(e.id)).length;

  // Logged-in first, then logged-out, then on leave, then not in.
  const rank = (e: Employee) => {
    const r = byEmployee.get(e.id);
    return r ? (r.open_since ? 0 : 1) : onLeave.has(e.id) ? 2 : 3;
  };
  const sorted = [...active].sort(
    (a, b) => rank(a) - rank(b) || employeeName(a).localeCompare(employeeName(b)),
  );

  // Live figures for one employee today (an open session keeps counting).
  const liveRow = (e: Employee) => {
    const r = byEmployee.get(e.id);
    const sched = r?.schedule_mode
      ? {
          mode: r.schedule_mode,
          start: String(r.window_start).slice(0, 5),
          end: String(r.window_end).slice(0, 5),
        }
      : schedule;
    const completed =
      (r?.window_minutes ?? 0) +
      (r?.open_since ? windowMinutes(r.open_since, nowIso, r.work_date, sched) : 0);
    const required = r?.required_minutes ?? schedule.required_minutes;
    const idleOpen =
      r?.open_since && r.last_activity_at ? minutesBetween(r.last_activity_at, nowIso) : 0;
    const idleShown =
      (r?.idle_minutes ?? 0) +
      (idleOpen >= (settings?.idle_threshold_minutes ?? 60) ? idleOpen : 0);
    return { r, completed, required, idleOpen, idleShown };
  };

  const exportToday = () => {
    const statusOf = (e: Employee, r?: AttendanceRow) => {
      if (!r) return onLeave.has(e.id) ? "On leave" : nonWorking ? "Off" : "Not logged in";
      if (r.open_since) return "Logged in";
      return r.status === "short" ? "Left early" : r.status === "half_day" ? "Half day" : "Present";
    };
    downloadCsv(`attendance-${today}.csv`, [
      [
        "Employee",
        "Code",
        "Department",
        "Status",
        "Mode",
        "WFH status",
        "Late (min)",
        "Login",
        "Logout",
        "Completed (hrs)",
        "Required (hrs)",
        "Idle (hrs)",
        "Distance from office (m)",
      ],
      ...sorted.map((e) => {
        const { r, completed, required, idleShown } = liveRow(e);
        return [
          employeeName(e),
          e.employee_code,
          e.department_id ? (deptName.get(e.department_id) ?? "") : "",
          statusOf(e, r),
          r ? (r.work_mode === "remote" ? "WFH" : "Office") : "",
          r?.remote_status ?? "",
          r?.is_late ? r.late_minutes : 0,
          r ? timeIST(r.first_login_at) : "",
          r && !r.open_since ? timeIST(r.last_logout_at) : "",
          r ? hoursDecimal(completed) : "",
          hoursDecimal(required),
          r ? hoursDecimal(idleShown) : "",
          r?.login_distance_m ?? "",
        ];
      }),
    ]);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
          {nonWorking
            ? `Today is a ${offDay ? `holiday (${offDay})` : "weekly off"} — nobody is expected in.`
            : `Today: ${describeSchedule(schedule, settings?.grace_minutes ?? 15)}`}
        </div>
        <DownloadButton onClick={exportToday} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <Kpi
          icon={UserCheck}
          label="Present"
          value={rows.length}
          tone="bg-emerald-500/10 text-emerald-600"
        />
        <Kpi icon={LogIn} label="Logged in now" value={inNow} tone="bg-primary/10 text-primary" />
        <Kpi icon={Home} label="WFH" value={remote} tone="bg-indigo-500/10 text-indigo-600" />
        <Kpi icon={Clock} label="Late" value={late} tone="bg-amber-500/10 text-amber-600" />
        <Kpi icon={Coffee} label="Idle now" value={idleNow} tone="bg-amber-500/10 text-amber-600" />
        <Kpi
          icon={MoonStar}
          label="On leave"
          value={onLeave.size}
          tone="bg-teal-500/10 text-teal-600"
        />
        <Kpi icon={UserX} label="Not logged in" value={notIn} tone="bg-rose-500/10 text-rose-600" />
      </div>
      {rejected > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <ShieldAlert className="h-4 w-4" /> {rejected} rejected punch attempt(s) today — see the
          Security tab.
        </div>
      )}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Login</TableHead>
                <TableHead>Logout</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">Idle</TableHead>
                <TableHead className="text-right">Distance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    No active employees yet. Add them under Employees.
                  </TableCell>
                </TableRow>
              )}
              {sorted.map((e) => {
                const { r, completed, required, idleOpen, idleShown } = liveRow(e);
                return (
                  <TableRow key={e.id}>
                    <TableCell>
                      <div className="font-medium">{employeeName(e)}</div>
                      <div className="text-xs text-muted-foreground">
                        {[e.employee_code, e.department_id ? deptName.get(e.department_id) : null]
                          .filter(Boolean)
                          .join(" · ")}
                        {!e.profile_id && (
                          <span className="ml-1 text-amber-600">· no CRM login linked</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <TodayStatus
                        row={r}
                        nonWorking={nonWorking}
                        onLeave={onLeave.get(e.id)}
                        idleMinutes={idleOpen}
                        idleThreshold={settings?.idle_threshold_minutes ?? 60}
                      />
                    </TableCell>
                    <TableCell className="tabular-nums">{timeIST(r?.first_login_at)}</TableCell>
                    <TableCell className="tabular-nums">
                      {r?.open_since ? "—" : timeIST(r?.last_logout_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {r ? (
                        <>
                          {formatMinutes(completed)}
                          {required > 0 && (
                            <span className="text-muted-foreground">
                              {" "}
                              / {formatMinutes(required)}
                            </span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell
                      className={cn("text-right tabular-nums", idleShown > 0 && "text-amber-600")}
                    >
                      {r ? formatMinutes(idleShown) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r?.login_distance_m != null
                        ? r.login_distance_m >= 1000
                          ? `${(r.login_distance_m / 1000).toFixed(1)} km`
                          : `${r.login_distance_m} m`
                        : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function TodayStatus({
  row,
  nonWorking,
  onLeave,
  idleMinutes,
  idleThreshold,
}: {
  row?: AttendanceRow;
  nonWorking: boolean;
  onLeave?: LeaveRequest;
  idleMinutes: number;
  idleThreshold: number;
}) {
  const pill = (label: string, className: string) => (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium ring-1", className)}>
      {label}
    </span>
  );
  const green =
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900";
  const amber =
    "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900";
  const rose =
    "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900";
  const indigo =
    "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900";
  if (!row) {
    if (onLeave)
      return pill(
        onLeave.half_day ? "Half-day leave" : "On leave",
        "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:ring-teal-900",
      );
    return nonWorking
      ? pill("Off", "bg-muted text-muted-foreground ring-border")
      : pill("Not logged in", rose);
  }
  const statusLabel =
    row.status === "short" ? "Left early" : row.status === "half_day" ? "Half day" : "Logged out";
  return (
    <div className="flex flex-wrap items-center gap-1">
      {row.open_since
        ? pill("Logged in", "bg-primary/10 text-primary ring-primary/20")
        : pill(statusLabel, row.status === "present" ? green : amber)}
      {row.work_mode === "remote" &&
        pill(
          row.remote_status === "approved"
            ? "WFH"
            : row.remote_status === "rejected"
              ? "WFH rejected"
              : "WFH pending",
          row.remote_status === "rejected" ? rose : indigo,
        )}
      {row.is_late && pill(`Late ${formatMinutes(row.late_minutes)}`, amber)}
      {row.open_since &&
        idleMinutes >= idleThreshold &&
        pill(`Idle ${formatMinutes(idleMinutes)}`, amber)}
    </div>
  );
}

// ---------------------------------------------------------------------------

function MonthlyView({ today }: { today: string }) {
  const [ym, setYm] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
  }));
  const [openId, setOpenId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  // Single-day "Add / edit attendance" dialog. `prefill` seeds the employee +
  // date (used both by the header button and by clicking a day in the calendar).
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryPrefill, setEntryPrefill] = useState<{ employeeId?: string; date?: string }>({});
  const [bulkOpen, setBulkOpen] = useState(false);

  // After any successful write, refresh everything that reads the attendance
  // table so the Monthly grid, per-employee calendar, Today tab, daily events,
  // My Attendance, payroll and the command center all pick up the back-filled
  // days. The hrms-attendance-month key is also what payroll/salary reads; the
  // my-attendance-* keys back the employee-facing My Attendance screen.
  const invalidateAttendance = () => {
    queryClient.invalidateQueries({ queryKey: ["hrms-attendance-month"] });
    queryClient.invalidateQueries({ queryKey: ["hrms-attendance-day"] });
    queryClient.invalidateQueries({ queryKey: ["hrms-attendance-events"] });
    queryClient.invalidateQueries({ queryKey: ["my-attendance-current"] });
    queryClient.invalidateQueries({ queryKey: ["my-attendance-month"] });
    queryClient.invalidateQueries({ queryKey: ["my-attendance-events"] });
  };

  const openEntry = (prefill: { employeeId?: string; date?: string } = {}) => {
    setEntryPrefill(prefill);
    setEntryOpen(true);
  };
  const { from, to } = monthRange(ym.year, ym.month);
  const { data: employees = [] } = useEmployees();
  const { data: settings } = useQuery({ queryKey: ["hrms-settings"], queryFn: fetchHrSettings });
  const policyStart = leavePolicyOf(settings).policyStart;
  const since = policyStart < from ? policyStart : from;
  const { data: holidays = [] } = useQuery({
    queryKey: ["hrms-holidays-range", since, to],
    queryFn: () => fetchHolidays(since, to),
  });
  const { data: rows = [] } = useQuery({
    queryKey: ["hrms-attendance-month", from],
    queryFn: () => fetchAttendance(from, to),
  });
  const { data: leaves = [] } = useQuery({
    queryKey: ["hrms-leaves-since", since, to],
    queryFn: () => fetchLeaves({ since, until: to }),
  });

  const summaries = useMemo(() => {
    const group = <T extends { employee_id: string }>(list: T[]) => {
      const m = new Map<string, T[]>();
      for (const x of list) m.set(x.employee_id, [...(m.get(x.employee_id) ?? []), x]);
      return m;
    };
    const rowsBy = group(rows);
    const leavesBy = group(leaves);
    return employees
      .filter(
        (e) =>
          // Hide people who had left before this month and have no rows in it.
          rowsBy.has(e.id) || !INACTIVE.has(e.employment_status) || (e.exit_date ?? "") >= from,
      )
      .map((e) => ({
        employee: e,
        records: rowsBy.get(e.id) ?? [],
        ...buildEmployeeMonth({
          employee: e,
          year: ym.year,
          month: ym.month,
          today,
          records: rowsBy.get(e.id) ?? [],
          holidays,
          settings,
          leaves: leavesBy.get(e.id) ?? [],
        }),
      }));
  }, [rows, leaves, holidays, employees, settings, ym, today, from]);

  const open = summaries.find((s) => s.employee.id === openId) ?? null;

  // Summary per employee, then a blank line, then the day-by-day detail —
  // one file with everything payroll needs for the month.
  const exportMonth = () => {
    const ym = from.slice(0, 7);
    const fmt = (n: number) => (Number.isInteger(n) ? n : Number(n.toFixed(1)));
    const summary = [
      [`Attendance summary — ${ym}`],
      [
        "Employee",
        "Code",
        "Working days (so far)",
        "Working days (month)",
        "Present",
        "Left early",
        "Half days",
        "Absent",
        "Late",
        "WFH (approved)",
        "WFH pending",
        "Paid leave",
        "Unpaid leave",
        "Leave pending",
        "Logout missing",
        "Completed (hrs)",
        "Required (hrs)",
        "Overtime (hrs)",
        "Idle (hrs)",
      ],
      ...summaries.map(({ employee: e, stats: s }) => [
        employeeName(e),
        e.employee_code,
        s.elapsedWorkingDays,
        s.workingDays,
        s.present,
        s.short,
        s.halfDays,
        s.absent,
        s.late,
        s.remoteDays,
        s.remotePending,
        fmt(s.paidLeave),
        fmt(s.unpaidLeave),
        fmt(s.pendingLeave),
        s.actionNeeded,
        hoursDecimal(s.workedMinutes),
        hoursDecimal(s.requiredMinutes),
        hoursDecimal(s.overtimeMinutes),
        hoursDecimal(s.idleMinutes),
      ]),
    ];
    const detail = [
      [`Day-by-day — ${ym}`],
      [
        "Employee",
        "Code",
        "Date",
        "Day",
        "Status",
        "Mode",
        "Late (min)",
        "Login",
        "Logout",
        "Completed (hrs)",
        "Required (hrs)",
        "Idle (hrs)",
        "Leave",
      ],
      ...summaries.flatMap(({ employee: e, days, records }) => {
        const byDate = new Map(records.map((r) => [r.work_date, r]));
        return days
          .filter((d) => d.kind !== "not_employed" && d.kind !== "upcoming")
          .map((d) => {
            const r = byDate.get(d.date);
            return [
              employeeName(e),
              e.employee_code,
              d.date,
              ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.weekday],
              d.holidayName ?? DAY_KIND_LABELS[d.kind],
              r ? (r.work_mode === "remote" ? "WFH" : "Office") : "",
              r?.is_late ? r.late_minutes : "",
              r ? timeIST(r.first_login_at) : "",
              r && !r.open_since ? timeIST(r.last_logout_at) : "",
              r ? hoursDecimal(d.creditedMinutes) : "",
              d.nonWorking ? "" : hoursDecimal(d.requiredMinutes),
              r ? hoursDecimal(d.idleMinutes) : "",
              d.leave ? d.leave : "",
            ];
          });
      }),
    ];
    downloadCsv(`attendance-${ym}.csv`, [...summary, [], ...detail]);
  };
  const { data: openIdle = [] } = useQuery({
    queryKey: ["hrms-idle", openId, from],
    enabled: !!openId,
    queryFn: () => fetchIdlePeriods(openId!, from, to),
  });
  const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  return (
    <Card>
      <CardContent className="space-y-3 p-0">
        <div className="flex items-center justify-between px-4 pt-4">
          <div className="text-sm text-muted-foreground">
            Click a row for the calendar, daily log and leave balance.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="h-9" onClick={() => openEntry()}>
              <CalendarPlus className="mr-1 h-4 w-4" /> Add / edit attendance
            </Button>
            <Button variant="outline" size="sm" className="h-9" onClick={() => setBulkOpen(true)}>
              <CalendarRange className="mr-1 h-4 w-4" /> Bulk back-fill
            </Button>
            <DownloadButton onClick={exportMonth} disabled={summaries.length === 0} />
            <MonthNav
              year={ym.year}
              month={ym.month}
              onChange={(year, month) => setYm({ year, month })}
              maxYearMonth={today.slice(0, 7)}
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead className="text-right">Present</TableHead>
                <TableHead className="text-right">Early</TableHead>
                <TableHead className="text-right">Half</TableHead>
                <TableHead className="text-right">Absent</TableHead>
                <TableHead className="text-right">Late</TableHead>
                <TableHead className="text-right">WFH</TableHead>
                <TableHead className="text-right">PL / UL</TableHead>
                <TableHead className="text-right">⚠</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">Idle</TableHead>
                <TableHead className="text-right">OT</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaries.map(({ employee: e, stats }) => (
                <TableRow key={e.id} className="cursor-pointer" onClick={() => setOpenId(e.id)}>
                  <TableCell className="font-medium">{employeeName(e)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {stats.elapsedWorkingDays}/{stats.workingDays}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{stats.present}</TableCell>
                  <TableCell
                    className={cn("text-right tabular-nums", stats.short && "text-orange-600")}
                  >
                    {stats.short}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{stats.halfDays}</TableCell>
                  <TableCell
                    className={cn("text-right tabular-nums", stats.absent && "text-rose-600")}
                  >
                    {stats.absent}
                  </TableCell>
                  <TableCell
                    className={cn("text-right tabular-nums", stats.late && "text-amber-600")}
                  >
                    {stats.late}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {stats.remoteDays}
                    {stats.remotePending > 0 && (
                      <span className="text-indigo-600"> +{stats.remotePending}?</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">
                    {fmtDays(stats.paidLeave)} /{" "}
                    <span className={cn(stats.unpaidLeave > 0 && "text-rose-600")}>
                      {fmtDays(stats.unpaidLeave)}
                    </span>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      stats.actionNeeded && "text-amber-600",
                    )}
                  >
                    {stats.actionNeeded}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">
                    {formatMinutes(stats.workedMinutes)}
                    <span className="text-muted-foreground">
                      {" "}
                      / {formatMinutes(stats.requiredMinutes)}
                    </span>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      stats.idleMinutes > 0 && "text-amber-600",
                    )}
                  >
                    {formatMinutes(stats.idleMinutes)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMinutes(stats.overtimeMinutes)}
                  </TableCell>
                </TableRow>
              ))}
              {summaries.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={13}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    No employees for this month.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      <Dialog open={!!open} onOpenChange={(v) => !v && setOpenId(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{open ? employeeName(open.employee) : ""}</DialogTitle>
          </DialogHeader>
          {open && (
            <div className="space-y-5">
              <MonthStatsGrid stats={open.stats} />
              <LeaveBalance ledger={open.ledger} pending={open.stats.pendingLeave} />
              <div className="text-xs text-muted-foreground">
                Click any day to add or correct that day&rsquo;s attendance.
              </div>
              <MonthCalendar
                days={open.days}
                allowAnyDay
                onDayClick={(date) => openEntry({ employeeId: open.employee.id, date })}
              />
              <DailyLog days={open.days} records={open.records} />
              <div className="space-y-2">
                <div className="text-sm font-semibold">CRM idle periods</div>
                <IdlePeriods periods={openIdle} />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AttendanceEntryDialog
        open={entryOpen}
        onOpenChange={setEntryOpen}
        today={today}
        prefill={entryPrefill}
        onSaved={invalidateAttendance}
      />
      <BulkBackfillDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        today={today}
        onSaved={invalidateAttendance}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------

/** Active employees for the admin pickers: hide resigned/terminated and anyone
 *  who had not joined by the given date, sorted by name. */
function useActiveEmployees(onDate: string) {
  const { data: employees = [] } = useEmployees();
  return useMemo(
    () =>
      employees
        .filter(
          (e) =>
            !INACTIVE.has(e.employment_status) && (!e.joining_date || e.joining_date <= onDate),
        )
        .sort((a, b) => employeeName(a).localeCompare(employeeName(b))),
    [employees, onDate],
  );
}

/**
 * Single-day "Add / edit attendance": pick an employee + date + login (+ optional
 * logout + note) and create or correct that one day. The edge function
 * (admin-gated) is the source of truth and reuses the live scoring path, so an
 * admin-entered day looks exactly like a punched one.
 */
function AttendanceEntryDialog({
  open,
  onOpenChange,
  today,
  prefill,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  today: string;
  prefill: { employeeId?: string; date?: string };
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const employees = useActiveEmployees(today);
  const [employeeId, setEmployeeId] = useState("");
  const [workDate, setWorkDate] = useState("");
  const [login, setLogin] = useState("");
  const [logout, setLogout] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Seed the form each time the dialog opens (fresh prefill from the header
  // button or a clicked calendar day).
  useEffect(() => {
    if (!open) return;
    setEmployeeId(prefill.employeeId ?? "");
    setWorkDate(prefill.date ?? "");
    setLogin("");
    setLogout("");
    setNote("");
    setSaving(false);
  }, [open, prefill.employeeId, prefill.date]);

  const logoutBeforeLogin = !!login && !!logout && logout <= login;
  const canSubmit = !!employeeId && !!workDate && !!login && !logoutBeforeLogin && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await hrRequest({
        action: "admin_set_attendance",
        employee_id: employeeId,
        work_date: workDate,
        login,
        logout: logout || null,
        note: note || undefined,
      });
      const emp = employees.find((e) => e.id === employeeId);
      const label = emp ? `${employeeName(emp)} · ${workDate}` : workDate;
      toast.success(`Attendance saved for ${label}`);
      logAudit({
        actorId: user?.id,
        action: "edit",
        entity: "attendance",
        entityId: employeeId,
        entityLabel: label,
        detail: `Set attendance for ${label}: login ${login}${
          logout ? `, logout ${logout}` : " (login only)"
        }`,
        meta: { work_date: workDate, login, logout: logout || null },
      });
      onSaved();
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add / edit attendance</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Employee</label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick an employee" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {employeeName(e)} · {e.employee_code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="attn-date">
              Date
            </label>
            <Input
              id="attn-date"
              type="date"
              max={today}
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="attn-login">
                Login
              </label>
              <Input
                id="attn-login"
                type="time"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="attn-logout">
                Logout <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="attn-logout"
                type="time"
                value={logout}
                onChange={(e) => setLogout(e.target.value)}
              />
            </div>
          </div>
          {logoutBeforeLogin && (
            <div className="text-xs text-rose-600">Logout must be after login.</div>
          )}
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="attn-note">
              Note <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Textarea
              id="attn-note"
              rows={2}
              placeholder="e.g. back-filled from WhatsApp timings"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!canSubmit} onClick={submit}>
              {saving ? "Saving…" : "Save day"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type BulkRow = { date: string; login: string; logout: string };
type BulkResult = {
  index: number;
  employee_id: string;
  work_date: string;
  ok: boolean;
  message?: string;
};

/** Inclusive list of YYYY-MM-DD dates from `from` to `to` (both IST date-only
 *  strings). Returns [] if the range is empty or inverted. */
function dateRange(from: string, to: string): string[] {
  if (!from || !to || from > to) return [];
  const out: string[] = [];
  // Iterate on a UTC midnight cursor to avoid DST / local-zone drift; the
  // strings are plain calendar dates so UTC stepping is exact.
  let cursor = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  );
  const end = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  while (cursor <= end && out.length <= 400) {
    out.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 86_400_000;
  }
  return out;
}

/**
 * Bulk back-fill: pick ONE employee, choose a date range, then fill login/logout
 * per day in a table (one row per date). One submit writes every row that has a
 * login. This matches how WhatsApp timings are organized — one teammate at a
 * time across the range — and keeps the grid readable for ~11 days. The server
 * processes each row independently and returns a per-row pass/fail summary.
 */
function BulkBackfillDialog({
  open,
  onOpenChange,
  today,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  today: string;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const employees = useActiveEmployees(today);
  const defaultFrom = `${today.slice(0, 7)}-01`;
  const [employeeId, setEmployeeId] = useState("");
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);
  const [times, setTimes] = useState<Record<string, { login: string; logout: string }>>({});
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<BulkResult[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setEmployeeId("");
    setFrom(defaultFrom);
    setTo(today);
    setTimes({});
    setSaving(false);
    setResults(null);
  }, [open, defaultFrom, today]);

  const dates = useMemo(() => dateRange(from, to), [from, to]);
  const rows: BulkRow[] = dates.map((date) => ({
    date,
    login: times[date]?.login ?? "",
    logout: times[date]?.logout ?? "",
  }));

  const setTime = (date: string, field: "login" | "logout", value: string) =>
    setTimes((prev) => {
      const current = prev[date] ?? { login: "", logout: "" };
      return { ...prev, [date]: { ...current, [field]: value } };
    });

  const filled = rows.filter((r) => r.login);
  const anyBadOrder = rows.some((r) => r.login && r.logout && r.logout <= r.login);
  const rangeTooLong = !!from && !!to && from <= to && dates.length === 0;
  const canSubmit = !!employeeId && filled.length > 0 && !anyBadOrder && !rangeTooLong && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const entries = filled.map((r) => ({
        employee_id: employeeId,
        work_date: r.date,
        login: r.login,
        logout: r.logout || null,
      }));
      const res = await hrRequest<{
        ok: true;
        results: BulkResult[];
        written: number;
        failed: number;
      }>({ action: "admin_bulk_set_attendance", entries });
      setResults(res.results ?? []);
      const written = res.written ?? 0;
      const failed = res.failed ?? 0;
      const skipped = dates.length - filled.length;
      if (failed > 0) {
        toast.warning(`${written} day(s) saved, ${failed} failed, ${skipped} blank skipped`);
      } else {
        toast.success(`${written} day(s) saved${skipped ? `, ${skipped} blank skipped` : ""}`);
      }
      const emp = employees.find((e) => e.id === employeeId);
      const label = emp ? employeeName(emp) : employeeId;
      logAudit({
        actorId: user?.id,
        action: "edit",
        entity: "attendance",
        entityId: employeeId,
        entityLabel: `${label} · ${from}…${to}`,
        detail: `Bulk back-fill for ${label} (${from} to ${to}): ${written} saved, ${failed} failed`,
        meta: { from, to, written, failed },
      });
      onSaved();
    } catch (e: unknown) {
      toast.error(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const failures = (results ?? []).filter((r) => !r.ok);

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk back-fill attendance</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Pick one teammate and a date range, then enter their login/logout for each day. Only
            days with a login are saved; blanks are skipped. The server scores each day exactly like
            a live punch.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Employee</label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick an employee" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {employeeName(e)} · {e.employee_code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="bulk-from">
                From
              </label>
              <Input
                id="bulk-from"
                type="date"
                max={today}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="bulk-to">
                To
              </label>
              <Input
                id="bulk-to"
                type="date"
                max={today}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>

          {from > to && (
            <div className="text-xs text-rose-600">
              The &ldquo;from&rdquo; date must not be after the &ldquo;to&rdquo; date.
            </div>
          )}

          {employeeId && dates.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Login</TableHead>
                    <TableHead>Logout</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const bad = !!r.login && !!r.logout && r.logout <= r.login;
                    return (
                      <TableRow key={r.date}>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {new Date(`${r.date}T00:00:00Z`).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            weekday: "short",
                            timeZone: "UTC",
                          })}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="time"
                            className="h-8 w-32"
                            value={r.login}
                            onChange={(e) => setTime(r.date, "login", e.target.value)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="time"
                            className={cn("h-8 w-32", bad && "border-rose-400")}
                            value={r.logout}
                            onChange={(e) => setTime(r.date, "logout", e.target.value)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {!employeeId && (
            <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              Pick an employee to start filling days.
            </div>
          )}

          {anyBadOrder && (
            <div className="flex items-center gap-1.5 text-xs text-rose-600">
              <AlertTriangle className="h-3.5 w-3.5" /> Some rows have logout before login — fix
              them before saving.
            </div>
          )}

          {results && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="font-medium">
                {results.filter((r) => r.ok).length} saved · {failures.length} failed
              </div>
              {failures.length > 0 && (
                <ul className="space-y-0.5 text-xs text-rose-600">
                  {failures.map((f) => (
                    <li key={f.index}>
                      {f.work_date}: {f.message ?? "failed"}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {employeeId
                ? `${filled.length} day(s) to save of ${dates.length} in range`
                : "No employee selected"}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button disabled={!canSubmit} onClick={submit}>
                {saving ? "Saving…" : `Save ${filled.length || ""} day(s)`}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function useNames() {
  const { data: employees = [] } = useEmployees();
  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles-names"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email");
      return (data ?? []) as { id: string; full_name: string | null; email: string | null }[];
    },
  });
  return useMemo(() => {
    const emp = new Map(employees.map((e) => [e.id, employeeName(e)]));
    const prof = new Map(profiles.map((p) => [p.id, p.full_name || p.email || "Unknown"]));
    return { emp, prof };
  }, [employees, profiles]);
}

function SecurityView() {
  const [outcome, setOutcome] = useState<"rejected" | "all">("rejected");
  const names = useNames();
  const { data: events = [] } = useQuery({
    queryKey: ["hrms-attendance-events", outcome],
    queryFn: async (): Promise<AttendanceEvent[]> => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      let q = hrmsDb()
        .from("attendance_events")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(300);
      if (outcome === "rejected") q = q.eq("outcome", "rejected");
      const { data } = await q;
      return data ?? [];
    },
  });

  const byReason = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events)
      if (e.outcome === "rejected" && e.reason) m.set(e.reason, (m.get(e.reason) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [events]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {byReason.map(([reason, n]) => (
            <span
              key={reason}
              className="rounded-full bg-rose-50 px-2.5 py-1 text-xs text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900"
            >
              {reason.replace(/_/g, " ")} · {n}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <DownloadButton
            disabled={events.length === 0}
            onClick={() =>
              downloadCsv(`attendance-security-${istParts(new Date()).date}.csv`, [
                [
                  "When",
                  "Who",
                  "Linked",
                  "Action",
                  "Result",
                  "Reason",
                  "Browser error",
                  "Distance (m)",
                  "Accuracy (m)",
                  "Latitude",
                  "Longitude",
                  "Device",
                  "IP",
                  "Browser",
                ],
                ...events.map((e) => [
                  dateTimeIST(e.created_at),
                  e.employee_id
                    ? (names.emp.get(e.employee_id) ?? "Employee")
                    : e.profile_id
                      ? (names.prof.get(e.profile_id) ?? "")
                      : "",
                  e.employee_id ? "yes" : "no",
                  e.event_type,
                  e.outcome,
                  e.reason ?? "",
                  e.client_error ?? "",
                  e.distance_m ?? "",
                  e.accuracy_m != null ? Math.round(Number(e.accuracy_m)) : "",
                  e.latitude ?? "",
                  e.longitude ?? "",
                  e.device_key ?? "",
                  e.ip ?? "",
                  e.user_agent ?? "",
                ]),
              ])
            }
          />
          <Select value={outcome} onValueChange={(v) => setOutcome(v as "rejected" | "all")}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rejected">Rejected only</SelectItem>
              <SelectItem value="all">All attempts</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Result</TableHead>
                <TableHead className="text-right">Distance</TableHead>
                <TableHead className="text-right">Accuracy</TableHead>
                <TableHead>Device / IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    Nothing in the last 30 days.
                  </TableCell>
                </TableRow>
              )}
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {dateTimeIST(e.created_at)}
                  </TableCell>
                  <TableCell>
                    {e.employee_id ? (
                      (names.emp.get(e.employee_id) ?? "Employee")
                    ) : (
                      <span>
                        {e.profile_id ? names.prof.get(e.profile_id) : "Unknown"}
                        <span className="ml-1 text-xs text-amber-600">(not linked)</span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="capitalize">{e.event_type}</TableCell>
                  <TableCell>
                    {e.outcome === "accepted" ? (
                      <span className="text-xs font-medium text-emerald-600">Accepted</span>
                    ) : (
                      <span
                        className="text-xs font-medium text-rose-600"
                        title={REJECTION_MESSAGES[e.reason as RejectionReason] ?? ""}
                      >
                        {(e.reason ?? "rejected").replace(/_/g, " ")}
                        {e.client_error && (
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            ({e.client_error.replace(/_/g, " ")})
                          </span>
                        )}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {e.distance_m != null ? `${e.distance_m} m` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {e.accuracy_m != null ? `±${Math.round(Number(e.accuracy_m))} m` : "—"}
                  </TableCell>
                  <TableCell className="max-w-[14rem] truncate text-xs text-muted-foreground">
                    {[e.device_key?.slice(0, 8), e.ip].filter(Boolean).join(" · ") || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

const DEVICE_STATUS_CLASS: Record<AttendanceDevice["status"], string> = {
  pending:
    "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  approved:
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  revoked:
    "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900",
};

function DevicesView() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const names = useNames();
  const { data: settings } = useQuery({ queryKey: ["hrms-settings"], queryFn: fetchHrSettings });
  const { data: devices = [] } = useQuery({
    queryKey: ["hrms-devices"],
    queryFn: async (): Promise<AttendanceDevice[]> => {
      const { data } = await hrmsDb()
        .from("attendance_devices")
        .select("*")
        .order("last_seen_at", { ascending: false });
      return data ?? [];
    },
  });
  const order = { pending: 0, approved: 1, revoked: 2 } as const;
  const sorted = [...devices].sort((a, b) => order[a.status] - order[b.status]);

  const decide = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: AttendanceDevice["status"] }) => {
      const { error } = await hrmsDb()
        .from("attendance_devices")
        .update({ status, decided_by: user?.id ?? null, decided_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_, v) => {
      toast.success(v.status === "approved" ? "Device approved" : "Device blocked");
      qc.invalidateQueries({ queryKey: ["hrms-devices"] });
      qc.invalidateQueries({ queryKey: ["hrms-pending-devices"] });
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          A device is registered the first time someone punches from it.{" "}
          {settings?.require_device_approval
            ? "Device approval is ON: new devices cannot punch until approved here."
            : "Device approval is OFF, so new devices are approved automatically. Blocking a device still stops it."}
        </div>
        <DownloadButton
          disabled={sorted.length === 0}
          onClick={() =>
            downloadCsv(`attendance-devices-${istParts(new Date()).date}.csv`, [
              ["Employee", "Device", "Device id", "Status", "First seen", "Last seen", "Browser"],
              ...sorted.map((d) => [
                names.emp.get(d.employee_id) ?? "Employee",
                d.label ?? "",
                d.device_key,
                d.status === "revoked" ? "blocked" : d.status,
                dateTimeIST(d.first_seen_at),
                dateTimeIST(d.last_seen_at),
                d.user_agent ?? "",
              ]),
            ])
          }
        />
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Device</TableHead>
                <TableHead>First seen</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    No devices yet — they appear after the first punch.
                  </TableCell>
                </TableRow>
              )}
              {sorted.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">
                    {names.emp.get(d.employee_id) ?? "Employee"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Smartphone className="h-3.5 w-3.5 text-muted-foreground" />
                      {d.label ?? "Unknown device"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {d.device_key.slice(0, 8)}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs tabular-nums">
                    {dateTimeIST(d.first_seen_at)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs tabular-nums">
                    {dateTimeIST(d.last_seen_at)}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1",
                        DEVICE_STATUS_CLASS[d.status],
                      )}
                    >
                      {d.status === "revoked" ? "Blocked" : d.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1.5">
                      {d.status !== "approved" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={decide.isPending}
                          onClick={() => decide.mutate({ id: d.id, status: "approved" })}
                        >
                          <Check className="mr-1 h-3.5 w-3.5" /> Approve
                        </Button>
                      )}
                      {d.status !== "revoked" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={decide.isPending}
                          onClick={() => decide.mutate({ id: d.id, status: "revoked" })}
                        >
                          <Ban className="mr-1 h-3.5 w-3.5" /> Block
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
