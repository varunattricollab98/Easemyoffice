import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Plus, CheckCircle2, Clock, UserCircle2 } from "lucide-react";
import { useState, useMemo } from "react";
import { format } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/renewals/bookings")({
  head: () => ({ meta: [{ title: "Renewal Bookings — EaseMyOffice CRM" }] }),
  component: RenewalBookingsPage,
});

const fmtINR = (n: number) => `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };


const SOURCES = ["Renewal Call", "Email", "WhatsApp", "Referral", "Walk-in", "Other"];
const PAY_STATUSES = ["Pending", "Paid", "Partial"];
const VO_STATUSES = ["Pending", "Active", "Delivered"];

function RenewalBookingsPage() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ["renewal-bookings-list"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase.from("bookings")
        .select("id, booking_code, external_booking_id, booking_date, client_name, business_name, contact_no, email_id, plan_name, plan_start_date, plan_expiry_date, renewal_status, renewal_assigned_to, total_amount, amount_received, balance_amount, vo_amount, addon_amount, sp_payable, addon_payable, profit, vo_status, sp_payment_status, remarks")
        .in("renewal_status", ["renewed", "pending_payment"])
        .order("created_at", { ascending: false })
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
    if (!search.trim()) return bookings;
    const s = search.toLowerCase();
    return bookings.filter((b: any) =>
      [b.client_name, b.business_name, b.contact_no, b.email_id, b.plan_name, b.booking_code, b.external_booking_id]
        .some((v: string) => (v ?? "").toLowerCase().includes(s))
    );
  }, [bookings, search]);

  const totalProfit = useMemo(() => filtered.reduce((s, b: any) => s + Number(b.profit ?? 0), 0), [filtered]);
  const totalReceived = useMemo(() => filtered.reduce((s, b: any) => s + Number(b.amount_received ?? 0), 0), [filtered]);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Renewal Bookings</h1>
          <p className="text-sm text-muted-foreground">Successfully renewed bookings and pending payments.</p>
        </div>
        <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-1" /> New Renewal Booking</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Renewed</div><div className="text-xl font-bold text-emerald-600">{bookings.filter((b: any) => b.renewal_status === "renewed").length}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Pending Payment</div><div className="text-xl font-bold text-amber-600">{bookings.filter((b: any) => b.renewal_status === "pending_payment").length}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Total Profit</div><div className="text-xl font-bold">{fmtINR(totalProfit)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Amount Received</div><div className="text-xl font-bold text-emerald-600">{fmtINR(totalReceived)}</div></Card>
      </div>

      <Card><CardContent className="p-3">
        <div className="relative"><Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search client, plan, phone…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </CardContent></Card>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Booking</TableHead><TableHead>Client</TableHead><TableHead>Plan</TableHead>
            <TableHead className="text-right">VO Amt</TableHead><TableHead className="text-right">Add-on</TableHead>
            <TableHead className="text-right">Profit</TableHead><TableHead className="text-right">Received</TableHead>
            <TableHead>Status</TableHead><TableHead>Assigned</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
            {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No renewal bookings yet. Click "+ New Renewal Booking" to add one.</TableCell></TableRow>}
            {filtered.map((b: any) => {
              const isRenewed = b.renewal_status === "renewed";
              const assignee = b.renewal_assigned_to ? nameById.get(b.renewal_assigned_to) : null;
              return (
                <TableRow key={b.id}>
                  <TableCell className="font-mono text-xs">{b.external_booking_id || b.booking_code}</TableCell>
                  <TableCell><div className="font-medium">{b.client_name}</div>{b.business_name && <div className="text-xs text-muted-foreground">{b.business_name}</div>}</TableCell>
                  <TableCell className="text-sm">{b.plan_name}</TableCell>
                  <TableCell className="text-right text-sm">{fmtINR(Number(b.vo_amount ?? 0))}</TableCell>
                  <TableCell className="text-right text-sm">{fmtINR(Number(b.addon_amount ?? 0))}</TableCell>
                  <TableCell className="text-right font-medium">{fmtINR(Number(b.profit ?? 0))}</TableCell>
                  <TableCell className="text-right">{fmtINR(Number(b.amount_received ?? 0))}</TableCell>
                  <TableCell>{isRenewed ? <Badge className="bg-emerald-100 text-emerald-700"><CheckCircle2 className="h-3 w-3 mr-1" />Renewed</Badge> : <Badge className="bg-amber-100 text-amber-700"><Clock className="h-3 w-3 mr-1" />Pending</Badge>}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{assignee ? <span className="flex items-center gap-1"><UserCircle2 className="h-3.5 w-3.5" />{assignee}</span> : "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <NewRenewalBookingDialog open={addOpen} onClose={() => setAddOpen(false)} userId={user?.id ?? null} team={team} />
    </div>
  );
}


function NewRenewalBookingDialog({ open, onClose, userId, team }: { open: boolean; onClose: () => void; userId: string | null; team: any[] }) {
  const qc = useQueryClient();
  const { isAdmin, profile } = useAuth();
  const [f, setF] = useState({
    date: new Date().toISOString().slice(0, 10),
    sales_agent: profile?.full_name ?? "",
    booking_source: "Renewal Call",
    plan_name: "", vo_plan: "",
    sp_name: "", area: "", city: "", state: "",
    vo_amount: "", addon_services: "", addon_amount: "",
    sp_payable: "", addon_payable: "",
    payment_mode_ref: "", payment_id_utr: "", invoice_number: "",
    sp_payment_status: "Pending", vo_status: "Pending",
    business_name: "", client_name: "", email_id: "", contact_no: "",
    plan_start_date: "", plan_expiry_date: "",
    remarks: "", assigned_to: userId ?? "",
    payment_type: "full" as "full" | "partial",
    amount_received: "", balance_due_date: "",
  });

  // Calculations
  const vo = num(f.vo_amount);
  const voGst = +(vo * 0.18).toFixed(2);
  const addOn = num(f.addon_amount);
  const addOnGst = +(addOn * 0.18).toFixed(2);
  const totalWithGst = +(vo + voGst + addOn + addOnGst).toFixed(2);
  const spPay = num(f.sp_payable);
  const addOnPay = num(f.addon_payable);
  // Profit = (VO - SP Payable) + (Add-on - Add-on Payable) — WITHOUT GST
  const profit = +((vo - spPay) + (addOn - addOnPay)).toFixed(2);
  const isPartial = f.payment_type === "partial";
  const amountReceived = isPartial ? num(f.amount_received) : totalWithGst;
  const balanceAmount = isPartial ? Math.max(0, +(totalWithGst - amountReceived).toFixed(2)) : 0;

  const reset = () => setF({
    date: new Date().toISOString().slice(0, 10), sales_agent: profile?.full_name ?? "", booking_source: "Renewal Call",
    plan_name: "", vo_plan: "", sp_name: "", area: "", city: "", state: "",
    vo_amount: "", addon_services: "", addon_amount: "", sp_payable: "", addon_payable: "",
    payment_mode_ref: "", payment_id_utr: "", invoice_number: "",
    sp_payment_status: "Pending", vo_status: "Pending",
    business_name: "", client_name: "", email_id: "", contact_no: "",
    plan_start_date: "", plan_expiry_date: "", remarks: "", assigned_to: userId ?? "",
    payment_type: "full", amount_received: "", balance_due_date: "",
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!f.client_name.trim()) throw new Error("Client name is required");
      if (!f.vo_amount) throw new Error("VO Amount is required");

      // 1) Save to database
      const { error } = await supabase.from("bookings").insert({
        booking_date: f.date,
        sales_agent_name: f.sales_agent || "Renewal Team",
        sales_agent_id: f.assigned_to || userId,
        booking_source: f.booking_source,
        plan_name: f.plan_name, vo_plan: f.vo_plan,
        sp_name: f.sp_name, area: f.area, city: f.city, state: f.state,
        vo_amount: vo, vo_gst: voGst,
        addon_services: f.addon_services, addon_amount: addOn, addon_gst: addOnGst,
        total_amount: totalWithGst,
        sp_payable: spPay, addon_payable: addOnPay, profit,
        payment_mode_ref: f.payment_mode_ref, payment_id_utr: f.payment_id_utr, invoice_number: f.invoice_number,
        sp_payment_status: f.sp_payment_status, vo_status: f.vo_status,
        business_name: f.business_name, client_name: f.client_name,
        email_id: f.email_id, contact_no: f.contact_no,
        plan_start_date: f.plan_start_date || null,
        plan_expiry_date: f.plan_expiry_date || null,
        remarks: f.remarks,
        amount_received: amountReceived, balance_amount: balanceAmount,
        balance_due_date: isPartial && f.balance_due_date ? f.balance_due_date : null,
        renewal_status: "renewed",
        renewal_assigned_to: f.assigned_to || userId,
        renewal_stage_changed_at: new Date().toISOString(),
        assigned_to: userId, created_by: userId,
      });
      if (error) throw new Error(error.message);

      // 2) Best-effort: sync to the renewal Google Sheet
      // Column order must match HEADERS in the Apps Script exactly:
      // Date, Sales Agent, Booking ID, Booking Source, Plan Name, VO Plan,
      // SP Name, Area, City, State, SP Status,
      // VO Amount, VO GST 18%, Add on Services, Add on Amount, Add on GST 18%,
      // Total Amount, TDS %, TDS Amount, Amount After TDS,
      // Payment Mode, Payment ID/UTR, Invoice Number,
      // SP Payable, Add on Payable, Profit,
      // SP Payment Status, VO Status,
      // Business Name, Client Name, Email Id, Contact No., Remarks, Sales Month,
      // Amount Received, Balance Amount, Balance Due Date
      const salesMonth = (() => { const d = new Date(f.date); return d.toLocaleDateString(undefined, { month: "short", year: "numeric" }).replace(" ", "-"); })();
      const values = [
        f.date, f.sales_agent, "", f.booking_source, f.plan_name, f.vo_plan,
        f.sp_name, f.area, f.city, f.state, "",
        vo, voGst, f.addon_services, addOn, addOnGst,
        totalWithGst, 0, 0, totalWithGst,
        f.payment_mode_ref, f.payment_id_utr, f.invoice_number,
        spPay, addOnPay, profit,
        f.sp_payment_status, f.vo_status,
        f.business_name, f.client_name, f.email_id, f.contact_no, f.remarks, salesMonth,
        amountReceived, balanceAmount, f.balance_due_date || "",
      ];
      const sheet = await syncRenewalToSheet(values);
      return { sheet };
    },
    onSuccess: (res) => {
      toast.success("Renewal booking saved" + (res?.sheet?.ok ? " · added to Sheet ✓" : ""));
      reset(); onClose();
      qc.invalidateQueries({ queryKey: ["renewal-bookings-list"] });
      qc.invalidateQueries({ queryKey: ["renewal-bookings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const T = (k: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div><Label className="text-xs">{label}</Label><Input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} /></div>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Renewal Booking</DialogTitle></DialogHeader>
        <div className="grid gap-3 md:grid-cols-3">
          {T("date", "Date", { type: "date" })}
          {T("sales_agent", "Renewal Agent")}
          <div><Label className="text-xs">Booking Source</Label>
            <Select value={f.booking_source} onValueChange={(v) => setF({ ...f, booking_source: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {T("plan_name", "Plan Name")}
          {T("vo_plan", "VO Plan")}
          {T("sp_name", "SP Name")}
          {T("area", "Area")}
          {T("city", "City")}
          {T("state", "State")}
          {T("vo_amount", "VO Amount (₹) *", { type: "number", min: 0 })}
          <div><Label className="text-xs">VO GST 18% (auto)</Label><Input value={voGst} readOnly className="bg-muted/40" /></div>
          {T("addon_services", "Add-on Services")}
          {T("addon_amount", "Add-on Amount (₹)", { type: "number", min: 0 })}
          <div><Label className="text-xs">Add-on GST 18% (auto)</Label><Input value={addOnGst} readOnly className="bg-muted/40" /></div>
          <div><Label className="text-xs">Total with GST (auto)</Label><Input value={totalWithGst} readOnly className="bg-muted/40 font-medium" /></div>
          {T("sp_payable", "SP Payable ₹", { type: "number", min: 0 })}
          {T("addon_payable", "Add-on Payable ₹", { type: "number", min: 0 })}
          <div><Label className="text-xs">Profit (without GST) (auto)</Label><Input value={profit} readOnly className={`bg-muted/40 font-medium ${profit < 0 ? "text-destructive" : "text-emerald-600"}`} /></div>
          {T("payment_mode_ref", "Payment Mode / Ref")}
          {T("payment_id_utr", "Payment ID / UTR")}
          {T("invoice_number", "Invoice Number")}
          <div><Label className="text-xs">SP Payment Status</Label>
            <Select value={f.sp_payment_status} onValueChange={(v) => setF({ ...f, sp_payment_status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PAY_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">VO Status</Label>
            <Select value={f.vo_status} onValueChange={(v) => setF({ ...f, vo_status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{VO_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {T("business_name", "Business Name")}
          {T("client_name", "Client Name *")}
          {T("email_id", "Email", { type: "email" })}
          {T("contact_no", "Contact No. *", { inputMode: "tel" })}
          {T("plan_start_date", "Plan Start Date", { type: "date" })}
          {T("plan_expiry_date", "Plan Expiry Date", { type: "date" })}
          {isAdmin && (
            <div><Label className="text-xs">Assign To</Label>
              <Select value={f.assigned_to} onValueChange={(v) => setF({ ...f, assigned_to: v })}>
                <SelectTrigger><SelectValue placeholder="Assign…" /></SelectTrigger>
                <SelectContent>{team.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.full_name || t.email}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="mt-3 rounded-md border bg-muted/20 p-3 space-y-3">
          <div className="text-sm font-medium">Payment Received</div>
          <div className="grid gap-3 md:grid-cols-4">
            <div><Label className="text-xs">Payment Type</Label>
              <Select value={f.payment_type} onValueChange={(v) => setF({ ...f, payment_type: v as "full" | "partial" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="full">Full Payment</SelectItem><SelectItem value="partial">Partial</SelectItem></SelectContent>
              </Select>
            </div>
            {isPartial && <>
              {T("amount_received", "Amount Received ₹", { type: "number", min: 0 })}
              <div><Label className="text-xs">Balance (auto)</Label><Input value={balanceAmount} readOnly className="bg-muted/40 text-amber-600 font-medium" /></div>
              {T("balance_due_date", "Balance Due Date", { type: "date" })}
            </>}
          </div>
        </div>
        <div className="mt-2">{T("remarks", "Remarks")}</div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={submit.isPending || !f.client_name || !f.vo_amount} onClick={() => submit.mutate()}>
            {submit.isPending ? "Saving…" : "Save Renewal Booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Best-effort sync to the renewal Google Sheet
async function syncRenewalToSheet(values: (string | number)[]): Promise<{ ok: boolean }> {
  try {
    const { data, error } = await supabase.functions.invoke("sync-renewal-to-sheet", { body: { values } });
    if (error) return { ok: false };
    return { ok: data?.ok ?? false };
  } catch { return { ok: false }; }
}
