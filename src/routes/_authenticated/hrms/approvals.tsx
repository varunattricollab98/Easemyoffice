import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, ClipboardCheck, Home, MapPin, MoonStar, X, Inbox } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, getErrorMessage } from "@/lib/utils";
import {
  hrmsDb,
  employeeName,
  formatMinutes,
  ATTENDANCE_REQUEST_TYPES,
  type AttendanceRequest,
  type AttendanceRow,
  type Employee,
  type LeaveRequest,
} from "@/lib/hrms";
import { istParts } from "@/lib/attendance-rules";
import { hrRequest } from "@/lib/attendance-client";
import {
  buildEmployeeMonth,
  dateTimeIST,
  fetchAttendanceRequests,
  fetchHolidays,
  fetchHrSettings,
  fetchLeaves,
  leavePolicyOf,
  leaveRange,
  timeIST,
} from "@/lib/attendance-queries";

export const Route = createFileRoute("/_authenticated/hrms/approvals")({
  head: () => ({ meta: [{ title: "Approvals — EaseMyOffice CRM" }] }),
  // Admin guard lives on the /hrms layout route.
  component: ApprovalsPage,
});

const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    weekday: "short",
    timeZone: "UTC",
  });

const requestTypeLabel = (type: AttendanceRequest["type"]) =>
  ATTENDANCE_REQUEST_TYPES.find((t) => t.id === type)?.label ?? type;

/** "3 Oct" or "3 Oct – 5 Oct" for an attendance request's day/range. */
const attendanceRequestRange = (r: AttendanceRequest) =>
  r.to_date && r.to_date !== r.work_date
    ? `${fmtDate(r.work_date)} – ${fmtDate(r.to_date)}`
    : fmtDate(r.work_date);

function useEmployeeMap() {
  const { data: employees = [] } = useQuery({
    queryKey: ["hrms-employees-lite"],
    queryFn: async (): Promise<Employee[]> => {
      const { data } = await hrmsDb().from("employees").select("*").order("first_name");
      return data ?? [];
    },
  });
  return useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
}

