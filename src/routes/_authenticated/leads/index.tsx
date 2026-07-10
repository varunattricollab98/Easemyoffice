import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INTERESTS, SERVICES, STAGES, labelFor } from "@/lib/crm";
import { Plus, Search, Phone, Mail } from "lucide-react";
import { NewLeadDialog } from "@/components/new-lead-dialog";
import { formatDistanceToNow } from "date-fns";

type LeadSearch = {
  stage?: string;
  interest?: string;
  service?: string;
  owner?: string;
  q?: string;
};

export const Route = createFileRoute("/_authenticated/leads/")({
  head: () => ({ meta: [{ title: "Leads — EaseMyOffice CRM" }] }),
  validateSearch: (s: Record<string, unknown>): LeadSearch => ({
    stage: typeof s.stage === "string" ? s.stage : undefined,
    interest: typeof s.interest === "string" ? s.interest : undefined,
    service: typeof s.service === "string" ? s.service : undefined,
    owner: typeof s.owner === "string" ? s.owner : undefined,
    q: typeof s.q === "string" ? s.q : undefined,
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

  const setStage = (v: string) =>
    navigate({ to: "/leads", search: { ...search, stage: v === "all" ? undefined : v } });
  const setInterest = (v: string) =>
    navigate({ to: "/leads", search: { ...search, interest: v === "all" ? undefined : v } });

  const { data: leads, isLoading } = useQuery({
    queryKey: ["leads", q, stage, interest, service, owner],
    queryFn: async () => {
      let query = supabase.from("leads")
        .select("id, lead_code, client_name, company_name, mobile, email, stage, interest, service_required, source, score, assigned_to, next_follow_up_at, last_activity_at, created_at")
        .order("created_at", { ascending: false }).limit(200);
      if (stage !== "all") query = query.eq("stage", stage as never);
      if (interest !== "all") query = query.eq("interest", interest as never);
      if (service !== "all") query = query.eq("service_required", service as never);
      if (owner) query = query.eq("assigned_to", owner);
      if (q.trim()) {
        const term = `%${q.trim()}%`;
        query = query.or(`client_name.ilike.${term},mobile.ilike.${term},company_name.ilike.${term},lead_code.ilike.${term},email.ilike.${term}`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Leads</h1>
          <p className="text-sm text-muted-foreground">All your prospects in one place.</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-2" /> New Lead</Button>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-56">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search name, mobile, company, code…" value={q} onChange={(e) => setQ(e.target.value)} />
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
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
          ) : leads?.length === 0 ? (
            <div className="p-12 text-center">
              <div className="text-muted-foreground mb-4">No leads yet.</div>
              <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-2" /> Add your first lead</Button>
            </div>
          ) : (
            <VirtualLeadList rows={leads ?? []} />
          )}
        </CardContent>
      </Card>

      <NewLeadDialog open={open} onOpenChange={setOpen} onCreated={(id) => navigate({ to: "/leads/$id", params: { id } })} />
    </div>
  );
}

function VirtualLeadList({ rows }: { rows: any[] }) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virt = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => 76,
    overscan: 8,
    scrollMargin: parentRef.current?.offsetTop ?? 0,
  });
  const items = virt.getVirtualItems();
  return (
    <div ref={parentRef}>
      <div
        className="relative w-full"
        style={{ height: virt.getTotalSize() }}
      >
        {items.map((vi) => {
          const l = rows[vi.index];
          const interestMeta = INTERESTS.find((i) => i.id === l.interest);
          const stageMeta = STAGES.find((s) => s.id === l.stage);
          const overdue = l.next_follow_up_at && new Date(l.next_follow_up_at) < new Date();
          return (
            <div
              key={l.id}
              ref={virt.measureElement}
              data-index={vi.index}
              className="absolute left-0 right-0 border-b"
              style={{ transform: `translateY(${vi.start - virt.options.scrollMargin}px)` }}
            >
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
        })}
      </div>
    </div>
  );
}
