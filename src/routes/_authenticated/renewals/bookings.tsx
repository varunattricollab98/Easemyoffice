import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, CheckCircle2, Clock, IndianRupee, UserCircle2 } from "lucide-react";
import { useState, useMemo } from "react";
import { format } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/renewals/bookings")({
  head: () => ({ meta: [{ title: "Renewal Bookings — EaseMyOffice CRM" }] }),
  component: RenewalBookingsPage,
});

const fmtINR = (n: number) => `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const STATUS_FILTER_OPTIONS = [
  { id: "all", label: "All" },
  { id: "renewed", label: "Renewed" },
  { id: "pending_payment", label: "Pending Payment" },
];

function RenewalBookingsPage() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ["renewal-bookings-list"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase.from("bookings")
        .select("id, booking_code, external_booking_id, booking_date, client_name, business_name, contact_no, email_id, plan_name, plan_start_date, plan_expiry_date, renewal_status, renewal_assigned_to, total_amount, amount_received, balance_amount, vo_status, sp_payment_status, sales_month, remarks")
        .in("renewal_status", ["renewed", "pending_payment"])
        .order("plan_expiry_date", { ascending: false })
        .limit(1000);
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
    return bookings.filter((b: any) => {
      if (statusFilter !== "all" && b.renewal_status !== statusFilter) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        if (![b.client_name, b.business_name, b.contact_no, b.email_id, b.plan_name, b.booking_code, b.external_booking_id]
          .some((v: string) => (v ?? "").toLowerCase().includes(s))) return false;
      }
      return true;
    });
  }, [bookings, statusFilter, search]);

  const assignTo = useMutation({
    mutationFn: async ({ id, userId }: { id: string; userId: string }) => {
      const { error } = await supabase.from("bookings").update({ renewal_assigned_to: userId }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Assigned"); qc.invalidateQueries({ queryKey: ["renewal-bookings-list"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const markRenewed = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("bookings").update({
        renewal_status: "renewed",
        renewal_stage_changed_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Marked as renewed"); qc.invalidateQueries({ queryKey: ["renewal-bookings-list"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalAmount = useMemo(() => filtered.reduce((s, b: any) => s + Number(b.total_amount ?? 0), 0), [filtered]);
  const totalReceived = useMemo(() => filtered.reduce((s, b: any) => s + Number(b.amount_received ?? 0), 0), [filtered]);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Renewal Bookings</h1>
          <p className="text-sm text-muted-foreground">
            Bookings that have been renewed or are pending payment. Assign team members and track progress.
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Total Renewed</div>
          <div className="text-xl font-bold text-emerald-600">{bookings.filter((b: any) => b.renewal_status === "renewed").length}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Pending Payment</div>
          <div className="text-xl font-bold text-amber-600">{bookings.filter((b: any) => b.renewal_status === "pending_payment").length}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Total Value</div>
          <div className="text-xl font-bold">{fmtINR(totalAmount)}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Amount Received</div>
          <div className="text-xl font-bold text-emerald-600">{fmtINR(totalReceived)}</div>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-3 flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-56">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search client, plan, phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_FILTER_OPTIONS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Booking</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Expiry</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Assigned To</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
            {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No renewal bookings yet. Bookings move here when their status is set to "Renewed" or "Pending Payment" in the pipeline.</TableCell></TableRow>}
            {filtered.map((b: any) => {
              const isRenewed = b.renewal_status === "renewed";
              const assignee = b.renewal_assigned_to ? nameById.get(b.renewal_assigned_to) : null;
              return (
                <TableRow key={b.id}>
                  <TableCell className="font-mono text-xs">{b.external_booking_id || b.booking_code}</TableCell>
                  <TableCell>
                    <div className="font-medium">{b.client_name}</div>
                    {b.business_name && <div className="text-xs text-muted-foreground">{b.business_name}</div>}
                  </TableCell>
                  <TableCell className="text-sm">{b.plan_name}</TableCell>
                  <TableCell className="text-sm">
                    {b.plan_expiry_date ? format(new Date(b.plan_expiry_date), "MMM d, yyyy") : "—"}
                  </TableCell>
                  <TableCell className="text-right">{fmtINR(Number(b.total_amount))}</TableCell>
                  <TableCell className="text-right">{fmtINR(Number(b.amount_received))}</TableCell>
                  <TableCell>
                    {isRenewed ? (
                      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Renewed
                      </Badge>
                    ) : (
                      <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                        <Clock className="h-3 w-3 mr-1" /> Pending Payment
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {isAdmin ? (
                      <Select value={b.renewal_assigned_to ?? ""} onValueChange={(v) => assignTo.mutate({ id: b.id, userId: v })}>
                        <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Assign…" /></SelectTrigger>
                        <SelectContent>
                          {team.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.full_name || t.email}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-sm text-muted-foreground flex items-center gap-1">
                        {assignee ? <><UserCircle2 className="h-3.5 w-3.5" /> {assignee}</> : "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {!isRenewed && (
                      <Button size="sm" variant="outline" disabled={markRenewed.isPending} onClick={() => markRenewed.mutate(b.id)}>
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark Renewed
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
