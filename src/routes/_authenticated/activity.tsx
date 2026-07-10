import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Phone, Mail, MessageSquare, StickyNote, ArrowRightLeft, Search } from "lucide-react";
import { useState, useMemo } from "react";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/activity")({
  head: () => ({ meta: [{ title: "Activity — EaseMyOffice CRM" }] }),
  component: ActivityPage,
});

type Activity = {
  id: string; type: string; title: string; body: string | null;
  lead_id: string; actor_id: string | null; created_at: string;
  payload: Record<string, unknown>;
};

const TYPE_ICONS: Record<string, typeof Phone> = {
  call_logged: Phone, email_sent: Mail, whatsapp_sent: MessageSquare,
  note_added: StickyNote, stage_changed: ArrowRightLeft,
};

const TYPE_COLORS: Record<string, string> = {
  call_logged: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  email_sent: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  whatsapp_sent: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  note_added: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  stage_changed: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
};

function ActivityPage() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState<string>("all");

  const { data: activities = [] } = useQuery({
    queryKey: ["activity-feed"],
    queryFn: async () => {
      const { data } = await supabase.from("lead_activities")
        .select("*").order("created_at", { ascending: false }).limit(500);
      return (data ?? []) as Activity[];
    },
  });

  const { data: leads = [] } = useQuery({
    queryKey: ["activity-leads"],
    queryFn: async () => {
      const { data } = await supabase.from("leads").select("id, lead_code, client_name, company_name").limit(1000);
      return data ?? [];
    },
  });

  const leadMap = useMemo(() => new Map(leads.map((l: any) => [l.id, l])), [leads]);

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    return activities.filter((a) => {
      if (type !== "all" && a.type !== type) return false;
      if (!t) return true;
      const lead: any = leadMap.get(a.lead_id);
      return (
        a.title.toLowerCase().includes(t) ||
        (a.body ?? "").toLowerCase().includes(t) ||
        (lead?.client_name ?? "").toLowerCase().includes(t)
      );
    });
  }, [activities, search, type, leadMap]);

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Activity</h1>
        <p className="text-sm text-muted-foreground">Live feed of calls, emails, WhatsApp, notes & stage changes.</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search activity…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="call_logged">Calls</SelectItem>
            <SelectItem value="email_sent">Emails</SelectItem>
            <SelectItem value="whatsapp_sent">WhatsApp</SelectItem>
            <SelectItem value="note_added">Notes</SelectItem>
            <SelectItem value="stage_changed">Stage changes</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0 divide-y">
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">No activity yet.</div>
          ) : filtered.map((a) => {
            const Icon = TYPE_ICONS[a.type] ?? StickyNote;
            const lead: any = leadMap.get(a.lead_id);
            return (
              <div key={a.id} className="p-4 flex gap-3 hover:bg-muted/30">
                <div className={`size-9 rounded-full grid place-items-center shrink-0 ${TYPE_COLORS[a.type] ?? ""}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-sm">{a.title}</div>
                    <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}</span>
                  </div>
                  {a.body && <p className="text-sm text-muted-foreground mt-0.5">{a.body}</p>}
                  {lead && (
                    <Link to="/leads/$id" params={{ id: a.lead_id }} className="inline-block mt-1">
                      <Badge variant="outline" className="text-xs">
                        {lead.client_name} · {lead.lead_code}
                      </Badge>
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
