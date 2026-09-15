import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import {
  DndContext, useDraggable, useDroppable, type DragEndEvent,
  PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { memo, useMemo, useRef, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Search, X, Phone, MessageCircle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useVirtualizer } from "@tanstack/react-virtual";
import { differenceInDays } from "date-fns";

export const Route = createFileRoute("/_authenticated/renewals/pipeline")({
  head: () => ({ meta: [{ title: "Renewal Pipeline — EaseMyOffice CRM" }] }),
  component: RenewalPipelinePage,
});

// Renewal stages (bookings.renewal_status). Mirrors the sales pipeline's STAGES
// shape ({id,label,color-dot}) so the same Kanban machinery applies. "cancelled"
// and "lost" are terminal and require a reason on move (like sales lost/not_interested).
const STAGES = [
  { id: "pending", label: "New Renewal", color: "bg-slate-500" },
  { id: "contacted", label: "Contacted", color: "bg-blue-500" },
  { id: "following_up", label: "Following Up", color: "bg-violet-500" },
  { id: "not_responding", label: "Not Responding", color: "bg-amber-500" },
  { id: "pending_payment", label: "Pending Payment", color: "bg-cyan-500" },
  { id: "renewed", label: "Renewed", color: "bg-emerald-600" },
  { id: "not_interested", label: "Not Interested", color: "bg-zinc-500" },
  { id: "cancelled", label: "Cancelled", color: "bg-rose-500" },
] as const;

const TERMINAL = new Set(["cancelled", "lost", "not_interested"]);

type Booking = {
  id: string;
  booking_code: string | null;
  external_booking_id: string | null;
  client_name: string;
  business_name: string | null;
  contact_no: string | null;
  email_id: string | null;
  plan_name: string | null;
  plan_expiry_date: string | null;
  renewal_status: string;
  renewal_assigned_to: string | null;
  total_amount: number | null;
};

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 1024 : false,
  );
  useMemo(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isMobile;
};

// Assignee-name lookup, provided to cards via a module-level ref set each render
// (kept out of props so memoized cards don't re-render on unrelated changes).
let NAME_BY_ID = new Map<string, string>();