function ApprovalsPage() {
  const qc = useQueryClient();
  const employees = useEmployeeMap();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const today = istParts(new Date()).date;

  const { data: remote = [] } = useQuery({
    queryKey: ["hrms-remote-pending"],
    queryFn: async (): Promise<AttendanceRow[]> => {
      const { data } = await hrmsDb()
        .from("attendance")
        .select("*")
        .eq("remote_status", "pending")
        .order("work_date", { ascending: false });
      return data ?? [];
    },
  });
  const { data: leaves = [] } = useQuery({
    queryKey: ["hrms-leave-pending"],
    queryFn: async (): Promise<LeaveRequest[]> => {
      const { data } = await hrmsDb()
        .from("leave_requests")
        .select("*")
        .eq("status", "pending")
        .order("from_date");
      return data ?? [];
    },
  });
  const { data: attendanceRequests = [] } = useQuery({
    queryKey: ["hrms-attendance-requests-pending"],
    queryFn: () => fetchAttendanceRequests({ status: "pending" }),
  });
  const { data: recent = [] } = useQuery({
    queryKey: ["hrms-decided-recent"],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const [l, r, a] = await Promise.all([
        hrmsDb()
          .from("leave_requests")
          .select("*")
          .in("status", ["approved", "rejected"])
          .gte("decided_at", since)
          .order("decided_at", { ascending: false })
          .limit(30),
        hrmsDb()
          .from("attendance")
          .select("*")
          .in("remote_status", ["approved", "rejected"])
          .gte("remote_decided_at", since)
          .order("remote_decided_at", { ascending: false })
          .limit(30),
        hrmsDb()
          .from("attendance_requests")
          .select("*")
          .in("status", ["approved", "rejected"])
          .gte("decided_at", since)
          .order("decided_at", { ascending: false })
          .limit(30),
      ]);
      const items = [
        ...((l.data ?? []) as LeaveRequest[]).map((x) => ({
          kind: "leave" as const,
          id: x.id,
          employee_id: x.employee_id,
          when: x.decided_at ?? x.created_at,
          label: `Leave · ${leaveRange(x)}`,
          approved: x.status === "approved",
          note: x.admin_note,
        })),
        ...((r.data ?? []) as AttendanceRow[]).map((x) => ({
          kind: "remote" as const,
          id: x.id,
          employee_id: x.employee_id,
          when: x.remote_decided_at ?? x.first_login_at,
          label: `WFH · ${fmtDate(x.work_date)}`,
          approved: x.remote_status === "approved",
          note: x.remote_note,
        })),
        ...((a.data ?? []) as AttendanceRequest[]).map((x) => ({
          kind: "attendance_request" as const,
          id: x.id,
          employee_id: x.employee_id,
          when: x.decided_at ?? x.created_at,
          label: `${requestTypeLabel(x.type)} · ${attendanceRequestRange(x)}`,
          approved: x.status === "approved",
          note: x.admin_note,
        })),
      ];
      return items.sort((a, b) => b.when.localeCompare(a.when)).slice(0, 30);
    },
  });

  // Balance context for pending leave: what the employee has left in the
  // month the leave starts.
  const { data: settings } = useQuery({ queryKey: ["hrms-settings"], queryFn: fetchHrSettings });
  const policyStart = leavePolicyOf(settings).policyStart;
  const { data: allLeaves = [] } = useQuery({
    queryKey: ["hrms-leaves-since", policyStart, "2100-01-01"],
    enabled: leaves.length > 0,
    queryFn: () => fetchLeaves({ since: policyStart, until: "2100-01-01" }),
  });
  const { data: holidays = [] } = useQuery({
    queryKey: ["hrms-holidays-range", policyStart, "2100-01-01"],
    enabled: leaves.length > 0,
    queryFn: () => fetchHolidays(policyStart, "2100-01-01"),
  });
  const balanceLeft = (l: LeaveRequest) => {
    const e = employees.get(l.employee_id);
    if (!e) return null;
    const [y, m] = l.from_date.split("-").map(Number);
    const view = buildEmployeeMonth({
      employee: e,
      year: y,
      month: m,
      today,
      records: [],
      holidays,
      settings,
      leaves: allLeaves.filter((x) => x.employee_id === e.id && x.status === "approved"),
    });
    return Math.max(0, view.ledger.available - view.ledger.paid);
  };

  const refresh = () => {
    for (const k of [
      "hrms-remote-pending",
      "hrms-leave-pending",
      "hrms-attendance-requests-pending",
      "hrms-decided-recent",
      "hrms-approval-counts",
      "hrms-leaves-since",
    ])
      qc.invalidateQueries({ queryKey: [k] });
  };

  const decide = useMutation({
    mutationFn: (v: {
      kind: "leave" | "remote" | "attendance_request";
      id: string;
      approve: boolean;
    }) =>
      hrRequest(
        v.kind === "leave"
          ? { action: "decide_leave", id: v.id, approve: v.approve, note: notes[v.id] ?? "" }
          : v.kind === "attendance_request"
            ? {
                action: "decide_attendance_request",
                id: v.id,
                approve: v.approve,
                note: notes[v.id] ?? "",
              }
            : {
                action: "decide_remote",
                attendance_id: v.id,
                approve: v.approve,
                note: notes[v.id] ?? "",
              },
      ),
    onSuccess: (_, v) => {
      toast.success(v.approve ? "Approved — employee notified" : "Rejected — employee notified");
      refresh();
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  const nameOf = (id: string) => {
    const e = employees.get(id);
    return e ? employeeName(e) : "Employee";
  };

  const actions = (kind: "leave" | "remote" | "attendance_request", id: string) => (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        className="h-8 w-56 text-xs"
        placeholder="Note to employee (optional)"
        value={notes[id] ?? ""}
        onChange={(e) => setNotes({ ...notes, [id]: e.target.value })}
      />
      <Button
        size="sm"
        className="h-8"
        disabled={decide.isPending}
        onClick={() => decide.mutate({ kind, id, approve: true })}
      >
        <Check className="mr-1 h-3.5 w-3.5" /> Approve
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-8 text-destructive hover:text-destructive"
        disabled={decide.isPending}
        onClick={() => decide.mutate({ kind, id, approve: false })}
      >
        <X className="mr-1 h-3.5 w-3.5" /> Reject
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Inbox className="h-5 w-5 text-primary" /> Approvals
      </h2>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Home className="h-4 w-4 text-indigo-500" /> Work from home ({remote.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {remote.length === 0 && (
            <div className="py-4 text-center text-sm text-muted-foreground">Nothing pending.</div>
          )}
          {remote.map((r) => {
            const lat = r.login_latitude != null ? Number(r.login_latitude) : null;
            const lng = r.login_longitude != null ? Number(r.login_longitude) : null;
            return (
              <div key={r.id} className="space-y-2 rounded-xl border p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="font-semibold">{nameOf(r.employee_id)}</span>
                  <span className="tabular-nums text-muted-foreground">{fmtDate(r.work_date)}</span>
                  <span className="text-xs text-muted-foreground">
                    Login {timeIST(r.first_login_at)}
                    {r.open_since ? " · still logged in" : ` · logout ${timeIST(r.last_logout_at)}`}
                    {" · "}
                    {formatMinutes(r.window_minutes)} completed · idle{" "}
                    {formatMinutes(r.idle_minutes)}
                  </span>
                  {lat != null && lng != null && (
                    <a
                      href={`https://maps.google.com/?q=${lat},${lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <MapPin className="h-3 w-3" />
                      {r.login_distance_m != null
                        ? `${(r.login_distance_m / 1000).toFixed(1)} km from office`
                        : "Map"}
                    </a>
                  )}
                </div>
                {r.remote_reason && (
                  <div className="text-xs text-muted-foreground">Reason: {r.remote_reason}</div>
                )}
                {actions("remote", r.id)}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <MoonStar className="h-4 w-4 text-teal-500" /> Leave ({leaves.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {leaves.length === 0 && (
            <div className="py-4 text-center text-sm text-muted-foreground">Nothing pending.</div>
          )}
          {leaves.map((l) => {
            const left = balanceLeft(l);
            const days = Number(l.days);
            return (
              <div key={l.id} className="space-y-2 rounded-xl border p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="font-semibold">{nameOf(l.employee_id)}</span>
                  <span className="tabular-nums">{leaveRange(l)}</span>
                  <span className="text-xs text-muted-foreground">
                    {days} working day{days === 1 ? "" : "s"} · applied {dateTimeIST(l.created_at)}
                  </span>
                  {left != null && (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-medium",
                        left >= days
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
                      )}
                    >
                      {left >= days
                        ? `Paid · ${left} left that month`
                        : `${Math.max(0, days - left)} day(s) would be unpaid · ${left} left`}
                    </span>
                  )}
                </div>
                {l.reason && (
                  <div className="text-xs text-muted-foreground">Reason: {l.reason}</div>
                )}
                {actions("leave", l.id)}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="h-4 w-4 text-indigo-500" /> Attendance requests (
            {attendanceRequests.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {attendanceRequests.length === 0 && (
            <div className="py-4 text-center text-sm text-muted-foreground">Nothing pending.</div>
          )}
          {attendanceRequests.map((r) => (
            <div key={r.id} className="space-y-2 rounded-xl border p-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-semibold">{nameOf(r.employee_id)}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {requestTypeLabel(r.type)}
                </span>
                <span className="tabular-nums">{attendanceRequestRange(r)}</span>
                {r.type === "missed_login_regularization" &&
                  (r.requested_login_at || r.requested_logout_at) && (
                    <span className="text-xs text-muted-foreground">
                      Login {timeIST(r.requested_login_at)} · Logout{" "}
                      {timeIST(r.requested_logout_at)}
                    </span>
                  )}
                <span className="text-xs text-muted-foreground">
                  applied {dateTimeIST(r.created_at)}
                </span>
              </div>
              {r.reason && <div className="text-xs text-muted-foreground">Reason: {r.reason}</div>}
              {actions("attendance_request", r.id)}
            </div>
          ))}
        </CardContent>
      </Card>

      {recent.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Decided in the last 30 days</CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {recent.map((x) => (
              <div
                key={`${x.kind}-${x.id}`}
                className="flex flex-wrap items-center gap-3 px-5 py-2 text-sm"
              >
                <span className="w-32 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {dateTimeIST(x.when)}
                </span>
                <span className="w-40 shrink-0 font-medium">{nameOf(x.employee_id)}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {x.label}
                  {x.note && ` · ${x.note}`}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium",
                    x.approved
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
                  )}
                >
                  {x.approved ? "Approved" : "Rejected"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
