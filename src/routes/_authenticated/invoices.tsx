import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, FileText, Download } from "lucide-react";
import { useState, useMemo } from "react";
import { format } from "date-fns";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
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
      !t || [b.client_name, b.business_name, b.invoice_number, b.booking_code].some((v: string) =>
        (v ?? "").toLowerCase().includes(t),
      ),
    );
  }, [bookings, search]);

  const generatePdf = (b: any) => {
    try {
      const doc = new jsPDF();
      doc.setFontSize(20);
      doc.text("EaseMyOffice", 14, 20);
      doc.setFontSize(10);
      doc.text("Tax Invoice", 14, 27);
      doc.setFontSize(10);
      doc.text(`Invoice #: ${b.invoice_number || b.booking_code}`, 140, 20);
      doc.text(`Date: ${format(new Date(b.created_at), "dd MMM yyyy")}`, 140, 27);

      doc.setFontSize(11);
      doc.text("Bill To:", 14, 45);
      doc.setFontSize(10);
      doc.text(b.client_name || "", 14, 51);
      if (b.business_name) doc.text(b.business_name, 14, 57);
      if (b.email_id) doc.text(b.email_id, 14, 63);
      doc.text(b.contact_no || "", 14, 69);

      autoTable(doc, {
        startY: 80,
        head: [["Description", "Amount", "GST", "Total"]],
        body: [
          [`${b.plan_name} (${b.vo_plan || "-"})`, formatINR(Number(b.vo_amount || 0)), formatINR(Number(b.vo_gst || 0)), formatINR(Number(b.vo_amount || 0) + Number(b.vo_gst || 0))],
          ...(Number(b.addon_amount) > 0 ? [[
            `Add-ons: ${b.addon_services || ""}`, formatINR(Number(b.addon_amount || 0)), formatINR(Number(b.addon_gst || 0)),
            formatINR(Number(b.addon_amount || 0) + Number(b.addon_gst || 0)),
          ]] : []),
        ],
        foot: [
          ["", "", "Subtotal", formatINR(Number(b.total_amount || 0))],
          ["", "", "TDS", `- ${formatINR(Number(b.tds_amount || 0))}`],
          ["", "", "Net payable", formatINR(Number(b.amount_after_tds || 0))],
        ],
      });

      doc.save(`Invoice-${b.invoice_number || b.booking_code}.pdf`);
      toast.success("Invoice downloaded");
    } catch (e) {
      toast.error("Failed to generate invoice");
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
          ) : filtered.map((b: any) => (
            <div key={b.id} className="p-4 flex flex-wrap items-center gap-3 hover:bg-muted/30">
              <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">
                  {b.invoice_number || b.booking_code}
                  <span className="text-muted-foreground font-normal"> · {b.client_name}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {b.plan_name} · {format(new Date(b.created_at), "MMM d, yyyy")}
                </div>
              </div>
              <Badge variant="secondary">{formatINR(Number(b.total_amount || 0))}</Badge>
              <Button size="sm" variant="outline" onClick={() => generatePdf(b)}>
                <Download className="h-3 w-3 mr-1" /> PDF
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
