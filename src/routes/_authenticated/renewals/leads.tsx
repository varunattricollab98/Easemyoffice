import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Phone, Mail, CalendarClock, RefreshCcw } from "lucide-react";
import { useState, useMemo } from "react";
import { format, differenceInDays } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/renewals/leads")({
  head: () => ({ meta: [{ title: "Renewal Leads — EaseMyOffice CRM" }] }),
  component: RenewalLeadsPage,
});

const STATUS_OPTIONS = [
  { id: "all", label: "All statuses" },
  { id: "pending", label: "New Renewal" },
  { id: "contacted", label: "Contacted" },
  { id: "following_up", label: "Following Up" },
  { id: "not_responding", label: "Not Responding" },
  { id: "pending_payment", label: "Pending Payment" },
  { id: "renewed", label: "Renewed" },
  { id: "not_interested", label: "Not Interested" },
  { id: "address_changed", label: "Address Changed" },
  { id: "lost", label: "Lost" },
];

const EXPIRY_FILTERS = [
  { id: "all", label: "All expiry" },
  { id: "overdue", label: "Already expired" },
  { id: "7d", label: "Next 7 days" },
  { id: "30d", label: "Next 30 days" },
  { id: "90d", label: "Next 90 days" },
];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  contacted: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  following_up: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300",
  not_responding: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  pending_payment: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300",
  renewed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  not_interested: "bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300",
  address_changed: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  lost: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

function RenewalLeadsPage() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expiryFilter, setExpiryFilter] = useState("all");

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ["renewal-leads-all"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase.from("bookings")
        .select("id, booking_code, external_booking_id, client_name, business_name, contact_no, email_id, plan_name, plan_start_date, plan_expiry_date, renewal_status, renewal_assigned_to, renewal_followup_at, renewal_notes, total_amount")
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

  const filtered = useMemo(() => {
    const now = new Date();
    return bookings.filter((b: any) => {
      if (statusFilter !== "all" && b.renewal_status !== statusFilter) return false;
      if (expiryFilter !== "all") {
        const exp = new Date(b.plan_expiry_date);
        const days = differenceInDays(exp, now);
        if (expiryFilter === "overdue" && days >= 0) return false;
        if (expiryFilter === "7d" && (days < 0 || days > 7)) return false;
        if (expiryFilter === "30d" && (days < 0 || days > 30)) return false;
        if (expiryFilter === "90d" && (days < 0 || days > 90)) return false;
      }
      if (search.trim()) {
        const s = search.toLowerCase();
        if (![b.client_name, b.business_name, b.contact_no, b.email_id, b.plan_name, b.booking_code, b.external_booking_id]
          .some((v: string) => (v ?? "").toLowerCase().includes(s))) return false;
      }
      return true;
    });
  }, [bookings, statusFilter, expiryFilter, search]);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("bookings").update({
        renewal_status: status,
        renewal_stage_changed_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["renewal-leads-all"] }); qc.invalidateQueries({ queryKey: ["renewal-bookings"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignTo = useMutation({
    mutationFn: async ({ id, userId }: { id: string; userId: string }) => {
      const { error } = await supabase.from("bookings").update({ renewal_assigned_to: userId }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Assigned"); qc.invalidateQueries({ queryKey: ["renewal-leads-all"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Renewal Leads</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} leads · bookings with expiry dates</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-3 flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-56">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search client, plan, phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={expiryFilter} onValueChange={setExpiryFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {EXPIRY_FILTERS.map((f) => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">No renewal leads match the current filters.</div>
          ) : (
            <div className="divide-y">
              {filtered.map((b: any) => {
                const exp = new Date(b.plan_expiry_date);
                const daysLeft = differenceInDays(exp, new Date());
                const expired = daysLeft < 0;
                const assignee = b.renewal_assigned_to ? nameById.get(b.renewal_assigned_to) : null;
                return (
                  <div key={b.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{b.client_name}</span>
                        <Badge className={STATUS_COLORS[b.renewal_status] ?? ""} variant="secondary">
                          {STATUS_OPTIONS.find((s) => s.id === b.renewal_status)?.label ?? b.renewal_status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
                        <span>{b.plan_name}</span>
                        {b.contact_no && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{b.contact_no}</span>}
                        {b.email_id && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{b.email_id}</span>}
                        {assignee && <span>Assigned: {assignee}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <div className={`text-xs font-medium ${expired ? "text-destructive" : daysLeft <= 7 ? "text-amber-600" : "text-muted-foreground"}`}>
                          <CalendarClock className="h-3 w-3 inline mr-1" />
                          {expired ? `Expired ${Math.abs(daysLeft)}d ago` : `${daysLeft}d left`}
                        </div>
                        <div className="text-[10px] text-muted-foreground">{format(exp, "MMM d, yyyy")}</div>
                      </div>
                      <Select value={b.renewal_status} onValueChange={(v) => updateStatus.mutate({ id: b.id, status: v })}>
                        <SelectTrigger className="h-7 w-32 text-[11px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.filter((s) => s.id !== "all").map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {isAdmin && (
                        <Select value={b.renewal_assigned_to ?? ""} onValueChange={(v) => assignTo.mutate({ id: b.id, userId: v })}>
                          <SelectTrigger className="h-7 w-32 text-[11px]"><SelectValue placeholder="Assign…" /></SelectTrigger>
                          <SelectContent>
                            {team.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.full_name || t.email}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
