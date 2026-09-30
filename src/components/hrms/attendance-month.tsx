// Month calendar, totals, daily log and leave balance for one employee. Shared
// by the employee's own attendance page and the admin's per-employee view, so
// both sides see exactly the same picture. No salary figures, by design.

import { ChevronLeft, ChevronRight, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatMinutes, type AttendanceRow, type IdlePeriod } from "@/lib/hrms";
import { dateTimeIST, timeIST } from "@/lib/attendance-queries";
import type { DayCell, DayKind, LedgerMonth, MonthStats } from "@/lib/attendance-rules";

const TONE = {
  green:
    "bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  sky: "bg-sky-50 text-sky-700 ring-sky-200/70 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900",
  orange:
    "bg-orange-50 text-orange-700 ring-orange-200/70 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-900",
  rose: "bg-rose-50 text-rose-700 ring-rose-200/70 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900",
  amber:
    "bg-amber-50 text-amber-700 ring-amber-200/70 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  violet:
    "bg-violet-50 text-violet-700 ring-violet-200/70 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900",
  teal: "bg-teal-50 text-teal-700 ring-teal-200/70 dark:bg-teal-950/40 dark:text-teal-300 dark:ring-teal-900",
  indigo:
    "bg-indigo-50 text-indigo-700 ring-indigo-200/70 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900",
  primary: "bg-primary/10 text-primary ring-primary/25 dark:bg-primary/15",
  muted: "bg-muted/50 text-muted-foreground ring-border/60",
};

const DAY_KIND_META: Record<DayKind, { mark: string; label: string; className: string }> = {
  present: { mark: "✓", label: "Present", className: TONE.green },
  short: { mark: "S", label: "Left early", className: TONE.orange },
  half_day: { mark: "½", label: "Half day", className: TONE.sky },
  absent: { mark: "A", label: "Absent", className: TONE.rose },
  in_progress: { mark: "●", label: "Logged in", className: TONE.primary },
  action_needed: { mark: "⚠", label: "Logout missing", className: TONE.amber },
  remote_pending: { mark: "W?", label: "WFH pending", className: TONE.indigo },
  remote_rejected: { mark: "W✕", label: "WFH rejected", className: TONE.rose },
  paid_leave: { mark: "PL", label: "Paid leave", className: TONE.teal },
  unpaid_leave: { mark: "UL", label: "Unpaid leave", className: TONE.rose },
  leave_pending: { mark: "L?", label: "Leave pending", className: TONE.teal },
  holiday: { mark: "H", label: "Holiday", className: TONE.violet },
  week_off: { mark: "–", label: "Week off", className: TONE.muted },
  today: { mark: "•", label: "Today", className: "bg-background text-foreground ring-primary/40" },
  upcoming: {
    mark: "",
    label: "Upcoming",
    className: "bg-background text-muted-foreground/70 ring-border/50",
  },
  not_employed: {
    mark: "",
    label: "Not employed",
    className: "bg-transparent text-muted-foreground/40 ring-transparent",
  },
};

const LEGEND: DayKind[] = [
  "present",
  "short",
  "half_day",
  "absent",
  "paid_leave",
  "unpaid_leave",
  "leave_pending",
  "remote_pending",
  "action_needed",
  "holiday",
  "week_off",
];

const WEEK_HEADER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const GLASS_CARD =
  "rounded-xl border border-black/[0.06] bg-white/60 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_3px_rgba(0,0,0,0.04)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]";

