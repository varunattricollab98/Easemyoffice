import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, RefreshCcw, AlertTriangle } from "lucide-react";
import { useRef, useState, useMemo } from "react";
import { format, differenceInDays } from "date-fns";

export const Route = createFileRoute("/_authenticated/renewals")({
  head: () => ({ meta: [{ title: "Renewals — EaseMyOffice CRM" }] }),
  component: RenewalsPage,
});

function RenewalsPage() {
  const [search, setSearch] = useState("");

  const { data: leads = [] } = useQuery({
    queryKey: ["renewals-leads"],
    queryFn: async () => {
      const { data } = await supabase.from("leads")
        .select("id, lead_code, client_name, company_name, stage, service_required, next_follow_up_at, mobile, email")
        .in("stage", ["renewal_due", "completed", "agreement_signed"] as never)
        .order("next_follow_up_at", { ascending: true, nullsFirst: false }).limit(500);
      return data ?? [];
    },
  });

  const buckets = useMemo(() => {
    const now = new Date();
    const t = search.trim().toLowerCase();
    const items = leads.filter((l: any) => {
      if (!t) return true;
      return [l.client_name, l.company_name, l.lead_code].some((v: string) => (v ?? "").toLowerCase().includes(t));
    });
    const groups = { overdue: [] as any[], next7: [] as any[], next30: [] as any[], later: [] as any[] };
    items.forEach((l: any) => {
      if (!l.next_follow_up_at) { groups.later.push(l); return; }
      const days = differenceInDays(new Date(l.next_follow_up_at), now);
      if (days < 0) groups.overdue.push(l);
      else if (days <= 7) groups.next7.push(l);
      else if (days <= 30) groups.next30.push(l);
      else groups.later.push(l);
    });
    return groups;
  }, [leads, search]);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Renewals</h1>
        <p className="text-sm text-muted-foreground">Track upcoming renewals and expired clients.</p>
      </div>

      <div className="relative max-w-md">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search renewals…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <RenewalGroup title="Overdue" items={buckets.overdue} icon={AlertTriangle} tone="rose" />
      <RenewalGroup title="Due in 7 days" items={buckets.next7} icon={RefreshCcw} tone="amber" />
      <RenewalGroup title="Due in 30 days" items={buckets.next30} icon={RefreshCcw} tone="blue" />
      <RenewalGroup title="Later / unscheduled" items={buckets.later} icon={RefreshCcw} tone="slate" />
    </div>
  );
}

function RenewalGroup({ title, items, icon: Icon, tone }: { title: string; items: any[]; icon: any; tone: string }) {
  const tones: Record<string, string> = {
    rose: "text-rose-600", amber: "text-amber-600", blue: "text-blue-600", slate: "text-muted-foreground",
  };
  return (
    <Card>
      <CardContent className="p-0">
        <div className="p-3 border-b flex items-center gap-2">
          <Icon className={`h-4 w-4 ${tones[tone]}`} />
          <div className="font-medium">{title}</div>
          <Badge variant="secondary">{items.length}</Badge>
        </div>
        {items.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Nothing here.</div>
        ) : items.length <= 25 ? (
          <div className="divide-y">
            {items.map((l) => <RenewalRow key={l.id} l={l} />)}
          </div>
        ) : (
          <VirtualRenewalList rows={items} />
        )}
      </CardContent>
    </Card>
  );
}

function RenewalRow({ l }: { l: any }) {
  return (
    <Link to="/leads/$id" params={{ id: l.id }} className="block p-3 hover:bg-muted/30">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">{l.client_name}</div>
          <div className="text-xs text-muted-foreground truncate">{l.company_name ?? l.lead_code}</div>
        </div>
        <div className="text-xs text-muted-foreground">
          {l.next_follow_up_at ? format(new Date(l.next_follow_up_at), "MMM d, yyyy") : "—"}
        </div>
      </div>
    </Link>
  );
}

function VirtualRenewalList({ rows }: { rows: any[] }) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virt = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => 60,
    overscan: 8,
    scrollMargin: parentRef.current?.offsetTop ?? 0,
  });
  return (
    <div ref={parentRef}>
      <div className="relative w-full" style={{ height: virt.getTotalSize() }}>
        {virt.getVirtualItems().map((vi) => (
          <div
            key={rows[vi.index].id}
            ref={virt.measureElement}
            data-index={vi.index}
            className="absolute left-0 right-0 border-b"
            style={{ transform: `translateY(${vi.start - virt.options.scrollMargin}px)` }}
          >
            <RenewalRow l={rows[vi.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
