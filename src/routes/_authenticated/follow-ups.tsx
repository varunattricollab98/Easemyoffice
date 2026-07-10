import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell, Check } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useEffect } from "react";
import { FollowUpsSkeleton } from "@/components/skeletons";
import { usePagePerf } from "@/lib/perf";

type FollowUpSearch = { filter?: "overdue" | "today" | "upcoming" };

export const Route = createFileRoute("/_authenticated/follow-ups")({
  head: () => ({ meta: [{ title: "Follow-ups — EaseMyOffice CRM" }] }),
  validateSearch: (s: Record<string, unknown>): FollowUpSearch => ({
    filter: s.filter === "overdue" || s.filter === "today" || s.filter === "upcoming"
      ? s.filter : undefined,
  }),
  component: FollowUpsPage,
});

type FU = {
  id: string; action: string; due_at: string; status: string;
  leads: { id: string; lead_code: string; client_name: string } | null;
};

function FollowUpsPage() {
  const qc = useQueryClient();
  const search = Route.useSearch();
  const { data, isLoading } = useQuery({
    queryKey: ["all-followups"],
    queryFn: async () => {
      const { data } = await supabase
        .from("follow_ups")
        .select("id, action, due_at, status, leads:lead_id(id, lead_code, client_name)")
        .order("due_at", { ascending: true })
        .limit(300);
      return (data ?? []) as unknown as FU[];
    },
  });

  // Live updates: refresh on any follow_ups or leads change
  useEffect(() => {
    const ch = supabase
      .channel("followups-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "follow_ups" }, () => {
        qc.invalidateQueries({ queryKey: ["all-followups"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => {
        qc.invalidateQueries({ queryKey: ["all-followups"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  usePagePerf("Follow-ups", isLoading);

  const now = new Date();
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const overdue = (data ?? []).filter((f) => f.status === "pending" && new Date(f.due_at) < now);
  const today = (data ?? []).filter((f) => f.status === "pending" && new Date(f.due_at) >= now && new Date(f.due_at) <= todayEnd);
  const upcoming = (data ?? []).filter((f) => f.status === "pending" && new Date(f.due_at) > todayEnd);

  const markDone = async (id: string) => {
    await supabase.from("follow_ups").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", id);
    qc.invalidateQueries();
    toast.success("Done");
  };

  const Section = ({ id, title, items, tone }: { id: "overdue" | "today" | "upcoming"; title: string; items: FU[]; tone: string }) => {
    if (search.filter && search.filter !== id) return null;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className={`h-4 w-4 ${tone}`} />{title}
            <span className="text-muted-foreground">· {items.length}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {items.length === 0 && <div className="text-sm text-muted-foreground">Nothing here.</div>}
          {items.map((f) => (
            <div key={f.id} className="flex items-center gap-3 p-2.5 rounded-md border">
              <div className="flex-1 min-w-0">
                <Link to="/leads/$id" params={{ id: f.leads?.id ?? "" }} className="text-sm font-medium hover:underline">
                  {f.action}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {f.leads?.client_name} · {format(new Date(f.due_at), "PPp")}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => markDone(f.id)}>
                <Check className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="p-4 md:p-8 space-y-4 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-bold">Follow-ups</h1>
        {search.filter && (
          <Button variant="outline" size="sm" asChild>
            <Link to="/follow-ups">Clear filter</Link>
          </Button>
        )}
      </div>
      {isLoading && !data ? (
        <FollowUpsSkeleton />
      ) : (
        <>
          <Section id="overdue" title="Overdue" items={overdue} tone="text-destructive" />
          <Section id="today" title="Today" items={today} tone="text-amber-500" />
          <Section id="upcoming" title="Upcoming" items={upcoming} tone="text-muted-foreground" />
        </>
      )}
    </div>
  );
}
