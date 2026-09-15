import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, FileText, Download, FilePlus2, Send, Loader2, CheckCircle2 } from "lucide-react";
import { useState, useMemo } from "react";
import { format } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/invoices")({
  head: () => ({ meta: [{ title: "Invoices — EaseMyOffice CRM" }] }),
  component: InvoicesPage,
});

function formatINR(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function InvoicesPage() {
  const [search, setSearch] = useState("");
  const qc = useQueryClient();
  // Per-booking in-flight action ("create" | "send" | "pdf") so only the
  // clicked row's button spins.
  const [busy, setBusy] = useState<Record<string, string | undefined>>({});

  const { data: bookings = [] } = useQuery({
    queryKey: ["invoices-bookings"],
    queryFn: async () => {
      const { data } = await supabase.from("bookings").select("*").order("created_at", { ascending: false }).limit(500);
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    return bookings.filter((b: any) =>
      !t || [b.client_name, b.business_name, b.invoice_number, b.zoho_invoice_number, b.booking_code, b.external_booking_id].some((v: string) =>
        (v ?? "").toLowerCase().includes(t),
      ),
    );
  }, [bookings, search]);

  const setRowBusy = (id: string, v?: string) => setBusy((s) => ({ ...s, [id]: v }));

  // Create the invoice in Zoho Books for this booking.
  const createInvoice = async (b: any) => {
    setRowBusy(b.id, "create");
    try {
      const { data, error } = await supabase.functions.invoke("zoho-invoice", {
        body: { action: "create", booking_id: b.id },
      });
      if (error) throw new Error(error.message || "Function call failed");
      if (!data?.ok) throw new Error(data?.error || "Could not create invoice");
      toast.success(
        data.already
          ? "Invoice already exists"
          : `Invoice ${data.invoice_number || ""} created in Zoho`,
      );
      await qc.invalidateQueries({ queryKey: ["invoices-bookings"] });
    } catch (e: any) {
      toast.error(e.message || "Could not create invoice");
    } finally {
      setRowBusy(b.id, undefined);
    }
  };

  // Email the created invoice to the client via Zoho.
  const sendInvoice = async (b: any) => {
    setRowBusy(b.id, "send");
    try {
      const { data, error } = await supabase.functions.invoke("zoho-invoice", {
        body: { action: "send", booking_id: b.id },
      });
      if (error) throw new Error(error.message || "Function call failed");
      if (!data?.ok) throw new Error(data?.error || "Could not send invoice");
      toast.success(`Invoice sent to ${data.to}`);
      await qc.invalidateQueries({ queryKey: ["invoices-bookings"] });
    } catch (e: any) {
      toast.error(e.message || "Could not send invoice");
    } finally {
      setRowBusy(b.id, undefined);
    }
  };

  // Download the official Zoho PDF (fetched server-side, returned base64).
  const downloadPdf = async (b: any) => {
    setRowBusy(b.id, "pdf");
    try {
      const { data, error } = await supabase.functions.invoke("zoho-invoice", {
        body: { action: "pdf", booking_id: b.id },
      });
      if (error) throw new Error(error.message || "Function call failed");
      if (!data?.ok) throw new Error(data?.error || "Could not fetch PDF");
      const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename || "invoice.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e.message || "Could not fetch PDF");
    } finally {
      setRowBusy(b.id, undefined);
    }
  };

  const totalRevenue = useMemo(() =>
    filtered.reduce((s: number, b: any) => s + Number(b.total_amount || 0), 0), [filtered]);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Invoices</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} invoices · Total {formatINR(totalRevenue)}</p>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search invoices…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card>
        <CardContent className="p-0 divide-y">
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">No invoices yet. Create a booking to generate one.</div>
          ) : filtered.map((b: any) => {
            const hasInvoice = !!b.zoho_invoice_id;
            const rowBusy = busy[b.id];
            const sent = !!b.zoho_invoice_sent_at;
            return (
              <div key={b.id} className="p-4 flex flex-wrap items-center gap-3 hover:bg-muted/30">
                <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">
                    {b.zoho_invoice_number || b.invoice_number || b.external_booking_id || b.booking_code}
                    <span className="text-muted-foreground font-normal"> · {b.client_name}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {b.plan_name} · {format(new Date(b.created_at), "MMM d, yyyy")}
                    {sent && <span className="text-emerald-600"> · Sent ✓</span>}
                  </div>
                </div>
                <Badge variant="secondary">{formatINR(Number(b.total_amount || 0))}</Badge>

                {!hasInvoice ? (
                  <Button size="sm" onClick={() => createInvoice(b)} disabled={rowBusy === "create"}>
                    {rowBusy === "create" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FilePlus2 className="h-3 w-3 mr-1" />}
                    Create Invoice
                  </Button>
                ) : (
                  <>
                    <Button size="sm" variant={sent ? "outline" : "default"} onClick={() => sendInvoice(b)} disabled={rowBusy === "send"}>
                      {rowBusy === "send" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : sent ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <Send className="h-3 w-3 mr-1" />}
                      {sent ? "Resend" : "Send to Client"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => downloadPdf(b)} disabled={rowBusy === "pdf"}>
                      {rowBusy === "pdf" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
                      PDF
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
