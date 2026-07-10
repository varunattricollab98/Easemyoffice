import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, Building2, Mail, Phone } from "lucide-react";
import { useState, useMemo } from "react";
import { labelFor, SERVICES } from "@/lib/crm";

export const Route = createFileRoute("/_authenticated/clients")({
  head: () => ({ meta: [{ title: "Clients — EaseMyOffice CRM" }] }),
  component: ClientsPage,
});

function ClientsPage() {
  const [search, setSearch] = useState("");

  const { data: clients = [] } = useQuery({
    queryKey: ["clients-list"],
    queryFn: async () => {
      const { data } = await supabase.from("leads")
        .select("id, lead_code, client_name, company_name, email, mobile, stage, service_required")
        .in("stage", ["completed", "agreement_signed", "renewal_due"] as never)
        .order("client_name").limit(1000);
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return clients;
    return clients.filter((c: any) =>
      [c.client_name, c.company_name, c.email, c.mobile, c.lead_code].some((v: string) =>
        (v ?? "").toLowerCase().includes(t),
      ),
    );
  }, [clients, search]);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Clients</h1>
        <p className="text-sm text-muted-foreground">{filtered.length} active clients (converted leads).</p>
      </div>

      <div className="relative max-w-md">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search clients…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((c: any) => (
          <Link key={c.id} to="/leads/$id" params={{ id: c.id }}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{c.client_name}</div>
                    {c.company_name && (
                      <div className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                        <Building2 className="h-3 w-3 shrink-0" /> {c.company_name}
                      </div>
                    )}
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">{c.stage.replace(/_/g, " ")}</Badge>
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  {c.email && <div className="flex items-center gap-1.5 truncate"><Mail className="h-3 w-3" /> {c.email}</div>}
                  <div className="flex items-center gap-1.5"><Phone className="h-3 w-3" /> {c.mobile}</div>
                </div>
                <Badge variant="secondary" className="text-[10px]">{labelFor(SERVICES, c.service_required)}</Badge>
              </CardContent>
            </Card>
          </Link>
        ))}
        {filtered.length === 0 && (
          <Card className="md:col-span-2 lg:col-span-3"><CardContent className="p-10 text-center text-muted-foreground">No clients yet.</CardContent></Card>
        )}
      </div>
    </div>
  );
}