function RenewalPipelinePage() {
  const qc = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [activeStage, setActiveStage] = useState<string>(STAGES[0].id);
  const [search, setSearch] = useState("");
  const [pendingMove, setPendingMove] = useState<{ id: string; client: string; fromStage: string; fromLabel: string; toStage: string; toLabel: string } | null>(null);
  const [reasonText, setReasonText] = useState("");
  const isMobile = useIsMobile();

  const { data: bookings, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["renewal-pipeline", isMobile ? activeStage : "all"],
    staleTime: 30_000,
    structuralSharing: true,
    queryFn: async () => {
      let q = supabase.from("bookings")
        .select("id, booking_code, external_booking_id, client_name, business_name, contact_no, email_id, plan_name, plan_expiry_date, renewal_status, renewal_assigned_to, total_amount")
        .not("plan_expiry_date", "is", null)
        .order("plan_expiry_date", { ascending: true });
      if (isMobile) q = q.eq("renewal_status", activeStage as never).limit(300);
      else q = q.limit(2000);
      const { data } = await q;
      return (data ?? []) as Booking[];
    },
  });

  const { data: team = [] } = useQuery({
    queryKey: ["renewal-team"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").order("full_name");
      return (data ?? []) as { id: string; full_name: string | null; email: string | null }[];
    },
  });
  NAME_BY_ID = useMemo(() => {
    const m = new Map<string, string>();
    team.forEach((u) => m.set(u.id, u.full_name || u.email || ""));
    return m;
  }, [team]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return bookings ?? [];
    return (bookings ?? []).filter((b) =>
      b.client_name.toLowerCase().includes(term) ||
      (b.business_name ?? "").toLowerCase().includes(term) ||
      (b.contact_no ?? "").toLowerCase().includes(term) ||
      (b.plan_name ?? "").toLowerCase().includes(term) ||
      (b.external_booking_id ?? b.booking_code ?? "").toLowerCase().includes(term),
    );
  }, [bookings, search]);

  const buckets = useMemo(() => {
    const map = new Map<string, Booking[]>();
    STAGES.forEach((s) => map.set(s.id, []));
    filtered.forEach((b) => { if (map.has(b.renewal_status)) map.get(b.renewal_status)!.push(b); });
    return map;
  }, [filtered]);

  const EMPTY: Booking[] = useMemo(() => [], []);

  const move = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string; reason?: string }) => {
      const { error } = await supabase.from("bookings").update({
        renewal_status: status,
        renewal_stage_changed_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["renewal-pipeline"] });
      const snapshots = qc.getQueriesData<Booking[]>({ queryKey: ["renewal-pipeline"] });
      qc.setQueriesData<Booking[]>({ queryKey: ["renewal-pipeline"] }, (old) =>
        (old ?? []).map((b) => (b.id === id ? { ...b, renewal_status: status } : b)),
      );
      return { snapshots };
    },
    onError: (e: Error, _v, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(e.message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["renewal-pipeline"] });
      qc.invalidateQueries({ queryKey: ["renewal-bookings-list"] });
    },
  });

  const undoMove = (id: string, fromStage: string, fromLabel: string) => {
    move.mutate({ id, status: fromStage });
    toast.success(`Moved back to ${fromLabel}`);
  };

  const doMove = (id: string, toStage: string, reason?: string) => {
    const fromStage = (bookings ?? []).find((b) => b.id === id)?.renewal_status ?? "";
    const fromLabel = STAGES.find((s) => s.id === fromStage)?.label ?? fromStage;
    const toLabel = STAGES.find((s) => s.id === toStage)?.label ?? toStage;
    move.mutate({ id, status: toStage, reason }, {
      onSuccess: () =>
        toast.success(`Moved to ${toLabel}`, {
          action: { label: "Undo", onClick: () => undoMove(id, fromStage, fromLabel) },
          duration: 8000,
        }),
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const id = String(e.active.id);
    const toStage = String(e.over.id);
    const b = (bookings ?? []).find((x) => x.id === id);
    if (!b || b.renewal_status === toStage) return;
    if (TERMINAL.has(toStage)) {
      const fromStage = b.renewal_status;
      const fromLabel = STAGES.find((s) => s.id === fromStage)?.label ?? fromStage;
      const toLabel = STAGES.find((s) => s.id === toStage)?.label ?? toStage;
      setReasonText("");
      setPendingMove({ id, client: b.client_name, fromStage, fromLabel, toStage, toLabel });
      return;
    }
    doMove(id, toStage);
  };

  const confirmReasonMove = () => {
    if (!pendingMove || !reasonText.trim()) return;
    doMove(pendingMove.id, pendingMove.toStage, reasonText.trim());
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
          className="pl-9 pr-9 focus:ring-2 ring-primary/20"
          placeholder="Search client, plan, phone, booking…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <Button variant="outline" size="default" onClick={() => refetch()} disabled={isFetching}>
        <RefreshCcw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
      </Button>
    </div>
  );

  return (
    <div className="p-5 md:p-10 space-y-4 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Renewal Pipeline</h1>
        <p className="text-sm text-muted-foreground">
          {filtered.length} of {bookings?.length ?? 0} renewals · drag cards across stages on desktop.
        </p>
      </div>

      {Filters}

      {isLoading && !bookings && (
        <div className="p-12 text-center text-muted-foreground">Loading pipeline…</div>
      )}

      {/* Mobile / tablet: single stage view */}
      <div className="lg:hidden space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={goPrev} disabled={activeIdx === 0}><ChevronLeft className="h-4 w-4" /></Button>
          <Select value={activeStage} onValueChange={setActiveStage}>
            <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>{STAGES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={goNext} disabled={activeIdx === STAGES.length - 1}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <VirtualList items={filtered} height={Math.max((typeof window !== "undefined" ? window.innerHeight : 800) - 320, 320)} draggable={false} onMove={doMove} currentStage={activeStage} />
      </div>

      {/* Desktop: full Kanban with drag-and-drop */}
      <div className="hidden lg:block">
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {STAGES.map((s) => (
              <StageColumn key={s.id} stage={s} items={buckets.get(s.id) ?? EMPTY} onMove={doMove} />
            ))}
          </div>
        </DndContext>
      </div>

      {/* Reason dialog for terminal moves (Cancelled / Not Interested) */}
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
            autoFocus rows={3} value={reasonText} onChange={(e) => setReasonText(e.target.value)}
            placeholder="e.g. Moved to another provider · shut down · no response…"
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
const CARD_HEIGHT = 116;

type MoveFn = (id: string, toStage: string) => void;

const StageColumn = memo(function StageColumn({
  stage, items, onMove,
}: { stage: typeof STAGES[number]; items: Booking[]; onMove: MoveFn }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div
      ref={setNodeRef}
      className={`w-72 shrink-0 rounded-xl border bg-card/50 p-2 shadow-sm transition-colors ${isOver ? "ring-2 ring-primary" : ""}`}
    >
      <div className="flex items-center justify-between px-2 py-2">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${stage.color}`} />
          <div className="text-sm font-medium">{stage.label}</div>
        </div>
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </div>
      <VirtualList items={items} height={COLUMN_HEIGHT} draggable onMove={onMove} currentStage={stage.id} />
    </div>
  );
});

const VirtualList = memo(function VirtualList({
  items, height, draggable, onMove, currentStage,
}: { items: Booking[]; height: number; draggable: boolean; onMove: MoveFn; currentStage: string }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD_HEIGHT,
    overscan: 6,
  });

  if (items.length === 0) {
    return <div className="text-xs text-muted-foreground text-center py-12 border border-dashed rounded-md">No renewals here.</div>;
  }

  return (
    <div ref={parentRef} style={{ height, overflow: "auto" }} className="pr-1">
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((vi) => {
          const b = items[vi.index];
          return (
            <div key={b.id} style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)`, paddingBottom: 8 }}>
              {draggable
                ? <DraggableCard b={b} onMove={onMove} currentStage={currentStage} />
                : <StaticCard b={b} onMove={onMove} currentStage={currentStage} />}
            </div>
          );
        })}
      </div>
    </div>
  );
});

