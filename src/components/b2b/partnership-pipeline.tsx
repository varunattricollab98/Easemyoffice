// Drag-and-drop Partnership Pipeline board for the B2B department.
//
// Modeled directly on src/routes/_authenticated/pipeline.tsx (the Sales
// pipeline): same @dnd-kit/core DndContext + useDraggable/useDroppable, the
// same column/card layout, the same optimistic stage update with rollback on
// error, and the same mandatory-reason dialog for lost/closed moves.
//
// PERFORMANCE: this board (and the dnd-kit it pulls in) must NOT live in a
// route file — an exported route component cannot be code-split, so it would be
// bundled into the entry chunk. The thin route in
// src/routes/_authenticated/b2b/pipeline.tsx renders this component instead,
// mirroring how firm-360.tsx and renewal-dashboard.tsx were extracted.

import { memo, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Building2, MapPin, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/utils";
import { logAudit } from "@/lib/audit";
import { B2B_CLOSED_OUTCOMES, B2B_PIPELINE_STAGES, labelFor } from "@/lib/b2b";
import {
  createActivity,
  listPartnershipsWithFirm,
  updatePartnershipStage,
  type PartnershipWithFirm,
} from "@/lib/b2b-queries";

// The droppable "Lost / Closed" column uses a stable sentinel id so a drop onto
// it is distinguishable from a drop onto one of the forward stages.
const CLOSED_COLUMN_ID = "__closed__";

// When a partnership reaches one of these forward stages, the firm's
// partner_status is nudged to the matching health category so the renewals /
// firm views stay in sync. Earlier stages leave partner_status untouched.
const STAGE_TO_FIRM_STATUS: Record<string, string> = {
  partner_onboarded: "active",
  first_referral: "active",
  active_partner: "strategic",
};

function money(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function PartnershipPipelineBoard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [pendingClose, setPendingClose] = useState<{
    id: string;
    firmId: string;
    firmName: string;
    fromStage: string;
  } | null>(null);
  const [reason, setReason] = useState("");

  const { data: partnerships = [], isLoading } = useQuery({
    queryKey: ["b2b-partnerships-board"],
    queryFn: listPartnershipsWithFirm,
    staleTime: 30_000,
  });

  // Only open partnerships sit on the forward board; lost/won live in the
  // closed column so moving a card there "closes" it.
  const buckets = useMemo(() => {
    const map = new Map<string, PartnershipWithFirm[]>();
    B2B_PIPELINE_STAGES.forEach((s) => map.set(s.id, []));
    const closed: PartnershipWithFirm[] = [];
    for (const p of partnerships) {
      if (p.status === "open") {
        const stage = p.stage && map.has(p.stage) ? p.stage : B2B_PIPELINE_STAGES[0].id;
        map.get(stage)!.push(p);
      } else {
        closed.push(p);
      }
    }
    return { map, closed };
  }, [partnerships]);

  const EMPTY: PartnershipWithFirm[] = useMemo(() => [], []);

  const move = useMutation({
    mutationFn: (vars: {
      id: string;
      firmId: string;
      stage: string;
      status?: PartnershipWithFirm["status"];
      outcomeReason?: string | null;
      firmPartnerStatus?: string | null;
    }) => updatePartnershipStage(vars),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["b2b-partnerships-board"] });
      const snapshot = qc.getQueryData<PartnershipWithFirm[]>(["b2b-partnerships-board"]);
      qc.setQueryData<PartnershipWithFirm[]>(["b2b-partnerships-board"], (old) =>
        (old ?? []).map((p) =>
          p.id === vars.id ? { ...p, stage: vars.stage, status: vars.status ?? p.status } : p,
        ),
      );
      return { snapshot };
    },
    onError: (e: unknown, _vars, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(["b2b-partnerships-board"], ctx.snapshot);
      toast.error(getErrorMessage(e));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["b2b-partnerships-board"] }),
  });

  const logStageChange = (
    p: Pick<PartnershipWithFirm, "id" | "firm_id" | "firm_name">,
    toLabel: string,
    detail: string,
  ) => {
    if (!user) return;
    void createActivity({
      type: "note",
      firm_id: p.firm_id,
      subject: `Pipeline: ${toLabel}`,
      notes: detail,
      created_by: user.id,
    });
    logAudit({
      actorId: user.id,
      action: "stage_change",
      entity: "ca_firm",
      entityId: p.firm_id,
      entityLabel: p.firm_name ?? undefined,
      detail,
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const id = String(e.active.id);
    const target = String(e.over.id);
    const p = partnerships.find((x) => x.id === id);
    if (!p) return;

    // Dropped onto the Lost / Closed column — require a reason first.
    if (target === CLOSED_COLUMN_ID) {
      if (p.status !== "open") return;
      setReason("");
      setPendingClose({
        id: p.id,
        firmId: p.firm_id,
        firmName: p.firm_name ?? "this firm",
        fromStage: p.stage ?? B2B_PIPELINE_STAGES[0].id,
      });
      return;
    }

    const toStage = target;
    if (!B2B_PIPELINE_STAGES.some((s) => s.id === toStage)) return;
    if (p.status === "open" && p.stage === toStage) return;

    const toLabel = labelFor(B2B_PIPELINE_STAGES, toStage);
    const firmPartnerStatus = STAGE_TO_FIRM_STATUS[toStage] ?? undefined;
    move.mutate(
      { id, firmId: p.firm_id, stage: toStage, status: "open", firmPartnerStatus },
      {
        onSuccess: () => {
          toast.success(`Moved to ${toLabel}`);
          logStageChange(p, toLabel, `Moved to ${toLabel}`);
        },
      },
    );
  };

  const confirmClose = () => {
    if (!pendingClose || !reason.trim()) return;
    const { id, firmId, firmName } = pendingClose;
    const p = partnerships.find((x) => x.id === id);
    move.mutate(
      {
        id,
        firmId,
        stage: pendingClose.fromStage,
        status: "lost",
        outcomeReason: reason.trim(),
        firmPartnerStatus: "lost",
      },
      {
        onSuccess: () => {
          toast.success("Partnership marked lost");
          logStageChange(
            { id, firm_id: firmId, firm_name: p?.firm_name ?? firmName },
            "Lost",
            `Marked lost: ${reason.trim()}`,
          );
        },
      },
    );
    setPendingClose(null);
  };

  const total = partnerships.length;
  const open = partnerships.filter((p) => p.status === "open").length;

  return (
    <div className="p-5 md:p-10 space-y-4 max-w-[1600px] mx-auto">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-lg bg-[image:var(--gradient-brand)] text-primary-foreground">
          <Building2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Partnership Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            {open} open · {total} total · drag cards across stages, or onto Lost to close.
          </p>
        </div>
      </div>

      {isLoading && !partnerships.length && (
        <div className="py-16 text-center text-muted-foreground">Loading pipeline…</div>
      )}

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {B2B_PIPELINE_STAGES.map((s) => (
            <StageColumn
              key={s.id}
              id={s.id}
              label={s.label}
              color={s.color}
              items={buckets.map.get(s.id) ?? EMPTY}
            />
          ))}
          <StageColumn
            id={CLOSED_COLUMN_ID}
            label="Lost / Closed"
            color="bg-destructive"
            items={buckets.closed}
            closed
          />
        </div>
      </DndContext>

      <Dialog
        open={!!pendingClose}
        onOpenChange={(o) => {
          if (!o) setPendingClose(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reason required</DialogTitle>
            <DialogDescription>
              Please note why the partnership with{" "}
              <span className="font-medium text-foreground">{pendingClose?.firmName}</span> is being
              closed. This is mandatory.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Chose another partner · went silent · not a fit…"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") confirmClose();
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingClose(null)}>
              Cancel
            </Button>
            <Button disabled={!reason.trim() || move.isPending} onClick={confirmClose}>
              Mark lost
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const StageColumn = memo(function StageColumn({
  id,
  label,
  color,
  items,
  closed,
}: {
  id: string;
  label: string;
  color: string;
  items: PartnershipWithFirm[];
  closed?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`w-72 shrink-0 rounded-2xl border border-border/70 bg-muted/50 p-2 transition-[box-shadow] duration-150 ${
        isOver ? "ring-2 ring-primary" : ""
      } ${closed ? "border-dashed" : ""}`}
    >
      <div
        className={`mb-2 flex items-center justify-between rounded-xl px-3 py-2.5 ${
          closed ? "bg-muted text-muted-foreground" : "pipeline-col-head"
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          {closed ? (
            <XCircle className="h-3.5 w-3.5 text-destructive" />
          ) : (
            <span className={`h-2 w-2 shrink-0 rounded-full ring-2 ring-white/40 ${color}`} />
          )}
          <div className="truncate text-sm font-semibold">{label}</div>
        </div>
        <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold tabular-nums">
          {items.length}
        </span>
      </div>
      <div className="space-y-2 min-h-24 max-h-[640px] overflow-y-auto pr-1">
        {items.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-10 border border-dashed rounded-md">
            {closed ? "Drag here to close." : "No partnerships here."}
          </div>
        ) : (
          items.map((p) =>
            closed ? (
              <StaticCard key={p.id} partnership={p} />
            ) : (
              <DraggableCard key={p.id} partnership={p} />
            ),
          )
        )}
      </div>
    </div>
  );
});

const DraggableCard = memo(function DraggableCard({
  partnership,
}: {
  partnership: PartnershipWithFirm;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: partnership.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        transform: transform ? `translate3d(${transform.x}px,${transform.y}px,0)` : undefined,
      }}
      className={`rounded-xl bg-card border border-border/80 p-3 shadow-[var(--shadow-soft)] cursor-grab active:cursor-grabbing hover:-translate-y-0.5 hover:shadow-[var(--shadow-elevated)] transition-[transform,box-shadow] duration-150 ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <CardBody partnership={partnership} />
    </div>
  );
});

const StaticCard = memo(function StaticCard({ partnership }: { partnership: PartnershipWithFirm }) {
  return (
    <div className="rounded-xl bg-card border border-border/80 p-3 shadow-[var(--shadow-soft)] opacity-80">
      <CardBody partnership={partnership} closed />
    </div>
  );
});

const CardBody = memo(function CardBody({
  partnership,
  closed,
}: {
  partnership: PartnershipWithFirm;
  closed?: boolean;
}) {
  const location = [partnership.firm_city, partnership.firm_state].filter(Boolean).join(", ");
  return (
    <>
      <div className="text-sm font-medium truncate">{partnership.firm_name ?? "Unknown firm"}</div>
      {location && (
        <div className="text-xs text-muted-foreground truncate mt-0.5 flex items-center gap-1">
          <MapPin className="h-3 w-3" /> {location}
        </div>
      )}
      <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
        {partnership.value != null && (
          <Badge variant="secondary" className="text-[10px] rounded-full">
            {money(Number(partnership.value))}
          </Badge>
        )}
        {closed && partnership.status !== "open" && (
          <Badge variant="outline" className="text-[10px] capitalize">
            {partnership.status}
          </Badge>
        )}
        <span className="text-[11px] text-muted-foreground">
          {formatDistanceToNow(new Date(partnership.opened_at), { addSuffix: true })}
        </span>
      </div>
      {closed && partnership.outcome_reason && (
        <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
          {partnership.outcome_reason}
        </div>
      )}
    </>
  );
});
