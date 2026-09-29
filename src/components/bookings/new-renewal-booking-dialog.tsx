// Renewal booking creation form, moved out of the old /renewals/bookings route
// when Bookings and Renewal Bookings were merged into one page.
//
// It is NOT the same form as NewBookingDialog: a renewal has no TDS and no
// quoted-price discount (computeBookingMoney is called with tdsPct 0 and
// quotedAmount 0), it stamps renewal_status/renewal_assigned_to so the row is
// identifiable as a renewal, and it syncs to a SEPARATE renewal Google Sheet
// whose column order differs. That is why the two forms stay distinct.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useState } from "react";
import { toast } from "sonner";
import { getSheetPlans } from "@/lib/bookings-sheet";
import { num, salesMonth, computeBookingMoney } from "@/lib/booking-math";

const SOURCES = ["Renewal Call", "Email", "WhatsApp", "Referral", "Walk-in", "Other"];
const PAY_STATUSES = ["Pending", "Paid", "Partial"];
const VO_STATUSES = ["Pending", "Active", "Delivered"];

export function NewRenewalBookingDialog({
  open,
  onClose,
  userId,
}: {
  open: boolean;
  onClose: () => void;
  userId: string | null;
}) {
  const qc = useQueryClient();
  const { isAdmin, profile } = useAuth();

  // Fetched here rather than passed in, so the Bookings page does not have to
  // carry a query it only needs for this dialog's admin-only "Assign To" field.
  const { data: team = [] } = useQuery({
    queryKey: ["renewal-team"],
    staleTime: 5 * 60_000,
    enabled: open && !!isAdmin,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .order("full_name");
      return data ?? [];
    },
  });
  const [f, setF] = useState({
    date: new Date().toISOString().slice(0, 10),
    sales_agent: profile?.full_name ?? "",
    booking_source: "Renewal Call",
    plan_name: "",
    vo_plan: "",
    sp_name: "",
    area: "",
    city: "",
    state: "",
    vo_amount: "",
    addon_services: "",
    addon_amount: "",
    sp_payable: "",
    addon_payable: "",
    payment_mode_ref: "",
    payment_id_utr: "",
    invoice_number: "",
    sp_payment_status: "Pending",
    vo_status: "Pending",
    business_name: "",
    client_name: "",
    email_id: "",
    contact_no: "",
    gst_number: "",
    gst_address: "",
    plan_start_date: "",
    plan_expiry_date: "",
    remarks: "",
    assigned_to: userId ?? "",
    payment_type: "full" as "full" | "partial",
    amount_received: "",
    balance_due_date: "",
  });

  // Calculations
  const vo = num(f.vo_amount);

  // Plans master list from the Google Sheet (same as sales booking form).
  // Shares the sales form's cache entry and, like it, no longer pays for the
  // Booking ID column scan it never used.
  const { data: plansData } = useQuery({
    queryKey: ["booking-sheet-plans"],
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: getSheetPlans,
  });
  const plans = plansData?.plans ?? [];

  // Selecting a plan code autofills its details from the sheet
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
      sp_payable:
        p?.sp_payable !== undefined && p?.sp_payable !== null && p?.sp_payable !== ""
          ? String(p.sp_payable)
          : s.sp_payable,
    }));
  };
  const isPartial = f.payment_type === "partial";
  // Renewals have no TDS or quoted-price discount, so afterTds === total here.
  const _m = computeBookingMoney({
    voAmount: vo,
    addOnAmount: num(f.addon_amount),
    quotedAmount: 0,
    tdsPct: 0,
    spPayable: num(f.sp_payable),
    addOnPayable: num(f.addon_payable),
    isPartial,
    amountReceived: num(f.amount_received),
  });
  const voGst = _m.voGst;
  const addOn = _m.addOn;
  const addOnGst = _m.addOnGst;
  const totalWithGst = _m.total;
  const spPay = _m.spPay;
  const addOnPay = _m.addOnPay;
  // Profit = (VO + Add-on) - SP Payable - Add-on Payable — WITHOUT GST
  const profit = _m.profit;
  const amountReceived = _m.amountReceived;
  const balanceAmount = _m.balanceAmount;

  const reset = () =>
    setF({
      date: new Date().toISOString().slice(0, 10),
      sales_agent: profile?.full_name ?? "",
      booking_source: "Renewal Call",
      plan_name: "",
      vo_plan: "",
      sp_name: "",
      area: "",
      city: "",
      state: "",
      vo_amount: "",
      addon_services: "",
      addon_amount: "",
      sp_payable: "",
      addon_payable: "",
      payment_mode_ref: "",
      payment_id_utr: "",
      invoice_number: "",
      sp_payment_status: "Pending",
      vo_status: "Pending",
      business_name: "",
      client_name: "",
      email_id: "",
      contact_no: "",
      gst_number: "",
      gst_address: "",
      plan_start_date: "",
      plan_expiry_date: "",
      remarks: "",
      assigned_to: userId ?? "",
      payment_type: "full",
      amount_received: "",
      balance_due_date: "",
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
        plan_name: f.plan_name,
        vo_plan: f.vo_plan,
        sp_name: f.sp_name,
        area: f.area,
        city: f.city,
        state: f.state,
        vo_amount: vo,
        vo_gst: voGst,
        addon_services: f.addon_services,
        addon_amount: addOn,
        addon_gst: addOnGst,
        total_amount: totalWithGst,
        sp_payable: spPay,
        addon_payable: addOnPay,
        profit,
        payment_mode_ref: f.payment_mode_ref,
        payment_id_utr: f.payment_id_utr,
        invoice_number: f.invoice_number,
        sp_payment_status: f.sp_payment_status,
        vo_status: f.vo_status,
        business_name: f.business_name,
        client_name: f.client_name,
        email_id: f.email_id,
        contact_no: f.contact_no,
        gst_number: f.gst_number || null,
        gst_address: f.gst_address || null,
        plan_start_date: f.plan_start_date || null,
        plan_expiry_date: f.plan_expiry_date || null,
        remarks: f.remarks,
        amount_received: amountReceived,
        balance_amount: balanceAmount,
        balance_due_date: isPartial && f.balance_due_date ? f.balance_due_date : null,
        renewal_status: "renewed",
        renewal_assigned_to: f.assigned_to || userId,
        renewal_stage_changed_at: new Date().toISOString(),
        assigned_to: userId,
        created_by: userId,
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
      const salesMonthLabel = salesMonth(f.date);
      const values = [
        f.date,
        f.sales_agent,
        "",
        f.booking_source,
        f.plan_name,
        f.vo_plan,
        f.sp_name,
        f.area,
        f.city,
        f.state,
        "",
        vo,
        voGst,
        f.addon_services,
        addOn,
        addOnGst,
        totalWithGst,
        0,
        0,
        totalWithGst,
        f.payment_mode_ref,
        f.payment_id_utr,
        f.invoice_number,
        spPay,
        addOnPay,
        profit,
        f.sp_payment_status,
        f.vo_status,
        f.business_name,
        f.client_name,
        f.email_id,
        f.contact_no,
        f.remarks,
        salesMonthLabel,
        amountReceived,
        balanceAmount,
        f.balance_due_date || "",
      ];
      const sheet = await syncRenewalToSheet(values);
      return { sheet };
    },
    onSuccess: (res) => {
      toast.success("Renewal booking saved" + (res?.sheet?.ok ? " · added to Sheet ✓" : ""));
      reset();
      onClose();
      // "bookings" is the merged list this dialog now feeds; the renewal keys
      // are kept for the renewal pipeline/leads pages that still read them.
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["renewal-bookings-list"] });
      qc.invalidateQueries({ queryKey: ["renewal-bookings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const T = (
    k: keyof typeof f,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Renewal Booking</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-3">
          {T("date", "Date", { type: "date" })}
          {T("sales_agent", "Renewal Agent")}
          <div>
            <Label className="text-xs">Booking Source</Label>
            <Select
              value={f.booking_source}
              onValueChange={(v) => setF({ ...f, booking_source: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Plan Name</Label>
            {plans.length > 0 ? (
              <>
                <Input
                  list="renewal-plan-codes"
                  value={f.plan_name}
                  placeholder="Type to search plan…"
                  onChange={(e) => {
                    const v = e.target.value;
                    const match = plans.find((x) => x.code === v);
                    if (match) applyPlan(v);
                    else setF((s) => ({ ...s, plan_name: v }));
                  }}
                />
                <datalist id="renewal-plan-codes">
                  {plans.map((p) => (
                    <option
                      key={p.code}
                      value={p.code}
                      label={[p.sp_name, p.city].filter(Boolean).join(" · ")}
                    />
                  ))}
                </datalist>
              </>
            ) : (
              <Input
                value={f.plan_name}
                placeholder="Plan name"
                onChange={(e) => setF({ ...f, plan_name: e.target.value })}
              />
            )}
          </div>
          {T("vo_plan", "VO Plan")}
          {T("sp_name", "SP Name")}
          {T("area", "Area")}
          {T("city", "City")}
          {T("state", "State")}
          {T("vo_amount", "VO Amount (₹) *", { type: "number", min: 0 })}
          <div>
            <Label className="text-xs">VO GST 18% (auto)</Label>
            <Input value={voGst} readOnly className="bg-muted/40" />
          </div>
          {T("addon_services", "Add-on Services")}
          {T("addon_amount", "Add-on Amount (₹)", { type: "number", min: 0 })}
          <div>
            <Label className="text-xs">Add-on GST 18% (auto)</Label>
            <Input value={addOnGst} readOnly className="bg-muted/40" />
          </div>
          <div>
            <Label className="text-xs">Total with GST (auto)</Label>
            <Input value={totalWithGst} readOnly className="bg-muted/40 font-medium" />
          </div>
          {T("sp_payable", "SP Payable ₹", { type: "number", min: 0 })}
          {T("addon_payable", "Add-on Payable ₹", { type: "number", min: 0 })}
          <div>
            <Label className="text-xs">Profit (without GST) (auto)</Label>
            <Input
              value={profit}
              readOnly
              className={`bg-muted/40 font-medium ${profit < 0 ? "text-destructive" : "text-emerald-600"}`}
            />
          </div>
          {T("payment_mode_ref", "Payment Mode / Ref")}
          {T("payment_id_utr", "Payment ID / UTR")}
          {T("invoice_number", "Invoice Number")}
          <div>
            <Label className="text-xs">SP Payment Status</Label>
            <Select
              value={f.sp_payment_status}
              onValueChange={(v) => setF({ ...f, sp_payment_status: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAY_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">VO Status</Label>
            <Select value={f.vo_status} onValueChange={(v) => setF({ ...f, vo_status: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VO_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {T("business_name", "Business Name")}
          {T("client_name", "Client Name *")}
          {T("email_id", "Email", { type: "email" })}
          {T("contact_no", "Contact No. *", { inputMode: "tel" })}
          {T("gst_number", "GST Number", { placeholder: "e.g. 06AANFN9510H1Z3" })}
          <div className="md:col-span-2">
            <Label className="text-xs">GST Address (for invoice)</Label>
            <Textarea
              rows={2}
              value={f.gst_address}
              onChange={(e) => setF({ ...f, gst_address: e.target.value })}
              placeholder="Client billing address as it should appear on the tax invoice"
            />
          </div>
          {T("plan_start_date", "Plan Start Date", { type: "date" })}
          {T("plan_expiry_date", "Plan Expiry Date", { type: "date" })}
          {isAdmin && (
            <div>
              <Label className="text-xs">Assign To</Label>
              <Select value={f.assigned_to} onValueChange={(v) => setF({ ...f, assigned_to: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Assign…" />
                </SelectTrigger>
                <SelectContent>
                  {team.map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.full_name || t.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="mt-3 rounded-md border bg-muted/20 p-3 space-y-3">
          <div className="text-sm font-medium">Payment Received</div>
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <Label className="text-xs">Payment Type</Label>
              <Select
                value={f.payment_type}
                onValueChange={(v) => setF({ ...f, payment_type: v as "full" | "partial" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full Payment</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isPartial && (
              <>
                {T("amount_received", "Amount Received ₹", { type: "number", min: 0 })}
                <div>
                  <Label className="text-xs">Balance (auto)</Label>
                  <Input
                    value={balanceAmount}
                    readOnly
                    className="bg-muted/40 text-amber-600 font-medium"
                  />
                </div>
                {T("balance_due_date", "Balance Due Date", { type: "date" })}
              </>
            )}
          </div>
        </div>
        <div className="mt-2">{T("remarks", "Remarks")}</div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={submit.isPending || !f.client_name || !f.vo_amount}
            onClick={() => submit.mutate()}
          >
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
    const { data, error } = await supabase.functions.invoke("sync-renewal-to-sheet", {
      body: { values },
    });
    if (error) return { ok: false };
    return { ok: data?.ok ?? false };
  } catch {
    return { ok: false };
  }
}