export function MonthNav({
  year,
  month,
  onChange,
  maxYearMonth,
}: {
  year: number;
  month: number;
  onChange: (year: number, month: number) => void;
  /** "YYYY-MM" — the current month; navigating past it is pointless. */
  maxYearMonth: string;
}) {
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    onChange(d.getUTCFullYear(), d.getUTCMonth() + 1);
  };
  const atMax = `${year}-${String(month).padStart(2, "0")}` >= maxYearMonth;
  return (
    <div className="inline-flex items-center gap-1">
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        onClick={() => shift(-1)}
        aria-label="Previous month"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="min-w-[8.5rem] text-center text-sm font-semibold tabular-nums">{label}</div>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        disabled={atMax}
        onClick={() => shift(1)}
        aria-label="Next month"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function MonthStatsGrid({ stats }: { stats: MonthStats }) {
  const pct = stats.requiredMinutes
    ? Math.min(100, Math.round((stats.workedMinutes / stats.requiredMinutes) * 100))
    : 0;
  const items: { label: string; value: string; hint?: string; tone?: string }[] = [
    {
      label: "Working days",
      value: `${stats.elapsedWorkingDays}/${stats.workingDays}`,
      hint: "so far / in month",
    },
    { label: "Present", value: String(stats.present), tone: "text-emerald-600" },
    {
      label: "Left early",
      value: String(stats.short),
      hint: "below required hours",
      tone: stats.short ? "text-orange-600" : undefined,
    },
    { label: "Half days", value: String(stats.halfDays), tone: "text-sky-600" },
    {
      label: "Absent",
      value: String(stats.absent),
      tone: stats.absent ? "text-rose-600" : undefined,
    },
    { label: "Late", value: String(stats.late), tone: stats.late ? "text-amber-600" : undefined },
    {
      label: "Work from home",
      value: String(stats.remoteDays),
      hint: stats.remotePending ? `${stats.remotePending} awaiting approval` : "approved days",
    },
    {
      label: "Action needed",
      value: String(stats.actionNeeded),
      hint: "missing logout",
      tone: stats.actionNeeded ? "text-amber-600" : undefined,
    },
    {
      label: "Hours completed",
      value: formatMinutes(stats.workedMinutes),
      hint: `of ${formatMinutes(stats.requiredMinutes)} required · ${pct}%`,
    },
    { label: "Overtime", value: formatMinutes(stats.overtimeMinutes) },
    {
      label: "CRM idle",
      value: formatMinutes(stats.idleMinutes),
      hint: "no activity while logged in",
      tone: stats.idleMinutes ? "text-amber-600" : undefined,
    },
    {
      label: "Leave taken",
      value: fmtDays(stats.paidLeave + stats.unpaidLeave),
      hint: `${fmtDays(stats.paidLeave)} paid · ${fmtDays(stats.unpaidLeave)} unpaid`,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className={GLASS_CARD}>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {i.label}
          </div>
          <div className={cn("mt-1 text-xl font-semibold tabular-nums", i.tone)}>{i.value}</div>
          {i.hint && <div className="text-[11px] text-muted-foreground">{i.hint}</div>}
        </div>
      ))}
    </div>
  );
}

