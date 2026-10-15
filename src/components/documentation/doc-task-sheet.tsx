import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Loader2, Mail, Phone } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DOC_STAGES,
  formatDuration,
  nextStage,
  prevStage,
  stageAgeMs,
  stageDef,
  stageIndex,
  type DocStage,
} from "@/lib/documentation";
import {
  emailDocAssignee,
  useDocTeam,
  useMoveDocStage,
  useTaskEvents,
  useUpdateDocTask,
  type DocTaskRow,
} from "@/lib/documentation-queries";
import { StageDot, TatChip, WaitingOnChip } from "./doc-ui";
import { bookingRef, bookingTitle } from "./doc-format";
import { cn } from "@/lib/utils";

const fmt = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

export function DocTaskSheet({
  task,
  now,
  isAdmin,
  onClose,
}: {
  task: DocTaskRow | null;
  now: number;
  isAdmin: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!task} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="scrollbar-modern w-full overflow-y-auto sm:max-w-xl">
        {task && <SheetBody key={task.id} task={task} now={now} isAdmin={isAdmin} />}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({ task, now, isAdmin }: { task: DocTaskRow; now: number; isAdmin: boolean }) {
  const move = useMoveDocStage();
  const update = useUpdateDocTask();
  const { data: events = [], isLoading: eventsLoading } = useTaskEvents(task.id);
  const { data: team = [] } = useDocTeam(isAdmin);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [reason, setReason] = useState("");
  useEffect(() => setNotes(task.notes ?? ""), [task.notes]);

  const b = task.bookings;
  const nxt = nextStage(task.stage);
  const prv = prevStage(task.stage);
  const def = stageDef(task.stage);
  const current = stageIndex(task.stage);

  // When each stage was last entered, from the history.
  const enteredAt = useMemo(() => {
    const m = new Map<DocStage, string>();
    for (const e of events) m.set(e.to_stage, e.changed_at);
    return m;
  }, [events]);

  const doMove = (stage: DocStage) => move.mutate({ taskId: task.id, stage });

  const reassign = async (assigneeId: string) => {
    if (assigneeId === task.assigned_to) return;
    await update.mutateAsync({ taskId: task.id, patch: { assigned_to: assigneeId } });
    toast.success("Re-assigned");
    const sent = await emailDocAssignee(task.booking_id, assigneeId);
    if (!sent) toast.warning("Re-assigned, but the email to the new owner could not be sent");
  };

  const details: [string, ReactNode][] = [
    ["Client", b?.client_name],
    [
      "Phone",
      b?.contact_no ? (
        <a
          className="inline-flex items-center gap-1 text-primary hover:underline"
          href={`tel:${b.contact_no}`}
        >
          <Phone className="h-3 w-3" />
          {b.contact_no}
        </a>
      ) : null,
    ],
    [
      "Email",
      b?.email_id ? (
        <a
          className="inline-flex items-center gap-1 break-all text-primary hover:underline"
          href={`mailto:${b.email_id}`}
        >
          <Mail className="h-3 w-3 shrink-0" />
          {b.email_id}
        </a>
      ) : null,
    ],
    ["Plan", b?.plan_name],
    ["Space partner", b?.sp_name],
    ["Location", [b?.area, b?.city, b?.state].filter(Boolean).join(", ")],
    ["Sales agent", b?.sales_agent_name],
    ["Booking date", b?.booking_date],
    ["Assigned by", task.assigned_by_name],
    ["Assigned on", fmt(task.created_at)],
    ["TAT due", fmt(task.due_at)],
  ];

  return (
    <div className="space-y-5">
      <SheetHeader className="space-y-1 text-left">
        <SheetTitle className="pr-6">{bookingTitle(b)}</SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-2">
          <span>{bookingRef(b)}</span>
          <TatChip task={task} now={now} />
          {task.escalated && (
            <span className="rounded-md bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
              Escalated
            </span>
          )}
        </SheetDescription>
      </SheetHeader>

      {/* Current stage + actions */}
      <section className="rounded-2xl border bg-muted/30 p-4">
        <div className="flex items-center gap-2">
          <StageDot stage={task.stage} className="h-2.5 w-2.5" />
          <span className="font-semibold">{def.label}</span>
          <WaitingOnChip waitingOn={def.waitingOn} className="ml-auto" />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {def.next}
          {task.stage !== "completed" &&
            ` · in this stage ${formatDuration(stageAgeMs(task, now))}`}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {nxt && (
            <Button size="sm" disabled={move.isPending} onClick={() => doMove(nxt)}>
              {move.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="mr-1 h-3.5 w-3.5" />
              )}
              Mark: {stageDef(nxt).label}
            </Button>
          )}
          {prv && (
            <Button
              size="sm"
              variant="outline"
              disabled={move.isPending}
              onClick={() => doMove(prv)}
            >
              <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back to {stageDef(prv).label}
            </Button>
          )}
          <Select value={task.stage} onValueChange={(v) => doMove(v as DocStage)}>
            <SelectTrigger className="h-8 w-auto min-w-40 text-xs">
              <SelectValue placeholder="Jump to stage" />
            </SelectTrigger>
            <SelectContent>
              {DOC_STAGES.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {/* Stepper */}
      <section>
        <h3 className="mb-2 text-sm font-semibold">Progress</h3>
        <ol className="relative space-y-0.5 border-l pl-4">
          {DOC_STAGES.map((s, i) => {
            const done = i < current || task.stage === "completed";
            const isCur = i === current && task.stage !== "completed";
            return (
              <li key={s.id} className="relative py-1">
                <span
                  className={cn(
                    "absolute -left-[21px] top-2 flex h-2.5 w-2.5 rounded-full ring-2 ring-background",
                    done ? "bg-emerald-500" : isCur ? s.color : "bg-muted-foreground/25",
                  )}
                />
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span
                    className={cn(isCur ? "font-semibold" : done ? "" : "text-muted-foreground")}
                  >
                    {s.label}
                  </span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {done || isCur ? fmt(enteredAt.get(s.id)) : ""}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
        {eventsLoading && (
          <div className="mt-1 text-xs text-muted-foreground">Loading history…</div>
        )}
      </section>

      {/* Booking details */}
      <section>
        <h3 className="mb-2 text-sm font-semibold">Booking details</h3>
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-sm">
          {details
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="min-w-0">{v}</dd>
              </div>
            ))}
        </dl>
      </section>

      {/* Owner */}
      <section className="space-y-1.5">
        <Label className="text-sm font-semibold">Documentation owner</Label>
        {isAdmin ? (
          <Select value={task.assigned_to} onValueChange={(v) => void reassign(v)}>
            <SelectTrigger>
              <SelectValue placeholder={task.assignee_name ?? "Select"} />
            </SelectTrigger>
            <SelectContent>
              {!team.some((m) => m.id === task.assigned_to) && (
                <SelectItem value={task.assigned_to}>
                  {task.assignee_name ?? "Current owner"}
                </SelectItem>
              )}
              {team.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.full_name || m.email || m.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="text-sm">{task.assignee_name ?? "—"}</div>
        )}
      </section>

      {/* Notes */}
      <section className="space-y-1.5">
        <Label htmlFor="doc-notes" className="text-sm font-semibold">
          Notes
        </Label>
        <Textarea
          id="doc-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. PAN copy blurred, asked client to resend"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            disabled={update.isPending || notes === (task.notes ?? "")}
            onClick={() =>
              update.mutate(
                { taskId: task.id, patch: { notes: notes.trim() || null } },
                { onSuccess: () => toast.success("Notes saved") },
              )
            }
          >
            Save notes
          </Button>
        </div>
      </section>

      {/* Escalation (admin) */}
      {isAdmin && task.stage !== "completed" && (
        <section className="space-y-1.5 rounded-2xl border border-red-200 p-4 dark:border-red-900/60">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-red-700 dark:text-red-400">
            <AlertTriangle className="h-4 w-4" /> Escalation
          </div>
          {task.escalated ? (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">{task.escalation_reason || "Escalated"}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={update.isPending}
                onClick={() =>
                  update.mutate(
                    {
                      taskId: task.id,
                      patch: { escalated: false, escalation_reason: null, escalated_at: null },
                    },
                    { onSuccess: () => toast.success("Escalation cleared") },
                  )
                }
              >
                Clear
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason, e.g. client not responding"
              />
              <Button
                size="sm"
                variant="destructive"
                disabled={update.isPending || !reason.trim()}
                onClick={() =>
                  update.mutate(
                    {
                      taskId: task.id,
                      patch: {
                        escalated: true,
                        escalation_reason: reason.trim(),
                        escalated_at: new Date().toISOString(),
                      },
                    },
                    {
                      onSuccess: () => {
                        setReason("");
                        toast.success("Escalated");
                      },
                    },
                  )
                }
              >
                Escalate
              </Button>
            </div>
          )}
        </section>
      )}

      {/* History */}
      {events.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">History</h3>
          <ul className="space-y-1.5 text-xs">
            {[...events].reverse().map((e) => (
              <li key={e.id} className="flex items-start gap-2">
                <StageDot stage={e.to_stage} className="mt-1" />
                <div className="min-w-0 flex-1">
                  {e.from_stage ? (
                    <>
                      {stageDef(e.from_stage).label} <ArrowRight className="inline h-3 w-3" />{" "}
                      <b>{stageDef(e.to_stage).label}</b>
                    </>
                  ) : (
                    <b>Assigned</b>
                  )}
                  {e.changed_by_name && (
                    <span className="text-muted-foreground"> · {e.changed_by_name}</span>
                  )}
                  {e.backfilled && <span className="text-muted-foreground"> · imported</span>}
                </div>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {fmt(e.changed_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
