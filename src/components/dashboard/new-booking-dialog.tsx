import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { getSheetConfig, syncBookingToSheet } from "@/lib/bookings-sheet";

const SOURCES = ["Website", "Referral", "IndiaMART", "Google Ads", "Meta Ads", "WhatsApp", "Direct", "Other"];
const SP_STATUSES = ["Active", "Pending", "Inactive"];
const PAY_STATUSES = ["Pending", "Paid", "Partial"];
const VO_STATUSES = ["Pending", "Active", "Delivered"];

function genBookingId() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `EMO-BK-${y}${m}${day}-${r}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function salesMonth(dateStr: string) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" }).replace(" ", "-");
}

const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export function NewBookingDialog() {
  const { isAdmin, profile, user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  // Form state
  const [f, setF] = useState({
    date: todayISO(),
    sales_agent: "",
    sales_agent_id: "",
    booking_id: genBookingId(),
    booking_source: "Website",
    plan_name: "",
    vo_plan: "",
    sp_name: "", area: "", city: "", state: "", sp_status: "Active",
    vo_amount: "", addon_services: "", addon_amount: "",
    tds_pct: "0",
    payment_mode_ref: "", payment_id_utr: "", invoice_number: "",
    sp_payable: "", addon_payable: "",
    sp_payment_status: "Pending", vo_status: "Pending",
    business_name: "", client_name: "", email_id: "", contact_no: "",
    alt_contact_no: "", alt_contact_no_2: "",
    remarks: "",
    payment_type: "full" as "full" | "partial",
    amount_received: "",
    balance_due_date: "",
  });

  useEffect(() => {
    setF((s) => ({ ...s, sales_agent: profile?.full_name ?? user?.email ?? "", sales_agent_id: user?.id ?? "" }));
  }, [profile, user]);

  // Team members available to be picked as the sales agent (admin only).
  const { data: teamUsers = [] } = useQuery({
    queryKey: ["booking-team-users"],
    enabled: open && !!isAdmin,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").order("full_name", { ascending: true });
      return data ?? [];
    },
  });

  // Next Booking ID + plans master, read from the Google Sheet.
  // Fetched on mount (so it's ready before the dialog opens) and cached for a
  // few minutes, so opening the form is instant instead of waiting on Google.
  const { data: sheetConfig, isLoading: cfgLoading } = useQuery({
    queryKey: ["booking-sheet-config"],
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: getSheetConfig,
  });
  const plans = sheetConfig?.plans ?? [];

  // When the dialog opens, prefill the next Booking ID from the sheet (if any).
  const [cfgApplied, setCfgApplied] = useState(false);
  useEffect(() => {
    if (!open) { if (cfgApplied) setCfgApplied(false); return; }
    if (!cfgApplied && sheetConfig?.nextBookingId) {
      setF((s) => ({ ...s, booking_id: sheetConfig.nextBookingId as string }));
      setCfgApplied(true);
    }
  }, [open, sheetConfig, cfgApplied]);

  // Selecting a plan code autofills its details from the sheet.
  const applyPlan = (code: string) => {
    const p = plans.find((x) => x.code === code);
    setF((s) => ({
      ...s,
      plan_name: code,
      vo_plan: p?.vo_plan || s.vo_plan,
      sp_name: p?.sp_name || s.sp_name,
      area: p?.area || s.area,
      city: p?.city || s.city,
      state: p?.state || s.state,
      sp_status: p?.sp_status || s.sp_status,
      sp_payable: (p?.sp_payable !== undefined && p?.sp_payable !== null && p?.sp_payable !== "") ? String(p.sp_payable) : s.sp_payable,
    }));
  };

  // Computed values
  const vo = num(f.vo_amount);
  const voGst = +(vo * 0.18).toFixed(2);
  const addOn = num(f.addon_amount);
  const addOnGst = +(addOn * 0.18).toFixed(2);
  const total = +(vo + voGst + addOn + addOnGst).toFixed(2);
  const tdsPct = num(f.tds_pct);
  const tdsAmt = +((total * tdsPct) / 100).toFixed(2);
  const afterTds = +(total - tdsAmt).toFixed(2);
  const spPay = num(f.sp_payable);
  const addOnPay = num(f.addon_payable);
  const profit = +(total - spPay - addOnPay).toFixed(2);
  const month = useMemo(() => salesMonth(f.date), [f.date]);

  // Partial payment computed
  const isPartial = f.payment_type === "partial";
  const amountReceived = isPartial ? num(f.amount_received) : afterTds;
  const balanceAmount = isPartial ? Math.max(0, +(afterTds - amountReceived).toFixed(2)) : 0;

  const submit = useMutation({
    mutationFn: async () => {
      // 1) Save to the database (client-side insert, allowed by RLS for
      //    admin / sales / bd). This always happens.
      const { error } = await supabase.from("bookings").insert({
        external_booking_id: f.booking_id,
        booking_date: f.date,
        sales_agent_id: f.sales_agent_id || user?.id || null,
        sales_agent_name: f.sales_agent,
        booking_source: f.booking_source,
        plan_name: f.plan_name,
        vo_plan: f.vo_plan,
        sp_name: f.sp_name, area: f.area, city: f.city, state: f.state, sp_status: f.sp_status,
        vo_amount: vo, vo_gst: voGst,
        addon_services: f.addon_services, addon_amount: addOn, addon_gst: addOnGst,
        total_amount: total, tds_pct: tdsPct, tds_amount: tdsAmt, amount_after_tds: afterTds,
        payment_mode_ref: f.payment_mode_ref, payment_id_utr: f.payment_id_utr, invoice_number: f.invoice_number,
        sp_payable: spPay, addon_payable: addOnPay, profit,
        sp_payment_status: f.sp_payment_status, vo_status: f.vo_status,
        business_name: f.business_name, client_name: f.client_name,
        email_id: f.email_id, contact_no: f.contact_no,
        alt_contact_no: f.alt_contact_no, alt_contact_no_2: f.alt_contact_no_2,
        remarks: f.remarks, sales_month: month,
        amount_received: amountReceived,
        balance_amount: balanceAmount,
        balance_due_date: isPartial && f.balance_due_date ? f.balance_due_date : null,
        assigned_to: user?.id ?? null,
        created_by: user?.id ?? null,
      });
      if (error) throw new Error(error.message);

      // 2) Best-effort: append the same row to the connected Google Sheet.
      const values = [
        f.date, f.sales_agent, f.booking_id, f.booking_source, f.plan_name, f.vo_plan,
        f.sp_name, f.area, f.city, f.state, f.sp_status,
        vo, voGst, f.addon_services, addOn, addOnGst,
        total, tdsPct, tdsAmt, afterTds,
        f.payment_mode_ref, f.payment_id_utr, f.invoice_number,
        spPay, addOnPay, profit,
        f.sp_payment_status, f.vo_status,
        f.business_name, f.client_name, f.email_id, f.contact_no, f.remarks, month,
        amountReceived, balanceAmount, (isPartial && f.balance_due_date) ? f.balance_due_date : "",
      ];
      const sheet = await syncBookingToSheet(values);
      return { sheet };
    },
    onSuccess: (res) => {
      toast.success("Booking saved" + (res?.sheet?.ok ? " · added to Google Sheet ✓" : ""));
      qc.invalidateQueries({ queryKey: ["bookings"] });
      setOpen(false);
      setF((s) => ({ ...s, booking_id: genBookingId(), plan_name: "", vo_plan: "", vo_amount: "",
        addon_services: "", addon_amount: "", payment_mode_ref: "", payment_id_utr: "", invoice_number: "",
        sp_payable: "", addon_payable: "", business_name: "", client_name: "", email_id: "", contact_no: "", alt_contact_no: "", alt_contact_no_2: "", remarks: "",
        payment_type: "full", amount_received: "", balance_due_date: "" }));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const T = (k: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="h-4 w-4" /> <span className="hidden sm:inline">New Booking</span></Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Booking</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-3">
          {T("date", "Date", { type: "date" })}
          <div>
            <Label className="text-xs">Sales Agent</Label>
            {isAdmin ? (
              <Select
                value={f.sales_agent_id}
                onValueChange={(v) => {
                  const u = (teamUsers as any[]).find((x) => x.id === v);
                  setF({ ...f, sales_agent_id: v, sales_agent: u?.full_name || u?.email || "" });
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
                <SelectContent>
                  {(teamUsers as any[]).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input value={f.sales_agent} readOnly className="bg-muted/40" />
            )}
          </div>
          {T("booking_id", "Booking ID")}

          <div>
            <Label className="text-xs">Booking Source</Label>
            <Select value={f.booking_source} onValueChange={(v) => setF({ ...f, booking_source: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Plan Name</Label>
            {plans.length > 0 ? (
              <>
                <Input
                  list="plan-codes"
                  value={f.plan_name}
                  placeholder="Type to search plan…"
                  onChange={(e) => {
                    const v = e.target.value;
                    const match = plans.find((x) => x.code === v);
                    if (match) applyPlan(v);
                    else setF((s) => ({ ...s, plan_name: v }));
                  }}
                />
                <datalist id="plan-codes">
                  {plans.map((p) => (
                    <option key={p.code} value={p.code} label={[p.sp_name, p.city].filter(Boolean).join(" · ")} />
                  ))}
                </datalist>
              </>
            ) : (
              <Input
                value={f.plan_name}
                placeholder={cfgLoading ? "Loading plans…" : "Plan name"}
                onChange={(e) => setF({ ...f, plan_name: e.target.value })}
              />
            )}
          </div>
          {T("vo_plan", "VO Plan")}

          {T("sp_name", "SP Name")}
          {T("area", "Area")}
          {T("city", "City")}

          {T("state", "State")}
          <div>
            <Label className="text-xs">SP Status</Label>
            <Select value={f.sp_status} onValueChange={(v) => setF({ ...f, sp_status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SP_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {T("vo_amount", "VO Amount (₹)", { type: "number", min: 0, step: "0.01" })}

          <div><Label className="text-xs">VO GST 18% (auto)</Label><Input value={voGst} readOnly className="bg-muted/40" /></div>
          {T("addon_services", "Add on Services")}
          {T("addon_amount", "Add on Amount (₹)", { type: "number", min: 0, step: "0.01" })}

          <div><Label className="text-xs">Add on GST 18% (auto)</Label><Input value={addOnGst} readOnly className="bg-muted/40" /></div>
          <div><Label className="text-xs">Total Amount ₹ (auto)</Label><Input value={total} readOnly className="bg-muted/40 font-medium" /></div>
          {T("tds_pct", "TDS %", { type: "number", min: 0, max: 100, step: "0.01" })}

          <div><Label className="text-xs">TDS Amount ₹ (auto)</Label><Input value={tdsAmt} readOnly className="bg-muted/40" /></div>
          <div><Label className="text-xs">Amount After TDS (auto)</Label><Input value={afterTds} readOnly className="bg-muted/40" /></div>
          {T("payment_mode_ref", "Payment Mode / Ref No.")}

          {T("payment_id_utr", "Payment ID / UTR")}
          {T("invoice_number", "Invoice Number")}
          {T("sp_payable", "SP Payable ₹", { type: "number", min: 0, step: "0.01" })}

          {T("addon_payable", "Add on Payable ₹", { type: "number", min: 0, step: "0.01" })}
          <div><Label className="text-xs">Profit ₹ (auto)</Label>
            <Input value={profit} readOnly className={`bg-muted/40 font-medium ${profit < 0 ? "text-destructive" : ""}`} /></div>
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
          {T("client_name", "Client Name *")}

          {T("email_id", "Email Id", { type: "email" })}
          {T("contact_no", "Contact No. *", { inputMode: "tel" })}
          {T("alt_contact_no", "Alternative Contact No.", { inputMode: "tel" })}

          {T("alt_contact_no_2", "Alternative Contact No. 2", { inputMode: "tel" })}
          <div><Label className="text-xs">Sales Month (auto)</Label><Input value={month} readOnly className="bg-muted/40" /></div>
        </div>

        <div className="mt-3 rounded-md border bg-muted/20 p-3 space-y-3">
          <div className="text-sm font-medium">Payment Received</div>
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <Label className="text-xs">Payment Type</Label>
              <Select value={f.payment_type} onValueChange={(v) => setF({ ...f, payment_type: v as "full" | "partial" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full Payment</SelectItem>
                  <SelectItem value="partial">Partial (e.g. 50%)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isPartial && (
              <>
                {T("amount_received", "Amount Received ₹ *", { type: "number", min: 0, step: "0.01" })}
                <div><Label className="text-xs">Balance ₹ (auto)</Label>
                  <Input value={balanceAmount} readOnly className="bg-muted/40 font-medium text-amber-600" /></div>
                {T("balance_due_date", "Balance Due Date *", { type: "date" })}
              </>
            )}
          </div>
          {isPartial && f.balance_due_date && (
            <div className="text-xs text-muted-foreground">
              ⏰ A WhatsApp + email reminder will be sent to client and sales agent on {f.balance_due_date} for ₹{balanceAmount}.
            </div>
          )}
        </div>

        <div className="mt-2">
          <Label className="text-xs">Remarks</Label>
          <Textarea rows={2} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={submit.isPending || !f.client_name || !f.contact_no || !f.plan_name || !f.vo_amount || (isPartial && (!f.amount_received || !f.balance_due_date))}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? "Saving…" : "Save Booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
