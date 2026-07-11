import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INTERESTS, SERVICES, STAGES, labelFor } from "@/lib/crm";
import { Plus, Search, Phone, Mail, Upload, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { NewLeadDialog } from "@/components/new-lead-dialog";
import { formatDistanceToNow } from "date-fns";

type LeadSearch = {
  stage?: string;
  interest?: string;
  service?: string;
  owner?: string;
  q?: string;
  page?: number;
  size?: number;
};

const PAGE_SIZES = [25, 50, 100, 200];

export const Route = createFileRoute("/_authenticated/leads/")({
  head: () => ({ meta: [{ title: "Leads — EaseMyOffice CRM" }] }),
  validateSearch: (s: Record<string, unknown>): LeadSearch => ({
    stage: typeof s.stage === "string" ? s.stage : undefined,
    interest: typeof s.interest === "string" ? s.interest : undefined,
    service: typeof s.service === "string" ? s.service : undefined,
    owner: typeof s.owner === "string" ? s.owner : undefined,
    q: typeof s.q === "string" ? s.q : undefined,
    page: (() => { const n = Number(s.page); return Number.isFinite(n) && n > 1 ? Math.floor(n) : undefined; })(),
    size: (() => { const n = Number(s.size); return PAGE_SIZES.includes(n) ? n : undefined; })(),
  }),
  component: LeadsListPage,
});

function LeadsListPage() {
  const [open, setOpen] = useState(false);
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [q, setQ] = useState(search.q ?? "");
  const stage = search.stage ?? "all";
  const interest = search.interest ?? "all";
  const service = search.service ?? "all";
  const owner = search.owner;
  const page = search.page ?? 1;
  const size = search.size ?? 50;

  // Any change to a filter/search resets back to page 1 so results stay in view.
  const setStage = (v: string) =>
    navigate({ to: "/leads", search: { ...search, stage: v === "all" ? undefined : v, page: undefined } });
  const setInterest = (v: string) =>
    navigate({ to: "/leads", search: { ...search, interest: v === "all" ? undefined : v, page: undefined } });
  const setService = (v: string) =>
    navigate({ to: "/leads", search: { ...search, service: v === "all" ? undefined : v, page: undefined } });
  const setPage = (p: number) =>
    navigate({ to: "/leads", search: { ...search, page: p <= 1 ? undefined : p } });
  const setSize = (v: string) =>
    navigate({ to: "/leads", search: { ...search, size: Number(v) === 50 ? undefined : Number(v), page: undefined } });
  const onSearchChange = (v: string) => {
    setQ(v);
    if (page !== 1) navigate({ to: "/leads", search: { ...search, page: undefined } });
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["leads", q, stage, interest, service, owner, page, size],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const from = (page - 1) * size;
      const to = from + size - 1;
      let query = supabase.from("leads")
        .select("id, lead_code, client_name, company_name, mobile, email, stage, interest, service_required, source, score, assigned_to, next_follow_up_at, last_activity_at, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (stage !== "all") query = query.eq("stage", stage as never);
      if (interest !== "all") query = query.eq("interest", interest as never);
      if (service !== "all") query = query.eq("service_required", service as never);
      if (owner) query = query.eq("assigned_to", owner);
      if (q.trim()) {
        const term = `%${q.trim()}%`;
        query = query.or(`client_name.ilike.${term},mobile.ilike.${term},company_name.ilike.${term},lead_code.ilike.${term},email.ilike.${term}`);
      }
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });

  const rows = data?.rows ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const firstShown = total === 0 ? 0 : (page - 1) * size + 1;
  const lastShown = Math.min(page * size, total);

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Leads</h1>
          <p className="text-sm text-muted-foreground">
            All your prospects in one place.{total > 0 && <> · <span className="font-medium text-foreground">{total.toLocaleString("en-IN")}</span> total</>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/leads/import"><Upload className="h-4 w-4 mr-2" /> Import</Link>
          </Button>
          <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-2" /> New Lead</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-56">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search name, mobile, company, code…" value={q} onChange={(e) => onSearchChange(e.target.value)} />
          </div>
          <Select value={stage} onValueChange={setStage}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Stage" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              {STAGES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={interest} onValueChange={setInterest}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Interest" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All interests</SelectItem>
              {INTERESTS.map((s) => <SelectItem key={s.id} value={s.id}>{s.emoji} {s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={service} onValueChange={setService}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Service" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All services</SelectItem>
              {SERVICES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center">
              <div className="text-muted-foreground mb-4">No leads match your filters.</div>
              <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-2" /> Add a lead</Button>
            </div>
          ) : (
            <div className={isFetching ? "opacity-60 transition-opacity" : "transition-opacity"}>
              {rows.map((l) => <LeadRow key={l.id} l={l} />)}
            </div>
          )}
        </CardContent>
      </Card>

      {total > 0 && (
        <PaginationBar
          page={page}
          totalPages={totalPages}
          size={size}
          firstShown={firstShown}
          lastShown={lastShown}
          total={total}
          onPage={setPage}
          onSize={setSize}
        />
      )}

      <NewLeadDialog open={open} onOpenChange={setOpen} onCreated={(id) => navigate({ to: "/leads/$id", params: { id } })} />
    </div>
  );
}

function LeadRow({ l }: { l: any }) {
  const interestMeta = INTERESTS.find((i) => i.id === l.interest);
  const stageMeta = STAGES.find((s) => s.id === l.stage);
  const overdue = l.next_follow_up_at && new Date(l.next_follow_up_at) < new Date();
  return (
    <div className="border-b last:border-b-0">
      <Link
        to="/leads/$id"
        params={{ id: l.id }}
        className="grid grid-cols-12 gap-3 items-center px-4 py-3 hover:bg-accent/40"
      >
        <div className="col-span-12 md:col-span-4 min-w-0">
          <div className="flex items-center gap-2">
            <div className="font-medium truncate">{l.client_name}</div>
            {interestMeta && (
              <Badge variant="secondary" className={interestMeta.className}>
                {interestMeta.emoji} {interestMeta.label}
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {l.lead_code} · {l.company_name ?? "—"}
          </div>
        </div>
        <div className="col-span-6 md:col-span-2 text-sm">
          <div className="flex items-center gap-1 text-muted-foreground"><Phone className="h-3 w-3" />{l.mobile}</div>
          {l.email && <div className="flex items-center gap-1 text-xs text-muted-foreground truncate"><Mail className="h-3 w-3" />{l.email}</div>}
        </div>
        <div className="col-span-6 md:col-span-2 text-xs text-muted-foreground truncate">
          {labelFor(SERVICES, l.service_required)}
        </div>
        <div className="col-span-6 md:col-span-2">
          {stageMeta && (
            <span className="inline-flex items-center gap-1.5 text-xs">
              <span className={`h-2 w-2 rounded-full ${stageMeta.color}`} />
              {stageMeta.label}
            </span>
          )}
        </div>
        <div className="col-span-6 md:col-span-2 text-right text-xs">
          {l.next_follow_up_at ? (
            <span className={overdue ? "text-destructive font-medium" : "text-muted-foreground"}>
              {overdue ? "Overdue " : ""}{formatDistanceToNow(new Date(l.next_follow_up_at), { addSuffix: true })}
            </span>
          ) : (
            <span className="text-amber-600">No follow-up</span>
          )}
        </div>
      </Link>
    </div>
  );
}

function PaginationBar({
  page, totalPages, size, firstShown, lastShown, total, onPage, onSize,
}: {
  page: number; totalPages: number; size: number; firstShown: number; lastShown: number; total: number;
  onPage: (p: number) => void; onSize: (v: string) => void;
}) {
  const [jump, setJump] = useState("");
  const pages = pageWindow(page, totalPages);
  const go = () => {
    const n = Number(jump);
    if (Number.isFinite(n) && n >= 1 && n <= totalPages) onPage(n);
    setJump("");
  };
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>Showing <span className="font-medium text-foreground">{firstShown.toLocaleString("en-IN")}</span>–<span className="font-medium text-foreground">{lastShown.toLocaleString("en-IN")}</span> of <span className="font-medium text-foreground">{total.toLocaleString("en-IN")}</span></span>
        <div className="flex items-center gap-1.5">
          <span>Per page</span>
          <Select value={String(size)} onValueChange={onSize}>
            <SelectTrigger className="h-8 w-[74px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((s) => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => onPage(1)} title="First page"><ChevronsLeft className="h-4 w-4" /></Button>
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => onPage(page - 1)} title="Previous page"><ChevronLeft className="h-4 w-4" /></Button>

        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="px-1.5 text-muted-foreground">…</span>
          ) : (
            <Button
              key={p}
              variant={p === page ? "default" : "outline"}
              size="icon"
              className="h-8 w-8"
              onClick={() => onPage(p as number)}
            >
              {p}
            </Button>
          )
        )}

        <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => onPage(page + 1)} title="Next page"><ChevronRight className="h-4 w-4" /></Button>
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => onPage(totalPages)} title="Last page"><ChevronsRight className="h-4 w-4" /></Button>

        {totalPages > 5 && (
          <div className="flex items-center gap-1 ml-2">
            <Input
              className="h-8 w-16"
              placeholder="Go to"
              value={jump}
              onChange={(e) => setJump(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter") go(); }}
            />
            <Button variant="outline" size="sm" className="h-8" onClick={go}>Go</Button>
          </div>
        )}
      </div>
    </div>
  );
}

// Build a compact page list like: 1 … 4 5 [6] 7 8 … 20
function pageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push("…");
  for (let p = start; p <= end; p++) out.push(p);
  if (end < total - 1) out.push("…");
  out.push(total);
  return out;
}
