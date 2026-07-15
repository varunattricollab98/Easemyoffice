import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react";

// ─── Column mapping: CSV header → Supabase bookings column ───
// Matches the user's existing Google Sheet (A1 to AF1).
const COL_MAP: Record<string, string> = {
  // Left side
  "remarks": "remarks",
  "date": "booking_date",
  "sales poc": "sales_agent_name",
  "booking id": "external_booking_id",
  "booking source": "booking_source",
  "vo status": "vo_status",
  "vo plan": "vo_plan",
  "location": "area",
  "state": "state",
  "sp name": "sp_name",
  "vo amount": "vo_amount",
  "vo gst": "vo_gst",
  "add on services": "addon_services",
  "add on amouunt": "addon_amount",
  "add on amount": "addon_amount",
  "add on gst": "addon_gst",
  "total amount": "total_amount",
  "tds in % (percentage)": "tds_pct",
  "tds in %": "tds_pct",
  "tds in amount": "tds_amount",
  "amount after tds": "amount_after_tds",
  "payment mode / reffrence no.": "payment_mode_ref",
  "payment mode / reffrence no": "payment_mode_ref",
  "payment mode": "payment_mode_ref",
  "payment id / utr": "payment_id_utr",
  "payment id": "payment_id_utr",
  "invoice number": "invoice_number",
  "sp payable": "sp_payable",
  "add on payable": "addon_payable",
  "profit": "profit",
  "sp payment status": "sp_payment_status",
  "business name": "business_name",
  "client name": "client_name",
  "email id": "email_id",
  "cont. no.": "contact_no",
  "cont no": "contact_no",
  "contact no": "contact_no",
  "sales month": "sales_month",
  // Extras the user might have
  "plan name": "plan_name",
  "city": "city",
  "area": "area",
};

// Numeric fields that should parse as numbers.
const NUMERIC = new Set([
  "vo_amount", "vo_gst", "addon_amount", "addon_gst", "total_amount",
  "tds_pct", "tds_amount", "amount_after_tds", "sp_payable", "addon_payable", "profit",
]);

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || (c === "\r" && text[i + 1] === "\n")) {
        row.push(cell); cell = ""; rows.push(row); row = [];
        if (c === "\r") i++;
      } else cell += c;
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function mapRow(headers: string[], values: string[]) {
  const obj: Record<string, unknown> = {};
  headers.forEach((h, i) => {
    const key = COL_MAP[h.trim().toLowerCase()];
    if (!key) return;
    let val: unknown = (values[i] ?? "").trim();
    if (NUMERIC.has(key)) val = Number(String(val).replace(/[₹,\s]/g, "")) || 0;
    if (key === "booking_date" && val) {
      // Try to normalise date; if it fails, keep as-is.
      const d = new Date(val as string);
      if (!isNaN(d.getTime())) val = d.toISOString().slice(0, 10);
    }
    obj[key] = val;
  });
  // Ensure required fields have defaults.
  if (!obj.client_name) obj.client_name = obj.business_name || "Unknown";
  if (!obj.contact_no) obj.contact_no = "";
  if (!obj.sales_agent_name) obj.sales_agent_name = "—";
  if (!obj.booking_source) obj.booking_source = "Bulk Import";
  if (!obj.plan_name) obj.plan_name = obj.vo_plan || "";
  if (!obj.vo_amount) obj.vo_amount = 0;
  if (!obj.total_amount) obj.total_amount = 0;
  if (!obj.amount_after_tds) obj.amount_after_tds = obj.total_amount;
  // Treat total as amount_received for old bookings (already paid).
  if (!obj.amount_received) obj.amount_received = obj.amount_after_tds || 0;
  if (!obj.balance_amount) obj.balance_amount = 0;
  return obj;
}

