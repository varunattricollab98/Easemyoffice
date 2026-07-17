import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Phone, RefreshCcw } from "lucide-react";
import { useMemo } from "react";
import { format, differenceInDays } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/renewals/pipeline")({
  head: () => ({ meta: [{ title: "Renewal Pipeline — EaseMyOffice CRM" }] }),
  component: RenewalPipelinePage,
});

const STAGES = [
  { id: "pending", label: "New Renewal", color: "bg-slate-100 dark:bg-slate-800", border: "border-slate-300 dark:border-slate-600", dot: "bg-slate-500" },
  { id: "contacted", label: "Contacted", color: "bg-blue-50 dark:bg-blue-950", border: "border-blue-300 dark:border-blue-700", dot: "bg-blue-500" },
  { id: "following_up", label: "Following Up", color: "bg-violet-50 dark:bg-violet-950", border: "border-violet-300 dark:border-violet-700", dot: "bg-violet-500" },
  { id: "not_responding", label: "Not Responding", color: "bg-amber-50 dark:bg-amber-950", border: "border-amber-300 dark:border-amber-700", dot: "bg-amber-500" },
  { id: "pending_payment", label: "Pending Payment", color: "bg-cyan-50 dark:bg-cyan-950", border: "border-cyan-300 dark:border-cyan-700", dot: "bg-cyan-500" },
  { id: "renewed", label: "Renewed", color: "bg-emerald-50 dark:bg-emerald-950", border: "border-emerald-300 dark:border-emerald-700", dot: "bg-emerald-500" },
  { id: "cancelled", label: "Cancelled", color: "bg-gray-50 dark:bg-gray-900", border: "border-gray-300 dark:border-gray-600", dot: "bg-gray-500" },
];

function RenewalPipelinePage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: bookings = [], isLoading, refetch } = useQuery({
    queryKey: ["renewal-pipeline"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase.from("bookings")
        .select("id, booking_code, external_booking_id, client_name, business_name, contact_no, plan_name, plan_expiry_date, renewal_status, renewal_assigned_to, total_amount")
        .not("plan_expiry_date", "is", null)
        .order("plan_expiry_date", { ascending: true })
        .limit(2000);
      return (data ?? []) as any[];
    },
  });

  const { data: team = [] } = useQuery({
    queryKey: ["renewal-team"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").order("full_name");
      return (data ?? []) as any[];
    },
  });

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    team.forEach((u: any) => m.set(u.id, u.full_name || u.email || ""));
    return m;
  }, [team]);

  const columns = useMemo(() => {
    return STAGES.map((stage) => ({
      ...stage,
      items: bookings.filter((b: any) => b.renewal_status === stage.id),
    }));
  }, [bookings]);

  const moveStage = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("bookings").update({
        renewal_status: status,
        renewal_stage_changed_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["renewal-pipeline"] });
      qc.invalidateQueries({ queryKey: ["renewal-bookings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-4 md:p-8 max-w-full mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Renewal Pipeline</h1>
          <p className="text-sm text-muted-foreground">Visual board of all renewal stages. Change status using the dropdown on each card.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCcw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-muted-foreground">Loading pipeline…</div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {columns.map((col) => (
            <div key={col.id} className="flex-shrink-0 w-[280px]">
              <div className={`rounded-xl border ${col.border} ${col.color} p-3`}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${col.dot}`} />
                  <span className="font-semibold text-sm">{col.label}</span>
                  <Badge variant="secondary" className="ml-auto text-xs">{col.items.length}</Badge>
                </div>
                <div className="space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto">
                  {col.items.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">No bookings</p>
                  ) : (
                    col.items.map((b: any) => {
                      const daysLeft = differenceInDays(new Date(b.plan_expiry_date), new Date());
                      const expired = daysLeft < 0;
                      const assignee = b.renewal_assigned_to ? nameById.get(b.renewal_assigned_to) : null;
                      return (
                        <Card key={b.id} className="shadow-sm">
                          <CardContent className="p-3">
                            <div className="font-medium text-sm truncate">{b.client_name}</div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">{b.plan_name}</div>
                            {b.contact_no && (
                              <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                <Phone className="h-2.5 w-2.5" /> {b.contact_no}
                              </div>
                            )}
                            <div className="flex items-center justify-between mt-2">
                              <span className={`text-[10px] font-medium ${expired ? "text-destructive" : daysLeft <= 7 ? "text-amber-600" : "text-muted-foreground"}`}>
                                {expired ? `Expired ${Math.abs(daysLeft)}d ago` : `${daysLeft}d left`}
                              </span>
                              {assignee && <span className="text-[10px] text-muted-foreground">{assignee}</span>}
                            </div>
                            {/* Quick move buttons */}
                            <div className="flex flex-wrap gap-1 mt-2">
                              {STAGES.filter((s) => s.id !== col.id).slice(0, 3).map((s) => (
                                <Button
                                  key={s.id}
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-[10px] px-2"
                                  disabled={moveStage.isPending}
                                  onClick={() => moveStage.mutate({ id: b.id, status: s.id })}
                                >
                                  <span className={`h-1.5 w-1.5 rounded-full ${s.dot} mr-1`} />{s.label}
                                </Button>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
