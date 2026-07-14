import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useMemo } from "react";
import { MessageSquare, FileText, Wallet, UserPlus, Phone, Mail, Building2 } from "lucide-react";

const fmtINR = (n: number) => `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const normPhone = (v?: string) => { const d = String(v ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : d; };
const ordinal = (n: number) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const fmtDate = (d: string) => {
  try { return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return d; }
};

type TimelineItem = { date: string; kind: "lead" | "activity" | "booking" | "payment"; title: string; detail?: string; amount?: number };

export function ClientDetailDialog({ client, open, onOpenChange }: { client: any | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const phones: string[] = client?.phones ?? [];
  const email: string = client?.email ?? "";
  const bookingIds: string[] = useMemo(() => (client?.bookings ?? []).map((b: any) => b.id), [client]);

  // Matching leads (first enquiry / source / notes) by phone or email.
  const { data: leads = [] } = useQuery({
    queryKey: ["client-leads", client?.key],
    enabled: open && !!client,
    queryFn: async () => {
      const normed = phones.map(normPhone).filter(Boolean);
      const results: any[] = [];
      if (normed.length) {
        const { data } = await supabase.from("leads").select("id, lead_code, client_name, source, notes, created_at, mobile, alt_mobile, email").in("mobile", phones);
        if (data) results.push(...data);
      }
      if (email) {
        const { data } = await supabase.from("leads").select("id, lead_code, client_name, source, notes, created_at, mobile, alt_mobile, email").eq("email", email);
        if (data) results.push(...data);
      }
      const seen = new Set<string>();
      return results.filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)));
    },
  });

  const leadIds = useMemo(() => (leads as any[]).map((l) => l.id), [leads]);

  const { data: activities = [] } = useQuery({
    queryKey: ["client-lead-activities", client?.key, leadIds.join(",")],
    enabled: open && leadIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("lead_activities").select("id, lead_id, type, title, body, created_at").in("lead_id", leadIds).order("created_at", { ascending: true });
      return data ?? [];
    },
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["client-payments", client?.key, bookingIds.join(",")],
    enabled: open && bookingIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("booking_payments").select("id, booking_id, amount, mode, reference, paid_at, created_at").in("booking_id", bookingIds).order("paid_at", { ascending: true });
      return data ?? [];
    },
  });

  // Build one chronological timeline.
  const timeline = useMemo(() => {
    const items: TimelineItem[] = [];
    for (const l of leads as any[]) {
      items.push({ date: l.created_at, kind: "lead", title: `Enquiry received${l.source ? ` · ${String(l.source).replace(/_/g, " ")}` : ""}`, detail: l.notes || undefined });
    }
    for (const a of activities as any[]) {
      items.push({ date: a.created_at, kind: "activity", title: a.title || String(a.type || "Activity").replace(/_/g, " "), detail: a.body || undefined });
    }
    for (const b of client?.bookings ?? []) {
      items.push({ date: b.booking_date, kind: "booking", title: `Booking ${b.external_booking_id || b.booking_code} created`, detail: `${b.plan_name || "Plan"} · total ${fmtINR(Number(b.amount_after_tds))}` });
    }
    // number payments 1st/2nd/... in date order
    const paySorted = [...(payments as any[])].sort((a, b) => (a.paid_at < b.paid_at ? -1 : 1));
    paySorted.forEach((p, i) => {
      items.push({ date: p.paid_at, kind: "payment", title: `${ordinal(i + 1)} payment received`, detail: `${p.mode || "Payment"}${p.reference ? ` · ${p.reference}` : ""}`, amount: Number(p.amount) });
    });
    return items.sort((a, b) => (new Date(a.date).getTime() - new Date(b.date).getTime()));
  }, [leads, activities, payments, client]);

  if (!client) return null;

  const iconFor = (k: TimelineItem["kind"]) =>
    k === "lead" ? <UserPlus className="h-4 w-4" /> :
    k === "activity" ? <MessageSquare className="h-4 w-4" /> :
    k === "booking" ? <FileText className="h-4 w-4" /> :
    <Wallet className="h-4 w-4" />;

  const dotColor = (k: TimelineItem["kind"]) =>
    k === "lead" ? "bg-blue-500" :
    k === "activity" ? "bg-slate-400" :
    k === "booking" ? "bg-violet-500" :
    "bg-emerald-500";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">{client.name}</DialogTitle>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground pt-1">
            {client.company && <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />{client.company}</span>}
            {phones.map((p, i) => <span key={i} className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{p}</span>)}
            {email && <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{email}</span>}
          </div>
        </DialogHeader>

        {/* Snapshot */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Total Paid</div>
            <div className="text-lg font-bold text-emerald-600">{fmtINR(client.totalPaid)}</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Balance Due</div>
            <div className={`text-lg font-bold ${client.totalBalance > 0 ? "text-amber-600" : ""}`}>{fmtINR(client.totalBalance)}</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Bookings</div>
            <div className="text-lg font-bold">{client.count}</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Client Since</div>
            <div className="text-lg font-bold">{fmtDate(client.firstDate)}</div>
          </div>
        </div>

        {/* Timeline */}
        <div className="mt-2">
          <div className="text-sm font-semibold mb-3">Full History</div>
          {timeline.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">No history recorded yet.</div>
          ) : (
            <div className="relative pl-6">
              <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />
              <div className="space-y-4">
                {timeline.map((it, idx) => (
                  <div key={idx} className="relative">
                    <div className={`absolute -left-[22px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full ${dotColor(it.kind)} ring-4 ring-background`} />
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2">
                        <span className="text-muted-foreground mt-0.5">{iconFor(it.kind)}</span>
                        <div>
                          <div className="text-sm font-medium">
                            {it.title}
                            {it.amount != null && <span className="text-emerald-600 font-semibold"> · {fmtINR(it.amount)}</span>}
                          </div>
                          {it.detail && <div className="text-xs text-muted-foreground whitespace-pre-wrap">{it.detail}</div>}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(it.date)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
