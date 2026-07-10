import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, FileText, Check, Circle } from "lucide-react";
import { useRef, useState, useMemo } from "react";
import { format } from "date-fns";
import { labelFor, SERVICES } from "@/lib/crm";

export const Route = createFileRoute("/_authenticated/documentation")({
  head: () => ({ meta: [{ title: "Documentation — EaseMyOffice CRM" }] }),
  component: DocumentationPage,
});

const KYC_CHECKLIST = [
  "PAN Card", "Aadhaar Card", "Address Proof", "Photograph", "Business Registration",
  "GST Certificate (if applicable)", "Cancelled Cheque",
];

function DocumentationPage() {
  const [search, setSearch] = useState("");

  const { data: leads = [] } = useQuery({
    queryKey: ["doc-leads"],
    queryFn: async () => {
      const { data } = await supabase.from("leads")
        .select("id, lead_code, client_name, company_name, stage, service_required, last_activity_at, intent_flags")
        .in("stage", ["documents_pending", "draft_shared", "agreement_signed"] as never)
        .order("last_activity_at", { ascending: false }).limit(300);
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return leads;
    return leads.filter((l: any) =>
      [l.client_name, l.company_name, l.lead_code].some((v: string) => (v ?? "").toLowerCase().includes(t)),
    );
  }, [leads, search]);

  const grouped = useMemo(() => ({
    pending: filtered.filter((l: any) => l.stage === "documents_pending"),
    drafts: filtered.filter((l: any) => l.stage === "draft_shared"),
    signed: filtered.filter((l: any) => l.stage === "agreement_signed"),
  }), [filtered]);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Documentation</h1>
        <p className="text-sm text-muted-foreground">KYC tracking, agreement drafts and signature workflow.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Documents pending</div><div className="text-2xl font-bold">{grouped.pending.length}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Drafts shared</div><div className="text-2xl font-bold">{grouped.drafts.length}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Agreements signed</div><div className="text-2xl font-bold">{grouped.signed.length}</div></CardContent></Card>
      </div>

      <div className="relative max-w-md">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search by client, company, code…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">No documentation work in progress.</div>
          ) : (
            <VirtualDocList rows={filtered} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="font-medium mb-2 flex items-center gap-2"><FileText className="h-4 w-4" /> Standard KYC Checklist</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-muted-foreground">
            {KYC_CHECKLIST.map((d) => (
              <div key={d} className="flex items-center gap-2"><Circle className="h-3 w-3" /> {d}</div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DocRow({ lead }: { lead: any }) {
  const flags = lead.intent_flags ?? {};
  const docCount = (flags.asked_documents ? 1 : 0);
  return (
    <Link to="/leads/$id" params={{ id: lead.id }} className="block p-4 hover:bg-muted/30">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="size-9 rounded-full bg-primary/10 grid place-items-center"><FileText className="h-4 w-4 text-primary" /></div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{lead.client_name}</div>
          <div className="text-xs text-muted-foreground truncate">{lead.company_name ?? lead.lead_code} · {labelFor(SERVICES, lead.service_required)}</div>
        </div>
        <Badge variant="outline" className="text-xs">{lead.stage.replace(/_/g, " ")}</Badge>
        {docCount > 0 ? <Check className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
        <div className="text-xs text-muted-foreground">{format(new Date(lead.last_activity_at), "MMM d")}</div>
      </div>
    </Link>
  );
}

function VirtualDocList({ rows }: { rows: any[] }) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virt = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => 68,
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
            <DocRow lead={rows[vi.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
