import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { STAGES, INTERESTS } from "@/lib/crm";
import { Badge } from "@/components/ui/badge";
import {
  DndContext, useDraggable, useDroppable, type DragEndEvent,
  PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useVirtualizer } from "@tanstack/react-virtual";
import { PipelineSkeleton } from "@/components/skeletons";
import { usePagePerf } from "@/lib/perf";
import { triggerStageReminder } from "@/lib/stage-reminders";

export const Route = createFileRoute("/_authenticated/pipeline")({
  head: () => ({ meta: [{ title: "Pipeline — EaseMyOffice CRM" }] }),
  component: PipelinePage,
});

type Lead = {
  id: string; lead_code: string; client_name: string;
  company_name: string | null; email: string | null; stage: string; interest: string;
  next_follow_up_at: string | null;
  last_activity_at?: string; created_at?: string;
};

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 1024 : false,
  );
  // refresh on resize
  useMemo(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isMobile;
};

function PipelinePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [activeStage, setActiveStage] = useState<string>(STAGES[0].id);
  const [search, setSearch] = useState("");
  const [interestFilter, setInterestFilter] = useState<string>("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [pendingMove, setPendingMove] = useState<{ id: string; client: string; fromStage: string; fromLabel: string; toStage: string; toLabel: string } | null>(null);
  const [reasonText, setReasonText] = useState("");
  const isMobile = useIsMobile();

  // Mobile: load ONLY the active stage. Desktop: load all (capped 500).
  const { data: leads, isLoading } = useQuery({
    queryKey: ["pipeline-leads", isMobile ? activeStage : "all"],
    queryFn: async () => {
      let q = supabase
        .from("leads")
        .select("id, lead_code, client_name, company_name, email, stage, interest, next_follow_up_at, last_activity_at, created_at")
        .order("last_activity_at", { ascending: false });
      if (isMobile) q = q.eq("stage", activeStage as never).limit(200);
      else q = q.limit(500);
      const { data } = await q;
      return (data ?? []) as Lead[];
    },
    staleTime: 30_000,
  });

  // Apply text + interest + overdue filters
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const now = Date.now();
    return (leads ?? []).filter((l) => {
      if (interestFilter !== "all" && l.interest !== interestFilter) return false;
      if (overdueOnly) {
        const due = l.next_follow_up_at ? new Date(l.next_follow_up_at).getTime() : null;
        if (!due || due >= now) return false;
      }
      if (!term) return true;
      return (
        l.client_name.toLowerCase().includes(term) ||
        (l.company_name ?? "").toLowerCase().includes(term) ||
        l.lead_code.toLowerCase().includes(term)
      );
    });
  }, [leads, search, interestFilter, overdueOnly]);

  const buckets = useMemo(() => {
    const map = new Map<string, Lead[]>();
    STAGES.forEach((s) => map.set(s.id, []));
    filtered.forEach((l) => map.get(l.stage)?.push(l));
    return map;
  }, [filtered]);

  const move = useMutation({
    mutationFn: async ({ id, stage, reason }: { id: string; stage: string; reason?: string }) => {
      const patch: Record<string, unknown> = { stage };
      if (reason !== undefined) patch.lost_reason = reason;
      const { error } = await supabase.from("leads").update(patch as never).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: ["pipeline-leads"] });
      const snapshots = qc.getQueriesData<Lead[]>({ queryKey: ["pipeline-leads"] });
      qc.setQueriesData<Lead[]>({ queryKey: ["pipeline-leads"] }, (old) =>
        (old ?? []).map((l) => (l.id === id ? { ...l, stage } : l)),
      );
      return { snapshots };
    },
    onError: (e: Error, _v, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(e.message);
    },
  });

  // Live updates from realtime channel
  useEffect(() => {
    const ch = supabase
      .channel("pipeline-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => {
        qc.invalidateQueries({ queryKey: ["pipeline-leads"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  usePagePerf("Pipeline", isLoading);

  const undoMove = (id: string, fromStage: string, fromLabel: string) => {
    move.mutate({ id, stage: fromStage });
    toast.success(`Moved back to ${fromLabel}`);
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const id = String(e.active.id);
    const toStage = String(e.over.id);
    const lead = (leads ?? []).find((l) => l.id === id);
    if (!lead || lead.stage === toStage) return;
    const fromStage = lead.stage;
    const fromLabel = STAGES.find((s) => s.id === fromStage)?.label ?? fromStage;
    const toLabel = STAGES.find((s) => s.id === toStage)?.label ?? toStage;

    const notify = () =>
      toast.success(`Moved to ${toLabel}`, {
        action: { label: "Undo", onClick: () => undoMove(id, fromStage, fromLabel) },
        duration: 8000,
      });

    // Lost / Not interested require a mandatory reason — open a styled dialog.
    if (toStage === "lost" || toStage === "not_interested") {
      setReasonText("");
      setPendingMove({ id, client: lead.client_name, fromStage, fromLabel, toStage, toLabel });
      return;
    }

    move.mutate({ id, stage: toStage }, {
      onSuccess: () => {
        notify();
        if (user) {
          const lead2 = (leads ?? []).find((l) => l.id === id);
          triggerStageReminder({ leadId: id, newStage: toStage, clientName: lead2?.client_name ?? "", clientEmail: lead2?.email, userId: user.id });
        }
      },
    });
  };

  const confirmReasonMove = () => {
    if (!pendingMove || !reasonText.trim()) return;
    const { id, fromStage, fromLabel, toStage, toLabel } = pendingMove;
    move.mutate(
      { id, stage: toStage, reason: reasonText.trim() },
      {
        onSuccess: () => {
          toast.success(`Moved to ${toLabel}`, {
            action: { label: "Undo", onClick: () => undoMove(id, fromStage, fromLabel) },
            duration: 8000,
          });
          if (user) {
            const lead2 = (leads ?? []).find((l) => l.id === id);
            triggerStageReminder({ leadId: id, newStage: toStage, clientName: lead2?.client_name ?? "", clientEmail: lead2?.email, userId: user.id });
          }
        },
      },
    );
    setPendingMove(null);
  };

  const activeIdx = STAGES.findIndex((s) => s.id === activeStage);
  const goPrev = () => setActiveStage(STAGES[Math.max(0, activeIdx - 1)].id);
  const goNext = () => setActiveStage(STAGES[Math.min(STAGES.length - 1, activeIdx + 1)].id);

  const Filters = (
    <div className="flex flex-wrap gap-2">
      <div className="relative flex-1 min-w-48">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9 pr-9"
          placeholder="Search name, company, code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <Select value={interestFilter} onValueChange={setInterestFilter}>
        <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All interests</SelectItem>
          {INTERESTS.map((i) => (
            <SelectItem key={i.id} value={i.id}>{i.emoji} {i.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant={overdueOnly ? "default" : "outline"}
        onClick={() => setOverdueOnly((v) => !v)}
        size="default"
      >
        Overdue only
      </Button>
    </div>
  );

  return (
    <div className="p-4 md:p-8 space-y-4 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Pipeline</h1>
        <p className="text-sm text-muted-foreground">
          {filtered.length} of {leads?.length ?? 0} leads · drag cards across stages on desktop.
        </p>
      </div>

      {Filters}

      {isLoading && !leads && (
        <PipelineSkeleton mobile={isMobile} />
      )}

      {/* Mobile / tablet: single stage view, only that stage was queried */}
      <div className="lg:hidden space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={goPrev} disabled={activeIdx === 0}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Select value={activeStage} onValueChange={setActiveStage}>
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAGES.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={goNext} disabled={activeIdx === STAGES.length - 1}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <VirtualList items={filtered} height={Math.max(window.innerHeight - 320, 320)} draggable={false} />
      </div>

      {/* Desktop: full Kanban with virtualized columns */}
      <div className="hidden lg:block">
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {STAGES.map((s) => (
              <StageColumn key={s.id} stage={s} items={buckets.get(s.id) ?? []} />
            ))}
          </div>
        </DndContext>
      </div>

      <Dialog open={!!pendingMove} onOpenChange={(o) => { if (!o) setPendingMove(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reason required</DialogTitle>
            <DialogDescription>
              Please note why <span className="font-medium text-foreground">{pendingMove?.client}</span> is marked{" "}
              <span className="font-medium text-foreground">{pendingMove?.toLabel}</span>. This is mandatory.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            rows={3}
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            placeholder="e.g. Chose a competitor · budget too high · no response…"
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") confirmReasonMove(); }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingMove(null)}>Cancel</Button>
            <Button disabled={!reasonText.trim() || move.isPending} onClick={confirmReasonMove}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const COLUMN_HEIGHT = 640;
const CARD_HEIGHT = 92;

const StageColumn = memo(function StageColumn({
  stage, items,
}: { stage: typeof STAGES[number]; items: Lead[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div
      ref={setNodeRef}
      className={`w-72 shrink-0 rounded-xl border bg-card/50 p-2 transition-colors ${isOver ? "ring-2 ring-primary" : ""}`}
    >
      <div className="flex items-center justify-between px-2 py-2">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${stage.color}`} />
          <div className="text-sm font-medium">{stage.label}</div>
        </div>
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </div>
      <VirtualList items={items} height={COLUMN_HEIGHT} draggable />
    </div>
  );
});

function VirtualList({ items, height, draggable }: { items: Lead[]; height: number; draggable: boolean }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD_HEIGHT,
    overscan: 6,
  });

  if (items.length === 0) {
    return (
      <div className="text-xs text-muted-foreground text-center py-12 border border-dashed rounded-md">
        No leads here.
      </div>
    );
  }

  return (
    <div ref={parentRef} style={{ height, overflow: "auto" }} className="pr-1">
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((vi) => {
          const lead = items[vi.index];
          return (
            <div
              key={lead.id}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${vi.start}px)`,
                paddingBottom: 8,
              }}
            >
              {draggable ? <DraggableLeadCard lead={lead} /> : <StaticLeadCard lead={lead} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const DraggableLeadCard = memo(function DraggableLeadCard({ lead }: { lead: Lead }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ transform: transform ? `translate3d(${transform.x}px,${transform.y}px,0)` : undefined }}
      className={`rounded-lg bg-card border p-3 shadow-sm cursor-grab active:cursor-grabbing ${isDragging ? "opacity-50" : ""}`}
    >
      <LeadCardBody lead={lead} />
    </div>
  );
});

function StaticLeadCard({ lead }: { lead: Lead }) {
  return (
    <div className="rounded-lg bg-card border p-3 shadow-sm">
      <LeadCardBody lead={lead} />
    </div>
  );
}

function LeadCardBody({ lead }: { lead: Lead }) {
  const interest = INTERESTS.find((i) => i.id === lead.interest);
  const overdue = lead.next_follow_up_at && new Date(lead.next_follow_up_at) < new Date();
  const ref = lead.last_activity_at ?? lead.created_at;
  const daysInStage = ref ? Math.max(0, Math.floor((Date.now() - new Date(ref).getTime()) / 86400000)) : null;
  return (
    <>
      <Link to="/leads/$id" params={{ id: lead.id }} className="text-sm font-medium hover:underline block truncate">
        {lead.client_name}
      </Link>
      <div className="text-xs text-muted-foreground truncate mt-0.5">
        {lead.company_name ?? lead.lead_code}
      </div>
      <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
        {interest && <Badge variant="secondary" className={`text-[10px] ${interest.className}`}>{interest.emoji} {interest.label}</Badge>}
        {daysInStage !== null && (
          <span className={`text-[10px] ${daysInStage > 7 ? "text-amber-600" : "text-muted-foreground"}`}>
            {daysInStage}d in stage
          </span>
        )}
        {overdue && <span className="text-[10px] text-destructive font-medium">Overdue</span>}
      </div>
    </>
  );
}
