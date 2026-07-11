import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/bookings")({
  component: BookingsPage,
});

const fmtINR = (n: number) => `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

function BookingsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["bookings"],
    queryFn: async () => {
      // RLS returns all bookings for admins, and only own bookings for sales.
      const { data, error } = await supabase.from("bookings")
        .select("*").order("created_at", { ascending: false }).limit(1000);
      if (error) throw new Error(error.message);
      return { bookings: data ?? [] };
    },
  });

  const markM = useMutation({
    mutationFn: async (id: string) => {
      const { data: row, error: gErr } = await supabase.from("bookings")
        .select("balance_amount, amount_received").eq("id", id).maybeSingle();
      if (gErr) throw new Error(gErr.message);
      if (!row) throw new Error("Booking not found");
      const bal = Number(row.balance_amount ?? 0);
      const { error } = await supabase.from("bookings").update({
        amount_received: Number(row.amount_received ?? 0) + bal,
        balance_amount: 0,
        balance_paid_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Marked as paid"); qc.invalidateQueries({ queryKey: ["bookings"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const today = new Date().toISOString().slice(0, 10);
  const rows = (data?.bookings ?? []).filter((b: any) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return [b.booking_code, b.external_booking_id, b.client_name, b.business_name, b.plan_name, b.contact_no, b.email_id]
      .some((v) => String(v ?? "").toLowerCase().includes(s));
  });

  const overdue = rows.filter((b: any) => !b.balance_paid_at && Number(b.balance_amount) > 0 && b.balance_due_date && b.balance_due_date <= today);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Bookings</h1>
          <p className="text-sm text-muted-foreground">All closed bookings synced from + New Booking.</p>
        </div>
        <div className="relative w-72 max-w-full">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search booking, client, plan…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {overdue.length > 0 && (
        <Card className="p-3 border-amber-300 bg-amber-50/50 dark:bg-amber-950/20 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <span className="text-sm">{overdue.length} booking(s) have a balance due today or overdue.</span>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Booking</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Sales Agent</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
            {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">No bookings yet. Add one from the dashboard.</TableCell></TableRow>}
            {rows.map((b: any) => {
              const balance = Number(b.balance_amount ?? 0);
              const isPaid = !!b.balance_paid_at || balance === 0;
              const isOverdue = !isPaid && b.balance_due_date && b.balance_due_date <= today;
              return (
                <TableRow key={b.id}>
                  <TableCell className="font-mono text-xs">{b.external_booking_id || b.booking_code}</TableCell>
                  <TableCell>{b.booking_date}</TableCell>
                  <TableCell>
                    <div className="font-medium">{b.client_name}</div>
                    <div className="text-xs text-muted-foreground">{b.business_name}</div>
                  </TableCell>
                  <TableCell>{b.plan_name}</TableCell>
                  <TableCell className="text-sm">{b.sales_agent_name}</TableCell>
                  <TableCell className="text-right">{fmtINR(Number(b.amount_after_tds))}</TableCell>
                  <TableCell className="text-right">{fmtINR(Number(b.amount_received))}</TableCell>
                  <TableCell className={`text-right font-medium ${balance > 0 ? "text-amber-600" : ""}`}>{fmtINR(balance)}</TableCell>
                  <TableCell className={isOverdue ? "text-destructive font-medium" : ""}>{b.balance_due_date ?? "—"}</TableCell>
                  <TableCell>
                    {isPaid ? (
                      <Badge variant="secondary"><CheckCircle2 className="h-3 w-3 mr-1" /> Paid</Badge>
                    ) : isOverdue ? (
                      <Badge variant="destructive">Overdue</Badge>
                    ) : (
                      <Badge variant="outline">Pending</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {!isPaid && balance > 0 && (
                      <Button size="sm" variant="outline" disabled={markM.isPending} onClick={() => markM.mutate(b.id)}>
                        Mark Paid
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