export function BulkUploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [step, setStep] = useState<"pick" | "preview" | "done">("pick");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [result, setResult] = useState({ inserted: 0, errors: 0 });

  function onFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSV(text);
      if (parsed.length < 2) { toast.error("CSV has no data rows."); return; }
      const hdrs = parsed[0];
      setHeaders(hdrs);
      const mapped = parsed.slice(1).filter((r) => r.some((c) => c.trim())).map((r) => mapRow(hdrs, r));
      setRows(mapped);
      setStep("preview");
    };
    reader.readAsText(file);
  }

  const upload = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      let inserted = 0, errors = 0;
      // Insert in chunks of 50 to avoid payload size limits.
      const chunks = [];
      for (let i = 0; i < rows.length; i += 50) chunks.push(rows.slice(i, i + 50));
      for (const chunk of chunks) {
        const payload = chunk.map((r) => ({ ...r, created_by: user.id }));
        const { error } = await supabase.from("bookings").insert(payload as any[]);
        if (error) { errors += chunk.length; console.error(error); }
        else inserted += chunk.length;
      }
      return { inserted, errors };
    },
    onSuccess: (r) => {
      setResult(r);
      setStep("done");
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["clients-bookings"] });
      toast.success(`Imported ${r.inserted} bookings` + (r.errors ? ` (${r.errors} failed)` : ""));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function reset() { setStep("pick"); setHeaders([]); setRows([]); setResult({ inserted: 0, errors: 0 }); }

  const previewRows = rows.slice(0, 8);
  const previewCols = ["external_booking_id", "booking_date", "client_name", "business_name", "plan_name", "total_amount", "sales_agent_name"];

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-4xl p-0 flex flex-col max-h-[90vh] gap-0">
        <DialogHeader className="p-5 pb-3 shrink-0 border-b">
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" /> Bulk Upload Bookings (2024/2025 data)</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === "pick" && (
            <div className="text-center py-10 space-y-4">
              <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
              <div className="text-sm text-muted-foreground max-w-md mx-auto">
                Export your old Google Sheet as CSV (<b>File → Download → Comma-separated values</b>),
                then upload it here. The columns will be mapped automatically.
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer rounded-md border px-4 py-2 hover:bg-accent font-medium">
                <FileSpreadsheet className="h-4 w-4" /> Choose CSV file
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
              <div className="text-xs text-muted-foreground">
                This imports into the CRM database <b>only</b> (not the 2026 Google Sheet).
                Your Client Database &amp; analytics will include all the old data.
              </div>
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Preview — {rows.length} bookings found</div>
                <Badge variant="secondary">{headers.length} columns mapped</Badge>
              </div>
              <div className="rounded border overflow-x-auto text-sm">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      {previewCols.map((c) => <TableHead key={c} className="whitespace-nowrap">{c.replace(/_/g, " ")}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        {previewCols.map((c) => <TableCell key={c} className="truncate max-w-[180px]">{String(r[c] ?? "—")}</TableCell>)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {rows.length > 8 && <div className="text-xs text-muted-foreground text-center">…and {rows.length - 8} more rows</div>}
              <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3 text-sm">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <b>This will NOT sync to the 2026 Google Sheet.</b> It only imports into the CRM database
                  (Bookings list + Client Database). Your old sheet stays untouched.
                </div>
              </div>
            </div>
          )}

          {step === "done" && (
            <div className="text-center py-10 space-y-3">
              <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-600" />
              <div className="text-lg font-medium">Import complete</div>
              <div className="text-sm text-muted-foreground">
                {result.inserted} bookings imported successfully.
                {result.errors > 0 && <span className="text-rose-600"> {result.errors} rows failed (check console for details).</span>}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t p-4 gap-2">
          {step === "pick" && <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={reset}>Back</Button>
              <Button disabled={upload.isPending} onClick={() => upload.mutate()}>
                {upload.isPending ? `Importing ${rows.length}…` : `Import ${rows.length} bookings`}
              </Button>
            </>
          )}
          {step === "done" && <Button onClick={() => { onOpenChange(false); reset(); }}>Close</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
