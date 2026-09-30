import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
} from "@/lib/hrms";
import {
  istParts,
  minutesBetween,
  summarizeMonth,
  REJECTION_MESSAGES,
  type RejectionReason,
} from "@/lib/attendance-rules";
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
import { GlassTabs } from "@/components/hrms/glass-tabs";

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

  const weekday = istParts(new Date()).weekday;
  const offDay = offDayHolidays(holidays)[0]?.name ?? null;
  const isWeekOff = (settings?.week_offs ?? [0, 6]).includes(weekday);
  const nonWorking = !!offDay || isWeekOff;

  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const byEmployee = new Map(rows.map((r) => [r.employee_id, r]));
  const active = employees.filter(
    (e) => !INACTIVE.has(e.employment_status) && (!e.joining_date || e.joining_date <= today),
  );
  const nowIso = new Date().toISOString();
  const inOffice = rows.filter((r) => r.open_since).length;
  const late = rows.filter((r) => r.is_late).length;
  const notIn = nonWorking ? 0 : active.filter((e) => !byEmployee.has(e.id)).length;

  // Logged-in first, then logged-out, then not in; alphabetical inside each.
  const rank = (e: Employee) => {
    const r = byEmployee.get(e.id);
    return r ? (r.open_since ? 0 : 1) : 2;
  };
  const sorted = [...active].sort(
    (a, b) => rank(a) - rank(b) || employeeName(a).localeCompare(employeeName(b)),
  );

  return (
    <div className="space-y-4">
      {nonWorking && (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
          Today is a {offDay ? `holiday (${offDay})` : "weekly off"} — nobody is expected in.
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi
          icon={UserCheck}
          label="Present today"
          value={rows.length}
          tone="bg-emerald-500/10 text-emerald-600"
        />
        <Kpi
          icon={LogIn}
          label="In office now"
          value={inOffice}
          tone="bg-primary/10 text-primary"
        />
        <Kpi icon={Clock} label="Late" value={late} tone="bg-amber-500/10 text-amber-600" />
        <Kpi icon={UserX} label="Not logged in" value={notIn} tone="bg-rose-500/10 text-rose-600" />
        <Kpi
          icon={ShieldAlert}
          label="Rejected attempts"
          value={rejected}
          tone="bg-rose-500/10 text-rose-600"
        />
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Login</TableHead>
                <TableHead>Logout</TableHead>
                <TableHead>Worked</TableHead>
                <TableHead>Distance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    No active employees yet. Add them under Employees.
                  </TableCell>
                </TableRow>
              )}
              {sorted.map((e) => {
                const r = byEmployee.get(e.id);
                const worked =
                  (r?.worked_minutes ?? 0) +
                  (r?.open_since ? minutesBetween(r.open_since, nowIso) : 0);
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
                      <TodayStatus row={r} nonWorking={nonWorking} />
                    </TableCell>
                    <TableCell className="tabular-nums">{timeIST(r?.first_login_at)}</TableCell>
                    <TableCell className="tabular-nums">
                      {r?.open_since ? "—" : timeIST(r?.last_logout_at)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {r ? formatMinutes(worked) : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {r?.login_distance_m != null ? `${r.login_distance_m} m` : "—"}
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

function TodayStatus({ row, nonWorking }: { row?: AttendanceRow; nonWorking: boolean }) {
  const pill = (label: string, className: string) => (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium ring-1", className)}>
      {label}
    </span>
  );
  if (!row)
    return nonWorking
      ? pill("Off", "bg-muted text-muted-foreground ring-border")
      : pill(
          "Not logged in",
          "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900",
        );
  return (
    <div className="flex flex-wrap items-center gap-1">
      {row.open_since
        ? pill("In office", "bg-primary/10 text-primary ring-primary/20")
        : pill(
            row.status === "half_day" ? "Half day" : "Logged out",
            "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
          )}
      {row.is_late &&
        pill(
          `Late ${formatMinutes(row.late_minutes)}`,
          "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
        )}
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
  const { from, to } = monthRange(ym.year, ym.month);
  const { data: employees = [] } = useEmployees();
  const { data: settings } = useQuery({ queryKey: ["hrms-settings"], queryFn: fetchHrSettings });
  const { data: holidays = [] } = useQuery({
    queryKey: ["hrms-holidays-range", from, to],
    queryFn: () => fetchHolidays(from, to),
  });
  const { data: rows = [] } = useQuery({
    queryKey: ["hrms-attendance-month", from],
    queryFn: () => fetchAttendance(from, to),
  });

  const summaries = useMemo(() => {
    const byEmployee = new Map<string, AttendanceRow[]>();
    for (const r of rows) {
      const list = byEmployee.get(r.employee_id) ?? [];
      list.push(r);
      byEmployee.set(r.employee_id, list);
    }
    const off = offDayHolidays(holidays);
    return employees
      .filter(
        (e) =>
          // Hide people who had left before this month and have no rows in it.
          byEmployee.has(e.id) || !INACTIVE.has(e.employment_status) || (e.exit_date ?? "") >= from,
      )
      .map((e) => ({
        employee: e,
        ...summarizeMonth({
          year: ym.year,
          month: ym.month,
          today,
          records: byEmployee.get(e.id) ?? [],
          holidays: off,
          weekOffs: settings?.week_offs ?? [0, 6],
          requiredMinutes: settings?.required_minutes ?? 510,
          joiningDate: e.joining_date,
          exitDate: e.exit_date,
        }),
      }));
  }, [rows, holidays, employees, settings, ym, today, from]);

  const open = summaries.find((s) => s.employee.id === openId) ?? null;

  return (
    <Card>
      <CardContent className="space-y-3 p-0">
        <div className="flex items-center justify-between px-4 pt-4">
          <div className="text-sm text-muted-foreground">Click a row for the day-by-day view.</div>
          <MonthNav
            year={ym.year}
            month={ym.month}
            onChange={(year, month) => setYm({ year, month })}
            maxYearMonth={today.slice(0, 7)}
          />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead className="text-right">Days</TableHead>
              <TableHead className="text-right">Present</TableHead>
              <TableHead className="text-right">Half</TableHead>
              <TableHead className="text-right">Absent</TableHead>
              <TableHead className="text-right">Late</TableHead>
              <TableHead className="text-right">⚠</TableHead>
              <TableHead className="text-right">Worked</TableHead>
              <TableHead className="text-right">Overtime</TableHead>
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
                <TableCell
                  className={cn("text-right tabular-nums", stats.actionNeeded && "text-amber-600")}
                >
                  {stats.actionNeeded}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMinutes(stats.workedMinutes)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMinutes(stats.overtimeMinutes)}
                </TableCell>
              </TableRow>
            ))}
            {summaries.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                  No employees for this month.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
      <Dialog open={!!open} onOpenChange={(v) => !v && setOpenId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{open ? employeeName(open.employee) : ""}</DialogTitle>
          </DialogHeader>
          {open && (
            <div className="space-y-4">
              <MonthStatsGrid stats={open.stats} />
              <MonthCalendar days={open.days} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
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
      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        A device is registered the first time someone punches from it.{" "}
        {settings?.require_device_approval
          ? "Device approval is ON: new devices cannot punch until approved here."
          : "Device approval is OFF, so new devices are approved automatically. Blocking a device still stops it."}
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
