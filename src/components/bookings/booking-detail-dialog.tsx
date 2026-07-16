import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { Plus } from "lucide-react";

const PAY_STATUSES = ["Pending", "Paid", "Partial"];
const VO_STATUSES = ["Pending", "Active", "Delivered"];
const PAY_MODES = ["UPI", "Bank Transfer / NEFT", "Cheque", "Cash", "Card", "Payment Link", "Other"];
const SOURCES = ["Website", "Referral", "IndiaMART", "Google Ads", "Meta Ads", "WhatsApp", "Direct", "Other"];
const num = (v: any) => { const n = parseFloat(String(v)); return Number.isFinite(n) ? n : 0; };
const fmtINR = (n: number) => `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export function BookingDetailDialog({ booking, open, onOpenChange }: { booking: any | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const bookingId = booking?.id as string | undefined;

  const [f, setF] = useState<any>({});
  useEffect(() => {
    if (booking) {
      setF({
        booking_date: booking.booking_date ?? "", booking_source: booking.booking_source ?? "Website",
        plan_name: booking.plan_name ?? "", vo_plan: booking.vo_plan ?? "",
        sp_name: booking.sp_name ?? "", area: booking.area ?? "", city: booking.city ?? "", state: booking.state ?? "",
        sp_status: booking.sp_status ?? "Active",
        vo_amount: String(booking.vo_amount ?? ""), addon_services: booking.addon_services ?? "", addon_amount: String(booking.addon_amount ?? ""),
        quoted_amount: String(booking.quoted_amount ?? ""),
        tds_pct: String(booking.tds_pct ?? "0"),
        payment_mode_ref: booking.payment_mode_ref ?? "", payment_id_utr: booking.payment_id_utr ?? "", invoice_number: booking.invoice_number ?? "",
        sp_payable: String(booking.sp_payable ?? ""), addon_payable: String(booking.addon_payable ?? ""),
        sp_payment_status: booking.sp_payment_status ?? "Pending", vo_status: booking.vo_status ?? "Pending",
        business_name: booking.business_name ?? "", client_name: booking.client_name ?? "",
        email_id: booking.email_id ?? "", contact_no: booking.contact_no ?? "",
        alt_contact_no: booking.alt_contact_no ?? "", alt_contact_no_2: booking.alt_contact_no_2 ?? "",
        balance_due_date: booking.balance_due_date ?? "",
        remarks: booking.remarks ?? "",
      });
    }
  }, [booking]);

  // recomputed money
  const vo = num(f.vo_amount), voGst = +(vo * 0.18).toFixed(2);
  const addOn = num(f.addon_amount), addOnGst = +(addOn * 0.18).toFixed(2);
  const total = +(vo + voGst + addOn + addOnGst).toFixed(2);
  const tdsPct = num(f.tds_pct), tdsAmt = +((total * tdsPct) / 100).toFixed(2);
  const afterTds = +(total - tdsAmt).toFixed(2);
  const spPay = num(f.sp_payable), addOnPay = num(f.addon_payable);
  const profit = +(total - spPay - addOnPay).toFixed(2);
  // Discount = originally quoted price minus the final deal value (never negative).
  const quoted = num(f.quoted_amount);
  const discount = quoted > 0 ? Math.max(0, +(quoted - total).toFixed(2)) : 0;

  const { data: payments = [] } = useQuery({
    queryKey: ["booking-payments", bookingId],
    enabled: open && !!bookingId,
    queryFn: async () => {
      const { data } = await supabase.from("booking_payments").select("*").eq("booking_id", bookingId).order("created_at", { ascending: true });
      return data ?? [];
    },
  });

  const { data: history = [] } = useQuery({
    queryKey: ["booking-updates", bookingId],
    enabled: open && !!bookingId,
    queryFn: async () => {
      const { data } = await supabase.from("booking_updates").select("*").eq("booking_id", bookingId).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["booking-detail-profiles"],
    enabled: open,
    queryFn: async () => { const { data } = await supabase.from("profiles").select("id, full_name, email"); return data ?? []; },
  });
  const nameOf = (id: string | null) => {
    if (!id) return "Someone";
    const p = (profiles as any[]).find((x) => x.id === id);
    return p?.full_name || p?.email || "Someone";
  };

  const receivedSoFar = Number(booking?.amount_received ?? 0);
  const balance = Math.max(0, +(afterTds - receivedSoFar).toFixed(2));

  const logUpdate = async (action: string, detail = "") => {
    if (!bookingId) return;
    await supabase.from("booking_updates").insert({ booking_id: bookingId, actor_id: user?.id ?? null, action, detail });
  };

  const saveDetails = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("bookings").update({
        booking_date: f.booking_date || null, booking_source: f.booking_source,
        plan_name: f.plan_name, vo_plan: f.vo_plan,
        sp_name: f.sp_name, area: f.area, city: f.city, state: f.state, sp_status: f.sp_status,
        vo_amount: vo, vo_gst: voGst, addon_services: f.addon_services, addon_amount: addOn, addon_gst: addOnGst,
        total_amount: total, quoted_amount: quoted, discount_amount: discount,
        tds_pct: tdsPct, tds_amount: tdsAmt, amount_after_tds: afterTds,
        payment_mode_ref: f.payment_mode_ref, payment_id_utr: f.payment_id_utr, invoice_number: f.invoice_number,
        sp_payable: spPay, addon_payable: addOnPay, profit,
        sp_payment_status: f.sp_payment_status, vo_status: f.vo_status,
        business_name: f.business_name, client_name: f.client_name, email_id: f.email_id, contact_no: f.contact_no,
        alt_contact_no: f.alt_contact_no, alt_contact_no_2: f.alt_contact_no_2,
        balance_due_date: f.balance_due_date || null,
        remarks: f.remarks,
      }).eq("id", bookingId);
      if (error) throw new Error(error.message);
      await logUpdate("Updated booking details");
    },
    onSuccess: () => {
      toast.success("Booking updated");
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["booking-updates", bookingId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // add payment
  const [pay, setPay] = useState({ amount: "", mode: "UPI", reference: "", payment_link: "", note: "", paid_at: new Date().toISOString().slice(0, 10) });
  const addPayment = useMutation({
    mutationFn: async () => {
      const amt = num(pay.amount);
      if (amt <= 0) throw new Error("Enter a payment amount greater than 0");
      const { error } = await supabase.from("booking_payments").insert({
        booking_id: bookingId, amount: amt, mode: pay.mode, reference: pay.reference,
        payment_link: pay.payment_link, note: pay.note, paid_at: pay.paid_at, created_by: user?.id ?? null,
      });
      if (error) throw new Error(error.message);
      const newReceived = receivedSoFar + amt;
      const newBalance = Math.max(0, +(afterTds - newReceived).toFixed(2));
      await supabase.from("bookings").update({
        amount_received: newReceived,
        balance_amount: newBalance,
        balance_paid_at: newBalance === 0 ? new Date().toISOString() : null,
        sp_payment_status: newBalance === 0 ? "Paid" : "Partial",
      }).eq("id", bookingId);
      await logUpdate("Recorded payment", `${fmtINR(amt)} via ${pay.mode}${pay.reference ? ` (ref ${pay.reference})` : ""}`);
    },
    onSuccess: () => {
      toast.success("Payment recorded");
      setPay({ amount: "", mode: "UPI", reference: "", payment_link: "", note: "", paid_at: new Date().toISOString().slice(0, 10) });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["booking-payments", bookingId] });
      qc.invalidateQueries({ queryKey: ["booking-updates", bookingId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const paidViaInstallments = useMemo(() => (payments as any[]).reduce((s, p) => s + Number(p.amount ?? 0), 0), [payments]);

  if (!booking) return null;

  const T = (k: string, label: string, props: any = {}) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {booking.external_booking_id || booking.booking_code} · {booking.client_name}
          </DialogTitle>
          <div className="text-xs text-muted-foreground">
            {fmtINR(Number(booking.amount_after_tds))} total · {fmtINR(receivedSoFar)} received · <span className={balance > 0 ? "text-amber-600 font-medium" : ""}>{fmtINR(balance)} balance</span>
          </div>
        </DialogHeader>

        <Tabs defaultValue="details">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="payments">Payments ({(payments as any[]).length})</TabsTrigger>
            <TabsTrigger value="history">History ({(history as any[]).length})</TabsTrigger>
          </TabsList>

          {/* DETAILS */}
          <TabsContent value="details" className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              {T("booking_date", "Booking Date", { type: "date" })}
              <div>
                <Label className="text-xs">Booking Source</Label>
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
              <div>
                <Label className="text-xs">SP Status</Label>
                <Select value={f.sp_status} onValueChange={(v) => setF({ ...f, sp_status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["Active", "Pending", "Inactive"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {T("vo_amount", "VO Amount (₹)", { type: "number" })}
              <div><Label className="text-xs">VO GST 18% (auto)</Label><Input value={voGst} readOnly className="bg-muted/40" /></div>
              {T("addon_services", "Add on Services")}
              {T("addon_amount", "Add on Amount (₹)", { type: "number" })}
              <div><Label className="text-xs">Add on GST 18% (auto)</Label><Input value={addOnGst} readOnly className="bg-muted/40" /></div>
              <div><Label className="text-xs">Total (auto)</Label><Input value={total} readOnly className="bg-muted/40 font-medium" /></div>
              {T("quoted_amount", "Quoted Price ₹ (before discount)", { type: "number" })}
              <div><Label className="text-xs">Discount Given ₹ (auto)</Label><Input value={discount} readOnly className={`bg-muted/40 font-medium ${discount > 0 ? "text-amber-600" : ""}`} /></div>
              {T("tds_pct", "TDS %", { type: "number" })}
              <div><Label className="text-xs">Amount After TDS (auto)</Label><Input value={afterTds} readOnly className="bg-muted/40" /></div>
              {T("sp_payable", "SP Payable ₹", { type: "number" })}
              {T("addon_payable", "Add on Payable ₹", { type: "number" })}
              <div><Label className="text-xs">Profit (auto)</Label><Input value={profit} readOnly className={`bg-muted/40 font-medium ${profit < 0 ? "text-destructive" : ""}`} /></div>
              {T("payment_mode_ref", "Payment Mode / Ref")}
              {T("payment_id_utr", "Payment ID / UTR")}
              {T("invoice_number", "Invoice Number")}
              <div>
                <Label className="text-xs">SP Payment Status</Label>
                <Select value={f.sp_payment_status} onValueChange={(v) => setF({ ...f, sp_payment_status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PAY_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">VO Status</Label>
                <Select value={f.vo_status} onValueChange={(v) => setF({ ...f, vo_status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{VO_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {T("business_name", "Business Name")}
              {T("client_name", "Client Name")}
              {T("email_id", "Email Id", { type: "email" })}
              {T("contact_no", "Contact No.")}
              {T("alt_contact_no", "Alternative Contact No.")}
              {T("alt_contact_no_2", "Alternative Contact No. 2")}
              {T("balance_due_date", "Balance Due Date", { type: "date" })}
            </div>
            <div>
              <Label className="text-xs">Remarks</Label>
              <Textarea rows={2} value={f.remarks ?? ""} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
            </div>
            <div className="flex justify-end">
              <Button disabled={saveDetails.isPending} onClick={() => saveDetails.mutate()}>
                {saveDetails.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </TabsContent>

          {/* PAYMENTS */}
          <TabsContent value="payments" className="space-y-3">
            <div className="rounded-md border p-3 space-y-3 bg-muted/20">
              <div className="text-sm font-medium">Record a payment</div>
              <div className="grid gap-3 md:grid-cols-3">
                <div><Label className="text-xs">Amount ₹ *</Label><Input type="number" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
                <div>
                  <Label className="text-xs">Mode</Label>
                  <Select value={pay.mode} onValueChange={(v) => setPay({ ...pay, mode: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PAY_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">Date</Label><Input type="date" value={pay.paid_at} onChange={(e) => setPay({ ...pay, paid_at: e.target.value })} /></div>
                <div><Label className="text-xs">Reference / UTR</Label><Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></div>
                <div><Label className="text-xs">Payment link</Label><Input value={pay.payment_link} onChange={(e) => setPay({ ...pay, payment_link: e.target.value })} placeholder="https://…" /></div>
                <div><Label className="text-xs">Note</Label><Input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></div>
              </div>
              <div className="flex justify-end">
                <Button size="sm" disabled={addPayment.isPending} onClick={() => addPayment.mutate()}>
                  <Plus className="h-4 w-4 mr-1" /> {addPayment.isPending ? "Saving…" : "Add payment"}
                </Button>
              </div>
            </div>

            <div className="text-xs text-muted-foreground">Recorded installments total: <span className="font-medium text-foreground">{fmtINR(paidViaInstallments)}</span></div>

            {(payments as any[]).length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">No payments recorded yet.</div>
            ) : (
              <div className="space-y-2">
                {(payments as any[]).map((p) => (
                  <div key={p.id} className="flex items-center gap-3 rounded-md border p-2.5 text-sm">
                    <div className="font-medium">{fmtINR(Number(p.amount))}</div>
                    <div className="text-muted-foreground">{p.mode}{p.reference ? ` · ${p.reference}` : ""}</div>
                    {p.payment_link && <a href={p.payment_link} target="_blank" rel="noreferrer" className="text-primary underline text-xs">link</a>}
                    <div className="ml-auto text-xs text-muted-foreground">{p.paid_at}</div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* HISTORY */}
          <TabsContent value="history" className="space-y-2">
            {(history as any[]).length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">No updates yet.</div>
            ) : (
              (history as any[]).map((h) => (
                <div key={h.id} className="flex gap-3 border-b pb-2">
                  <div className="size-2 rounded-full bg-primary mt-1.5" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{h.action}{h.detail ? <span className="font-normal text-muted-foreground"> — {h.detail}</span> : null}</div>
                    <div className="text-xs text-muted-foreground">{nameOf(h.actor_id)} · {formatDistanceToNow(new Date(h.created_at), { addSuffix: true })}</div>
                  </div>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