/** Balance for the month: quota + carried in, paid/unpaid taken, pending, left. */
export function LeaveBalance({ ledger, pending }: { ledger: LedgerMonth; pending: number }) {
  const left = Math.max(0, ledger.available - ledger.paid);
  const items = [
    {
      label: "Available this month",
      value: fmtDays(ledger.available),
      hint: `${fmtDays(ledger.quota)} monthly + ${fmtDays(ledger.carriedIn)} carried`,
    },
    { label: "Taken (paid)", value: fmtDays(ledger.paid) },
    {
      label: "Taken (unpaid)",
      value: fmtDays(ledger.unpaid),
      tone: ledger.unpaid ? "text-rose-600" : undefined,
    },
    {
      label: "Pending approval",
      value: fmtDays(pending),
      tone: pending ? "text-teal-600" : undefined,
    },
    {
      label: "Balance left",
      value: fmtDays(left),
      hint: `up to ${fmtDays(ledger.carryOut)} carries to next month`,
      tone: "text-emerald-600",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {items.map((i) => (
        <div key={i.label} className={GLASS_CARD}>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {i.label}
          </div>
          <div className={cn("mt-1 text-xl font-semibold tabular-nums", i.tone)}>{i.value}</div>
          {i.hint && <div className="text-[11px] text-muted-foreground">{i.hint}</div>}
        </div>
      ))}
    </div>
  );
}

export function MonthCalendar({ days }: { days: DayCell[] }) {
  // Monday-first grid: JS weekday 1 (Mon) -> column 0, Sunday -> column 6.
  const lead = days.length ? (days[0].weekday + 6) % 7 : 0;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-7 gap-1.5 text-center">
        {WEEK_HEADER.map((d) => (
          <div key={d} className="pb-1 text-[11px] font-medium text-muted-foreground">
            {d}
          </div>
        ))}
        {Array.from({ length: lead }).map((_, i) => (
          <div key={`lead-${i}`} />
        ))}
        {days.map((d) => {
          const meta = DAY_KIND_META[d.kind];
          const title = [
            d.date,
            d.holidayName ?? meta.label,
            d.remote ? "work from home" : null,
            d.late ? "late" : null,
            d.creditedMinutes ? `${formatMinutes(d.creditedMinutes)} completed` : null,
            d.idleMinutes ? `${formatMinutes(d.idleMinutes)} idle` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <div
              key={d.date}
              title={title}
              className={cn(
                "relative flex aspect-square flex-col items-center justify-center rounded-lg text-xs ring-1 transition-shadow hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.18)]",
                meta.className,
              )}
            >
              <span className="absolute left-1.5 top-1 text-[10px] tabular-nums opacity-70">
                {d.day}
              </span>
              <span className="text-sm font-semibold leading-none">{meta.mark}</span>
              {d.creditedMinutes > 0 && (
                <span className="mt-0.5 hidden text-[9px] tabular-nums opacity-80 sm:block">
                  {formatMinutes(d.creditedMinutes)}
                </span>
              )}
              {d.remote && (
                <Home className="absolute right-1 top-1 h-2.5 w-2.5 opacity-70" aria-label="WFH" />
              )}
              {d.late && (
                <span className="absolute bottom-1 right-1.5 rounded bg-amber-500/90 px-1 text-[9px] font-bold leading-tight text-white">
                  L
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {LEGEND.map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span
              className={cn(
                "inline-flex h-4 min-w-4 items-center justify-center rounded px-0.5 text-[9px] font-semibold ring-1",
                DAY_KIND_META[k].className,
              )}
            >
              {DAY_KIND_META[k].mark}
            </span>
            {DAY_KIND_META[k].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="rounded bg-amber-500/90 px-1 text-[9px] font-bold text-white">L</span>
          Late
        </span>
        <span className="inline-flex items-center gap-1">
          <Home className="h-3 w-3" /> Work from home
        </span>
      </div>
    </div>
  );
}

/**
 * Day-by-day log, newest first: login, logout, hours completed against the
 * day's requirement (so an early logout shows exactly what was done and what
 * is short), overtime and CRM idle time.
 */
export function DailyLog({ days, records }: { days: DayCell[]; records: AttendanceRow[] }) {
  const byDate = new Map(records.map((r) => [r.work_date, r]));
  const rows = days
    .filter(
      (d) =>
        byDate.has(d.date) ||
        ["absent", "paid_leave", "unpaid_leave", "leave_pending", "holiday"].includes(d.kind),
    )
    .reverse();
  if (rows.length === 0)
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">Nothing recorded yet.</div>
    );
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Login</TableHead>
            <TableHead>Logout</TableHead>
            <TableHead className="text-right">Completed</TableHead>
            <TableHead className="text-right">Short / OT</TableHead>
            <TableHead className="text-right">Idle</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((d) => {
            const r = byDate.get(d.date);
            const meta = DAY_KIND_META[d.kind];
            const diff = d.creditedMinutes - d.requiredMinutes;
            const closed = r && !r.open_since;
            const showDiff = closed && !d.nonWorking && d.requiredMinutes > 0;
            return (
              <TableRow key={d.date}>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    weekday: "short",
                    timeZone: "UTC",
                  })}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
                        meta.className,
                      )}
                    >
                      {d.holidayName ?? meta.label}
                    </span>
                    {d.remote && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                        <Home className="h-2.5 w-2.5" /> WFH
                        {r?.remote_status === "pending" && " · pending"}
                      </span>
                    )}
                    {d.late && r && (
                      <span className="rounded-full bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        Late {formatMinutes(r.late_minutes)}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">
                  {r ? timeIST(r.first_login_at) : "—"}
                </TableCell>
                <TableCell className="tabular-nums">
                  {r ? (r.open_since ? "—" : timeIST(r.last_logout_at)) : "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {r ? (
                    <>
                      {formatMinutes(d.creditedMinutes)}
                      {d.requiredMinutes > 0 && (
                        <span className="text-muted-foreground">
                          {" "}
                          / {formatMinutes(d.requiredMinutes)}
                        </span>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell
                  className={cn(
                    "whitespace-nowrap text-right tabular-nums",
                    showDiff && diff < 0 && "text-orange-600",
                    showDiff && diff > 0 && "text-emerald-600",
                  )}
                >
                  {showDiff
                    ? diff < 0
                      ? `−${formatMinutes(-diff)}`
                      : r && r.worked_minutes - d.requiredMinutes > 0
                        ? `+${formatMinutes(r.worked_minutes - d.requiredMinutes)}`
                        : "✓"
                    : closed && d.nonWorking
                      ? `+${formatMinutes(r.worked_minutes)}`
                      : "—"}
                </TableCell>
                <TableCell
                  className={cn("text-right tabular-nums", d.idleMinutes > 0 && "text-amber-600")}
                >
                  {r ? (d.idleMinutes ? formatMinutes(d.idleMinutes) : "0m") : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** Each stretch of 60+ minutes without CRM activity while logged in. */
export function IdlePeriods({ periods }: { periods: IdlePeriod[] }) {
  if (periods.length === 0)
    return (
      <div className="py-4 text-center text-sm text-muted-foreground">
        No idle stretches this month.
      </div>
    );
  return (
    <div className="divide-y rounded-lg border">
      {periods.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
          <span className="w-36 shrink-0 tabular-nums text-muted-foreground">
            {dateTimeIST(p.started_at)}
          </span>
          <span className="tabular-nums">→ {timeIST(p.ended_at)}</span>
          <span className="font-semibold tabular-nums text-amber-600">
            {formatMinutes(p.minutes)} idle
          </span>
          <span className="text-xs text-muted-foreground">
            {p.ended_by === "logout" ? "until logout" : "until CRM was used again"}
          </span>
        </div>
      ))}
    </div>
  );
}