const DraggableCard = memo(function DraggableCard({ b, onMove, currentStage }: { b: Booking; onMove: MoveFn; currentStage: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: b.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ transform: transform ? `translate3d(${transform.x}px,${transform.y}px,0)` : undefined }}
      className={`rounded-xl bg-card border p-3 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md hover:scale-[1.01] transition-all duration-200 ease-out ${isDragging ? "opacity-50" : ""}`}
    >
      <CardBody b={b} onMove={onMove} currentStage={currentStage} />
    </div>
  );
});

const StaticCard = memo(function StaticCard({ b, onMove, currentStage }: { b: Booking; onMove: MoveFn; currentStage: string }) {
  return (
    <div className="rounded-xl bg-card border p-3 shadow-sm hover:shadow-md transition-all duration-200 ease-out">
      <CardBody b={b} onMove={onMove} currentStage={currentStage} />
    </div>
  );
});

const CardBody = memo(function CardBody({ b, onMove, currentStage }: { b: Booking; onMove: MoveFn; currentStage: string }) {
  const daysLeft = b.plan_expiry_date ? differenceInDays(new Date(b.plan_expiry_date), new Date()) : null;
  const expired = daysLeft !== null && daysLeft < 0;
  const assignee = b.renewal_assigned_to ? NAME_BY_ID.get(b.renewal_assigned_to) : null;
  const digits = (b.contact_no ?? "").replace(/\D/g, "");
  const stop = (e: React.SyntheticEvent) => { e.preventDefault(); e.stopPropagation(); };

  return (
    <>
      <div className="text-sm font-medium truncate">{b.client_name}</div>
      <div className="text-xs text-muted-foreground truncate mt-0.5">{b.business_name || b.plan_name || b.external_booking_id || b.booking_code}</div>

      {b.contact_no && (
        <div className="flex items-center gap-2 mt-1.5">
          <a href={`tel:${b.contact_no}`} onClick={stop} onPointerDown={stop}
             className="text-[11px] text-primary inline-flex items-center gap-1 hover:underline">
            <Phone className="h-3 w-3" /> {b.contact_no}
          </a>
          {digits && (
            <a href={`https://wa.me/${digits.length === 10 ? "91" + digits : digits}`} target="_blank" rel="noreferrer"
               onClick={stop} onPointerDown={stop}
               className="text-[11px] text-emerald-600 inline-flex items-center gap-1 hover:underline">
              <MessageCircle className="h-3 w-3" /> WhatsApp
            </a>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
        {daysLeft !== null && (
          <span className={`text-[11px] font-medium ${expired ? "text-destructive" : daysLeft <= 7 ? "text-amber-600" : "text-muted-foreground"}`}>
            {expired ? `Expired ${Math.abs(daysLeft)}d ago` : `${daysLeft}d left`}
          </span>
        )}
        {assignee && <Badge variant="secondary" className="text-[10px] rounded-full">{assignee}</Badge>}
      </div>

      {/* Full stage picker (any stage), in addition to drag-and-drop. */}
      <div className="mt-2" onClick={stop} onPointerDown={stop}>
        <Select value={currentStage} onValueChange={(v) => { if (v !== currentStage) onMove(b.id, v); }}>
          <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STAGES.map((s) => (
              <SelectItem key={s.id} value={s.id} className="text-xs">
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.color} mr-1.5 align-middle`} />{s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
});
