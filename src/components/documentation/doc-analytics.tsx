import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import {
  AlarmClock,
  CheckCircle2,
  Download,
  FilePlus2,
  Gauge,
  Timer,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  completedInPeriod,
  DOC_PERIODS,
  docTrend,
  formatDuration,
  OPEN_STAGES,
  perAssignee,
  periodFrom,
  stageDef,
  stageDurations,
  summarizeDocs,
  tatState,
  toDays,
  WAITING_ON_LABEL,
  type DocPeriod,
} from "@/lib/documentation";
import type { DocEventRow, DocSettings, DocTaskRow } from "@/lib/documentation-queries";
import { GlassSegmented, KpiTile, StageDot } from "./doc-ui";
import { pct } from "./doc-format";
import { cn } from "@/lib/utils";

const chartConfig = {
  assigned: { label: "Assigned", color: "var(--chart-1, oklch(0.62 0.19 260))" },
  completed: { label: "Completed", color: "var(--chart-2, oklch(0.7 0.17 160))" },
  onTime: { label: "Within TAT", color: "var(--chart-4, oklch(0.75 0.16 75))" },
} satisfies ChartConfig;

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function DocAnalytics({
  tasks,
  events,
  settings,
  now,
}: {
  tasks: DocTaskRow[];
  events: DocEventRow[];
  settings: DocSettings;
  now: number;
}) {
  const [period, setPeriod] = useState<DocPeriod>("30d");
  const from = useMemo(() => periodFrom(period, now, tasks), [period, now, tasks]);

  const assignedInPeriod = useMemo(
    () => tasks.filter((t) => Date.parse(t.created_at) >= from && Date.parse(t.created_at) <= now),
    [tasks, from, now],
  );
  const doneInPeriod = useMemo(() => completedInPeriod(tasks, from, now), [tasks, from, now]);
  const doneSummary = useMemo(() => summarizeDocs(doneInPeriod, now), [doneInPeriod, now]);
  const live = useMemo(
    () => summarizeDocs(tasks, now, settings.stageAlertDays),
    [tasks, now, settings.stageAlertDays],
  );
  const trend = useMemo(() => docTrend(tasks, from, now), [tasks, from, now]);

  const periodTaskIds = useMemo(
    () => new Set(doneInPeriod.concat(assignedInPeriod).map((t) => t.id)),
    [doneInPeriod, assignedInPeriod],
  );
  const durations = useMemo(
    () => stageDurations(events.filter((e) => periodTaskIds.has(e.task_id))),
    [events, periodTaskIds],
  );
  const slowest = durations.reduce<number>((m, d) => Math.max(m, d.avgMs ?? 0), 0);

  const overdueWaiting = useMemo(() => {
    const out = { team: 0, client: 0, sp: 0 };
    for (const t of tasks) {
      if (tatState(t, now) !== "overdue") continue;
      const w = stageDef(t.stage).waitingOn;
      if (w !== "done") out[w]++;
    }
    return out;
  }, [tasks, now]);

  const team = useMemo(() => {
    const names = new Map(tasks.map((t) => [t.assigned_to, t.assignee_name]));
    const doneBy = new Map(perAssignee(doneInPeriod, now).map((r) => [r.assigneeId, r]));
    const liveBy = new Map(perAssignee(tasks, now).map((r) => [r.assigneeId, r]));
    const assignedBy = new Map<string, number>();
    for (const t of assignedInPeriod)
      assignedBy.set(t.assigned_to, (assignedBy.get(t.assigned_to) ?? 0) + 1);
    return [...names.keys()]
      .map((id) => ({
        id,
        name: names.get(id) ?? "Unknown",
        assigned: assignedBy.get(id) ?? 0,
        completed: doneBy.get(id)?.completed ?? 0,
        onTimeRate: doneBy.get(id)?.onTimeRate ?? null,
        avgMs: doneBy.get(id)?.avgCompletionMs ?? null,
        open: liveBy.get(id)?.open ?? 0,
        overdue: liveBy.get(id)?.overdue ?? 0,
      }))
      .filter((r) => r.assigned || r.completed || r.open)
      .sort((a, b) => b.completed - a.completed || b.open - a.open);
  }, [tasks, doneInPeriod, assignedInPeriod, now]);

  const exportCsv = () => {
    const header = [
      "Booking ID",
      "Business",
      "Client",
      "Space partner",
      "Assigned to",
      "Stage",
      "Assigned on",
      "TAT due",
      "Completed on",
      "Days taken",
      "Within TAT",
    ];
    const lines = tasks
      .filter((t) => periodTaskIds.has(t.id))
      .map((t) => {
        const state = tatState(t, now);
        const taken = t.completed_at
          ? toDays(Date.parse(t.completed_at) - Date.parse(t.created_at))
          : null;
        return [
          t.bookings?.external_booking_id || t.bookings?.booking_code,
          t.bookings?.business_name,
          t.bookings?.client_name,
          t.bookings?.sp_name,
          t.assignee_name,
          stageDef(t.stage).label,
          t.created_at.slice(0, 10),
          t.due_at.slice(0, 10),
          t.completed_at?.slice(0, 10) ?? "",
          taken ?? "",
          state === "met" ? "Yes" : state === "missed" || state === "overdue" ? "No" : "",
        ]
          .map(csvCell)
          .join(",");
      });
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `documentation-${period}-${new Date(now).toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <GlassSegmented
          ariaLabel="Period"
          value={period}
          onChange={setPeriod}
          options={DOC_PERIODS}
        />
        <Button size="sm" variant="outline" onClick={exportCsv}>
          <Download className="mr-1.5 h-4 w-4" /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile
          icon={FilePlus2}
          label="Assigned"
          value={assignedInPeriod.length}
          hint="New files in period"
        />
        <KpiTile
          icon={CheckCircle2}
          label="Completed"
          value={doneSummary.completed}
          tone="good"
          hint="Closed in period"
        />
        <KpiTile
          icon={Gauge}
          label="Within TAT"
          value={pct(doneSummary.onTimeRate)}
          hint={`${doneSummary.completedOnTime} of ${doneSummary.completed} in ≤${settings.tatDays}d`}
          tone={
            doneSummary.onTimeRate == null
              ? "default"
              : doneSummary.onTimeRate >= 0.8
                ? "good"
                : doneSummary.onTimeRate >= 0.5
                  ? "warn"
                  : "bad"
          }
        />
        <KpiTile
          icon={TrendingUp}
          label="Avg TAT"
          value={
            doneSummary.avgCompletionMs == null ? "—" : `${toDays(doneSummary.avgCompletionMs)}d`
          }
          hint={`Median ${doneSummary.medianCompletionMs == null ? "—" : `${toDays(doneSummary.medianCompletionMs)}d`}`}
        />
        <KpiTile
          icon={Timer}
          label="TAT missed"
          value={doneSummary.completed - doneSummary.completedOnTime}
          tone={doneSummary.completed - doneSummary.completedOnTime ? "bad" : "default"}
          hint="Completed late"
        />
        <KpiTile
          icon={AlarmClock}
          label="Overdue now"
          value={live.overdue}
          tone={live.overdue ? "bad" : "good"}
          hint={`${live.open} open`}
        />
      </div>

      <section className="surface-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Assigned vs completed</h2>
        <ChartContainer config={chartConfig} className="h-[260px] w-full">
          <ComposedChart data={trend}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              fontSize={11}
              minTickGap={16}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              fontSize={11}
              width={28}
              allowDecimals={false}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="assigned" fill="var(--color-assigned)" radius={4} />
            <Bar dataKey="completed" fill="var(--color-completed)" radius={4} />
            <Line
              type="monotone"
              dataKey="onTime"
              stroke="var(--color-onTime)"
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ChartContainer>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="surface-card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Average time per stage</h2>
            <span className="text-xs text-muted-foreground">
              Finished stage visits · slowest highlighted
            </span>
          </div>
          <div className="space-y-2">
            {durations.map((d) => {
              const def = stageDef(d.stage);
              const isSlowest = d.avgMs != null && d.avgMs === slowest && slowest > 0;
              return (
                <div
                  key={d.stage}
                  className="grid grid-cols-[150px_1fr_80px] items-center gap-3 text-sm"
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <StageDot stage={d.stage} />
                    <span className="truncate">{def.label}</span>
                  </span>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full", isSlowest ? "bg-red-500" : def.color)}
                      style={{ width: `${slowest && d.avgMs ? (d.avgMs / slowest) * 100 : 0}%` }}
                    />
                  </div>
                  <span
                    className={cn(
                      "text-right tabular-nums",
                      isSlowest && "font-semibold text-red-600 dark:text-red-400",
                    )}
                  >
                    {d.avgMs == null ? "—" : formatDuration(d.avgMs)}
                    <span className="ml-1 text-[10px] text-muted-foreground">({d.samples})</span>
                  </span>
                </div>
              );
            })}
          </div>
          {durations.every((d) => d.samples === 0) && (
            <p className="mt-3 text-xs text-muted-foreground">
              Stage timings build up as files move through the pipeline (history starts with this
              release).
            </p>
          )}
        </section>

        <div className="space-y-5">
          <section className="surface-card p-4">
            <h2 className="mb-1 text-sm font-semibold">Overdue files are waiting on</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Who is holding up the {live.overdue} TAT breaches
            </p>
            {(["team", "client", "sp"] as const).map((w) => (
              <div key={w} className="flex items-center justify-between py-1 text-sm">
                <span>{WAITING_ON_LABEL[w]}</span>
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    overdueWaiting[w] && "text-red-600 dark:text-red-400",
                  )}
                >
                  {overdueWaiting[w]}
                </span>
              </div>
            ))}
          </section>
          <section className="surface-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Open by stage (live)</h2>
            {live.byStage
              .filter((b) => b.stage !== "completed" && b.count > 0)
              .map((b) => (
                <div key={b.stage} className="flex items-center justify-between py-0.5 text-sm">
                  <span className="flex items-center gap-1.5">
                    <StageDot stage={b.stage} />
                    {stageDef(b.stage).label}
                  </span>
                  <span className="tabular-nums">
                    {b.count}
                    {b.overdue > 0 && (
                      <span className="ml-1.5 text-xs text-red-600 dark:text-red-400">
                        {b.overdue} late
                      </span>
                    )}
                  </span>
                </div>
              ))}
            {live.open === 0 && <div className="text-xs text-muted-foreground">No open files.</div>}
          </section>
        </div>
      </div>

      <section className="surface-card overflow-hidden">
        <div className="p-4 pb-2">
          <h2 className="text-sm font-semibold">Team performance</h2>
          <p className="text-xs text-muted-foreground">
            Assigned / completed in the period · open and overdue right now
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead className="text-right">Assigned</TableHead>
              <TableHead className="text-right">Completed</TableHead>
              <TableHead className="text-right">Within TAT</TableHead>
              <TableHead className="text-right">Avg TAT</TableHead>
              <TableHead className="text-right">Open</TableHead>
              <TableHead className="text-right">Overdue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {team.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No documentation activity in this period.
                </TableCell>
              </TableRow>
            ) : (
              team.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.assigned}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.completed}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(r.onTimeRate)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.avgMs == null ? "—" : `${toDays(r.avgMs)}d`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.open}</TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      r.overdue && "font-semibold text-red-600 dark:text-red-400",
                    )}
                  >
                    {r.overdue}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>

      <p className="text-[11px] text-muted-foreground">
        TAT is {settings.tatDays} calendar days from assignment. Stages:{" "}
        {OPEN_STAGES.map((s) => s.label).join(" → ")} → Completed.
      </p>
    </div>
  );
}
