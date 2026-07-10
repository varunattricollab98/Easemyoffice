import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, FileText, FolderOpen } from "lucide-react";
import { useState, useMemo } from "react";
import { labelFor, SERVICES } from "@/lib/crm";

export const Route = createFileRoute("/_authenticated/documents")({
  head: () => ({ meta: [{ title: "Documents — EaseMyOffice CRM" }] }),
  component: DocumentsPage,
});

const REQUIRED_DOCS = ["PAN", "Aadhaar", "Address Proof", "Photograph", "Cheque"];

function DocumentsPage() {
  const [search, setSearch] = useState("");

  const { data: leads = [] } = useQuery({
    queryKey: ["documents-leads"],
    queryFn: async () => {
      const { data } = await supabase.from("leads").select("id, lead_code, client_name, company_name, service_required, intent_flags, stage")
        .in("stage", ["documents_pending", "draft_shared", "agreement_signed", "completed"] as never)
        .order("client_name").limit(500);
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

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Documents</h1>
        <p className="text-sm text-muted-foreground">KYC & agreement files per client folder.</p>
      </div>

      <div className="relative max-w-md">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search clients…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.length === 0 && (
          <Card className="md:col-span-2 lg:col-span-3"><CardContent className="p-10 text-center text-muted-foreground">No client folders.</CardContent></Card>
        )}
        {filtered.map((l: any) => {
          const flags = (l.intent_flags ?? {}) as Record<string, boolean>;
          const completed = flags.asked_documents ? REQUIRED_DOCS.length : Math.floor(REQUIRED_DOCS.length / 2);
          return (
            <Link key={l.id} to="/leads/$id" params={{ id: l.id }}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="size-9 rounded bg-amber-100 dark:bg-amber-950 grid place-items-center shrink-0">
                      <FolderOpen className="h-4 w-4 text-amber-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold truncate">{l.client_name}</div>
                      <div className="text-xs text-muted-foreground truncate">{l.company_name ?? l.lead_code}</div>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">{labelFor(SERVICES, l.service_required)}</Badge>
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <FileText className="h-3 w-3" /> {completed}/{REQUIRED_DOCS.length} documents on file
                  </div>
                  <div className="h-1.5 bg-muted rounded overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${(completed / REQUIRED_DOCS.length) * 100}%` }} />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
