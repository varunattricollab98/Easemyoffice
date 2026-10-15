import { useMemo } from "react";
import {
  AlarmClock,
  ArrowRight,
  CheckCircle2,
  FolderOpen,
  Gauge,
  Hourglass,
  Timer,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  attentionQueue,
  completedInPeriod,
  formatDuration,
  nextStage,
  periodFrom,
  stageAgeMs,
  stageDef,
  summarizeDocs,
  toDays,
  WAITING_ON_LABEL,
  type DocStage,
} from "@/lib/documentation";
import type { DocSettings, DocTaskRow } from "@/lib/documentation-queries";
import { useMoveDocStage } from "@/lib/documentation-queries";
import { Initials, KpiTile, StageBadge, StageDot, TatChip, WaitingOnChip } from "./doc-ui";
import { bookingRef, bookingTitle, pct } from "./doc-format";
import { cn } from "@/lib/utils";

export function DocOverview({
  tasks,
  settings,
  now,
  showAssignee,
  onOpenTask,
  onOpenStage,
  onShowOverdue,
}: {
  tasks: DocTaskRow[];
  settings: DocSettings;
  now: number;
  showAssignee: boolean;
  onOpenTask: (id: string) => void;
  onOpenStage: (stage: DocStage) => void;
  onShowOverdue: () => void;
}) {
  const move = useMoveDocStage();

  const live = useMemo(
    () => summarizeDocs(tasks, now, settings.stageAlertDays),
    [tasks, now, settings.stageAlertDays],
  );
  const month = useMemo(() => {
    const from = periodFrom("this_month", now);
    return summarizeDocs(completedInPeriod(tasks, from, now), now);
  }, [tasks, now]);
  const queue = useMemo(
    () => attentionQueue(tasks, now, settings.stageAlertDays).slice(0, 12),
    [tasks, now, settings.stageAlertDays],
  );
  const recent = useMemo(
    () =>
      tasks
        .filter((t) => t.stage === "completed" && t.completed_at)
        .sort((a, b) => Date.parse(b.completed_at!) - Date.parse(a.completed_at!))
        .slice(0, 6),
    [tasks],
  );
  const maxStage = Math.max(
    1,
    ...live.byStage.filter((b) => b.stage !== "completed").map((b) => b.count),
  );
  const waitingTotal = live.waitingOn.team + live.waitingOn.client + live.waitingOn.sp;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <KpiTile icon={FolderOpen} label="Open" value={live.open} hint="In the pipeline now" />
        <KpiTile
          icon={AlarmClock}
          label="TAT breached"
          value={live.overdue}
          tone={live.overdue ? "bad" : "good"}
          hint={`Past ${settings.tatDays}-day TAT`}
          onClick={live.overdue ? onShowOverdue : undefined}
        />
        <KpiTile
          icon={Timer}
          label="Due in 24h"
          value={live.dueSoon}
          tone={live.dueSoon ? "warn" : "default"}
        />
        <KpiTile
          icon={Hourglass}
          label="Stuck in stage"
          value={live.stuck}
          tone={live.stuck ? "warn" : "default"}
          hint={`No move for ${settings.stageAlertDays}d+`}
        />
        <KpiTile
          icon={CheckCircle2}
          label="Completed"
          value={month.completed}
          hint="This month"
          tone="good"
        />
        <KpiTile
          icon={Gauge}
          label="On-time"
          value={pct(month.onTimeRate)}
          hint={`${month.completedOnTime}/${month.completed} within TAT`}
          tone={
            month.onTimeRate == null
              ? "default"
              : month.onTimeRate >= 0.8
                ? "good"
                : month.onTimeRate >= 0.5
                  ? "warn"
                  : "bad"
          }
        />
        <KpiTile
          icon={TrendingUp}
          label="Avg TAT"
          value={month.avgCompletionMs == null ? "—" : `${toDays(month.avgCompletionMs)}d`}
          hint={`Target ${settings.tatDays}d · this month`}
          tone={
            month.avgCompletionMs == null
              ? "default"
              : (toDays(month.avgCompletionMs) ?? 0) <= settings.tatDays
                ? "good"
                : "bad"
          }
        />
      </div>

      {/* Stage strip */}
      <section className="surface-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Pipeline by stage</h2>
          <span className="text-xs text-muted-foreground">
            Click a stage to open it on the board
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {live.byStage
            .filter((b) => b.stage !== "completed")
            .map((b) => {
              const def = stageDef(b.stage);
              return (
                <button
                  key={b.stage}
                  type="button"
                  onClick={() => onOpenStage(b.stage)}
                  className="group rounded-xl border bg-background/50 p-3 text-left transition hover:border-primary/40 hover:shadow-sm"
                >
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <StageDot stage={b.stage} />
                    <span className="truncate">{def.label}</span>
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-xl font-bold tabular-nums">{b.count}</span>
                    {b.overdue > 0 && (
                      <span className="text-[11px] font-medium text-red-600 dark:text-red-400">
                        {b.overdue} overdue
                      </span>
                    )}
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full", def.color)}
                      style={{ width: `${(b.count / maxStage) * 100}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-1">
                    <WaitingOnChip waitingOn={def.waitingOn} />
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {b.avgAgeMs == null ? "" : `avg ${formatDuration(b.avgAgeMs)}`}
                    </span>
                  </div>
                </button>
              );
            })}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Needs attention */}
        <section className="surface-card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Needs attention</h2>
            <span className="text-xs text-muted-foreground">
              Overdue · due in 24h · stuck · escalated
            </span>
          </div>
          {queue.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Nothing urgent — every open file is on track.
            </div>
          ) : (
            <ul className="divide-y">
              {queue.map((t) => {
                const nxt = nextStage(t.stage);
                return (
                  <li key={t.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center">
                    <button
                      type="button"
                      onClick={() => onOpenTask(t.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{bookingTitle(t.bookings)}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {bookingRef(t.bookings)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <StageBadge stage={t.stage} />
                        <TatChip task={t} now={now} />
                        <span className="text-[11px] text-muted-foreground">
                          in stage {formatDuration(stageAgeMs(t, now))} · {stageDef(t.stage).next}
                        </span>
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      {showAssignee && <Initials name={t.assignee_name} />}
                      {nxt && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          disabled={move.isPending}
                          onClick={() => move.mutate({ taskId: t.id, stage: nxt })}
                        >
                          {stageDef(nxt).label} <ArrowRight className="ml-1 h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="space-y-5">
          <section className="surface-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Open files waiting on</h2>
            {(["team", "client", "sp"] as const).map((w) => {
              const n = live.waitingOn[w];
              return (
                <div key={w} className="mb-2.5 last:mb-0">
                  <div className="mb-1 flex justify-between text-xs">
                    <span>{WAITING_ON_LABEL[w]}</span>
                    <span className="tabular-nums text-muted-foreground">{n}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        w === "team"
                          ? "bg-sky-500"
                          : w === "client"
                            ? "bg-violet-500"
                            : "bg-orange-500",
                      )}
                      style={{ width: `${waitingTotal ? (n / waitingTotal) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </section>

          <section className="surface-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Recently completed</h2>
            {recent.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                No completed files yet.
              </div>
            ) : (
              <ul className="space-y-2">
                {recent.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => onOpenTask(t.id)}
                      className="flex w-full items-center gap-2 text-left"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {bookingTitle(t.bookings)}
                      </span>
                      <TatChip task={t} now={now} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
