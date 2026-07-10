import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, IndianRupee, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { useState, useMemo } from "react";
import { format, isPast } from "date-fns";

export const Route = createFileRoute("/_authenticated/payments")({
  head: () => ({ meta: [{ title: "Payments — EaseMyOffice CRM" }] }),
  component: PaymentsPage,
});

function formatINR(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function PaymentsPage() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "overdue" | "paid">("all");

  const { data: bookings = [] } = useQuery({
    queryKey: ["payments-bookings"],
    queryFn: async () => {
      const { data } = await supabase.from("bookings").select("*")
        .order("balance_due_date", { ascending: true, nullsFirst: false });
      return data ?? [];
    },
  });

  const enriched = useMemo(() => bookings.map((b: any) => {
    const balance = Number(b.balance_amount ?? 0);
    let status: "paid" | "overdue" | "pending" = "pending";
    if (balance <= 0 || b.balance_paid_at) status = "paid";
    else if (b.balance_due_date && isPast(new Date(b.balance_due_date))) status = "overdue";
    return { ...b, _status: status, _balance: balance };
  }), [bookings]);

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    return enriched.filter((b: any) => {
      if (filter !== "all" && b._status !== filter) return false;
      if (!t) return true;
      return [b.client_name, b.business_name, b.invoice_number, b.booking_code].some((v: string) =>
        (v ?? "").toLowerCase().includes(t),
      );
    });
  }, [enriched, search, filter]);

  const totals = useMemo(() => ({
    pending: enriched.filter((b: any) => b._status === "pending").reduce((s: number, b: any) => s + b._balance, 0),
    overdue: enriched.filter((b: any) => b._status === "overdue").reduce((s: number, b: any) => s + b._balance, 0),
    received: enriched.reduce((s: number, b: any) => s + Number(b.amount_received ?? 0), 0),
  }), [enriched]);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Payments</h1>
        <p className="text-sm text-muted-foreground">Track received, pending and overdue balances across bookings.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard icon={CheckCircle2} label="Total received" value={formatINR(totals.received)} tone="emerald" />
        <KpiCard icon={Clock} label="Pending balance" value={formatINR(totals.pending)} tone="amber" />
        <KpiCard icon={AlertCircle} label="Overdue balance" value={formatINR(totals.overdue)} tone="rose" />
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search client, invoice, booking code…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0 divide-y">
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">No payments found.</div>
          ) : filtered.map((b: any) => (
            <div key={b.id} className="p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-48">
                <div className="font-medium text-sm">{b.client_name} {b.business_name && <span className="text-muted-foreground">· {b.business_name}</span>}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {b.booking_code} · {b.plan_name}
                  {b.invoice_number && <> · Invoice {b.invoice_number}</>}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm">Total {formatINR(Number(b.total_amount ?? 0))}</div>
                <div className="text-xs text-muted-foreground">Received {formatINR(Number(b.amount_received ?? 0))}</div>
              </div>
              <div className="text-right min-w-32">
                <div className="text-sm font-semibold flex items-center justify-end gap-1"><IndianRupee className="h-3 w-3" />{formatINR(b._balance).replace("₹", "")}</div>
                {b.balance_due_date && <div className="text-xs text-muted-foreground">Due {format(new Date(b.balance_due_date), "MMM d, yyyy")}</div>}
              </div>
              <StatusBadge status={b._status} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: string }) {
  const tones: Record<string, string> = {
    emerald: "from-emerald-500/10 to-emerald-500/5 text-emerald-600",
    amber: "from-amber-500/10 to-amber-500/5 text-amber-600",
    rose: "from-rose-500/10 to-rose-500/5 text-rose-600",
  };
  return (
    <Card className={`bg-gradient-to-br ${tones[tone]}`}>
      <CardContent className="p-4 flex items-center gap-3">
        <Icon className="h-8 w-8" />
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "paid") return <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Paid</Badge>;
  if (status === "overdue") return <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">Overdue</Badge>;
  return <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">Pending</Badge>;
}
