// Month calendar + totals for one employee. Shared by the employee's own
// attendance page and the admin's per-employee drill-down, so both sides see
// exactly the same picture. No salary figures, by design.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMinutes } from "@/lib/hrms";
import type { DayCell, DayKind, MonthStats } from "@/lib/attendance-rules";

const DAY_KIND_META: Record<DayKind, { mark: string; label: string; className: string }> = {
  present: {
    mark: "✓",
    label: "Present",
    className:
      "bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  },
  half_day: {
    mark: "½",
    label: "Half day",
    className:
      "bg-sky-50 text-sky-700 ring-sky-200/70 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900",
  },
  absent: {
    mark: "A",
    label: "Absent",
    className:
      "bg-rose-50 text-rose-700 ring-rose-200/70 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900",
  },
  in_progress: {
    mark: "●",
    label: "Logged in",
    className:
      "bg-primary/10 text-primary ring-primary/25 dark:bg-primary/15 dark:text-primary dark:ring-primary/30",
  },
  action_needed: {
    mark: "⚠",
    label: "Logout missing",
    className:
      "bg-amber-50 text-amber-700 ring-amber-200/70 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  },
  holiday: {
    mark: "H",
    label: "Holiday",
    className:
      "bg-violet-50 text-violet-700 ring-violet-200/70 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900",
  },
  week_off: {
    mark: "–",
    label: "Week off",
    className: "bg-muted/50 text-muted-foreground ring-border/60",
  },
  today: {
    mark: "•",
    label: "Today",
    className: "bg-background text-foreground ring-primary/40",
  },
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
  "half_day",
  "absent",
  "action_needed",
  "holiday",
  "week_off",
  "in_progress",
];

const WEEK_HEADER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

export function MonthStatsGrid({ stats }: { stats: MonthStats }) {
  const items: { label: string; value: string; hint?: string; tone?: string }[] = [
    {
      label: "Working days",
      value: `${stats.elapsedWorkingDays}/${stats.workingDays}`,
      hint: "so far / in month",
    },
    { label: "Present", value: String(stats.present), tone: "text-emerald-600" },
    { label: "Half days", value: String(stats.halfDays), tone: "text-sky-600" },
    { label: "Absent", value: String(stats.absent), tone: "text-rose-600" },
    { label: "Late", value: String(stats.late), tone: "text-amber-600" },
    {
      label: "Action needed",
      value: String(stats.actionNeeded),
      hint: "missing logout",
      tone: stats.actionNeeded ? "text-amber-600" : undefined,
    },
    {
      label: "Hours worked",
      value: formatMinutes(stats.workedMinutes),
      hint: `of ${formatMinutes(stats.requiredMinutes)} required`,
    },
    { label: "Overtime", value: formatMinutes(stats.overtimeMinutes) },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((i) => (
        <div
          key={i.label}
          className="rounded-xl border border-black/[0.06] bg-white/60 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_3px_rgba(0,0,0,0.04)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]"
        >
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
            d.late ? "late" : null,
            d.workedMinutes ? formatMinutes(d.workedMinutes) : null,
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
                "inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-semibold ring-1",
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
      </div>
    </div>
  );
}
