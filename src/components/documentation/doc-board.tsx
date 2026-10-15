import { memo, useEffect, useMemo, useRef } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Building2, Hourglass } from "lucide-react";
import {
  DOC_STAGES,
  formatDuration,
  isStuck,
  stageAgeMs,
  tatState,
  type DocStage,
  type DocStageDef,
} from "@/lib/documentation";
import { useMoveDocStage, type DocTaskRow } from "@/lib/documentation-queries";
import { Initials, TatChip, WaitingOnChip } from "./doc-ui";
import { bookingRef, bookingTitle } from "./doc-format";
import { cn } from "@/lib/utils";

/** Completed column only shows files closed in the last 14 days. */
const COMPLETED_WINDOW_MS = 14 * 24 * 3600_000;

export function DocBoard({
  tasks,
  now,
  stageAlertDays,
  showAssignee,
  focusStage,
  onOpenTask,
}: {
  tasks: DocTaskRow[];
  now: number;
  stageAlertDays: number;
  showAssignee: boolean;
  focusStage: DocStage | null;
  onOpenTask: (id: string) => void;
}) {
  const move = useMoveDocStage();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );

  const buckets = useMemo(() => {
    const map = new Map<DocStage, DocTaskRow[]>(DOC_STAGES.map((s) => [s.id, []]));
    for (const t of tasks) {
      if (
        t.stage === "completed" &&
        (!t.completed_at || now - Date.parse(t.completed_at) > COMPLETED_WINDOW_MS)
      )
        continue;
      map.get(t.stage)?.push(t);
    }
    for (const [stage, list] of map) {
      // Most urgent first: earliest deadline; completed: newest first.
      list.sort((a, b) =>
        stage === "completed"
          ? Date.parse(b.completed_at!) - Date.parse(a.completed_at!)
          : Date.parse(a.due_at) - Date.parse(b.due_at),
      );
    }
    return map;
  }, [tasks, now]);

  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusStage) return;
    scroller.current
      ?.querySelector(`[data-stage="${focusStage}"]`)
      ?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }, [focusStage]);

  const onDragEnd = (e: DragEndEvent) => {
    const to = e.over?.id as DocStage | undefined;
    const id = String(e.active.id);
    const task = tasks.find((t) => t.id === id);
    if (!to || !task || task.stage === to) return;
    move.mutate({ taskId: id, stage: to });
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div ref={scroller} className="scrollbar-modern flex gap-3 overflow-x-auto pb-3">
        {DOC_STAGES.map((s) => (
          <StageColumn
            key={s.id}
            stage={s}
            items={buckets.get(s.id) ?? []}
            now={now}
            stageAlertDays={stageAlertDays}
            showAssignee={showAssignee}
            highlighted={focusStage === s.id}
            onOpenTask={onOpenTask}
          />
        ))}
      </div>
    </DndContext>
  );
}

const StageColumn = memo(function StageColumn({
  stage,
  items,
  now,
  stageAlertDays,
  showAssignee,
  highlighted,
  onOpenTask,
}: {
  stage: DocStageDef;
  items: DocTaskRow[];
  now: number;
  stageAlertDays: number;
  showAssignee: boolean;
  highlighted: boolean;
  onOpenTask: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const overdue = items.filter((t) => tatState(t, now) === "overdue").length;
  const avgAge =
    items.length && stage.id !== "completed"
      ? items.reduce((a, t) => a + stageAgeMs(t, now), 0) / items.length
      : null;

  return (
    <div
      ref={setNodeRef}
      data-stage={stage.id}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-2xl border bg-muted/30 transition",
        isOver && "ring-2 ring-primary/50",
        highlighted && "ring-2 ring-primary/30",
      )}
    >
      <div className="sticky top-0 space-y-1.5 rounded-t-2xl border-b bg-background/70 p-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className={cn("h-2.5 w-2.5 rounded-full", stage.color)} />
          <span className="truncate text-sm font-semibold">{stage.label}</span>
          <span className="ml-auto rounded-full bg-background px-2 py-0.5 text-xs font-medium tabular-nums ring-1 ring-border">
            {items.length}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <WaitingOnChip waitingOn={stage.waitingOn} />
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {overdue > 0 && (
              <span className="mr-1.5 font-semibold text-red-600 dark:text-red-400">
                {overdue} overdue
              </span>
            )}
            {avgAge != null && `avg ${formatDuration(avgAge)}`}
            {stage.id === "completed" && "last 14 days"}
          </span>
        </div>
      </div>
      <div className="scrollbar-modern flex max-h-[calc(100vh-320px)] min-h-[160px] flex-col gap-2 overflow-y-auto p-2">
        {items.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">Drop a file here</div>
        ) : (
          items.map((t) => (
            <DocCard
              key={t.id}
              task={t}
              now={now}
              stuck={isStuck(t, now, stageAlertDays)}
              showAssignee={showAssignee}
              onOpen={onOpenTask}
            />
          ))
        )}
      </div>
    </div>
  );
});

function DocCard({
  task,
  now,
  stuck,
  showAssignee,
  onOpen,
}: {
  task: DocTaskRow;
  now: number;
  stuck: boolean;
  showAssignee: boolean;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  });
  const state = tatState(task, now);
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  const b = task.bookings;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(task.id)}
      className={cn(
        "cursor-grab select-none rounded-xl border bg-card p-3 text-left shadow-sm transition hover:shadow-md active:cursor-grabbing",
        state === "overdue" && "border-red-300 dark:border-red-900",
        isDragging && "z-50 opacity-80 shadow-lg",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{bookingTitle(b)}</div>
          <div className="truncate text-xs text-muted-foreground">
            {bookingRef(b)}
            {b?.business_name && b.client_name ? ` · ${b.client_name}` : ""}
          </div>
        </div>
        {showAssignee && <Initials name={task.assignee_name} />}
      </div>
      {(b?.sp_name || b?.city) && (
        <div className="mt-1.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
          <Building2 className="h-3 w-3 shrink-0" />
          <span className="truncate">{[b?.sp_name, b?.city].filter(Boolean).join(" · ")}</span>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <TatChip task={task} now={now} />
        {task.stage !== "completed" && (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[11px] tabular-nums",
              stuck ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground",
            )}
            title="Time in this stage"
          >
            <Hourglass className="h-3 w-3" />
            {formatDuration(stageAgeMs(task, now))}
          </span>
        )}
        {task.escalated && (
          <span className="rounded-md bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
            Escalated
          </span>
        )}
      </div>
    </div>
  );
}
