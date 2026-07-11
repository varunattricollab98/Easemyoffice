import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Upload, CheckCircle2, FileSpreadsheet } from "lucide-react";
import { SOURCES, SERVICES } from "@/lib/crm";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/leads/import")({
  head: () => ({ meta: [{ title: "Import Leads — EaseMyOffice CRM" }] }),
  component: ImportLeadsPage,
});

// CRM lead fields the CSV columns can map to.
const LEAD_FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: "client_name", label: "Client Name", required: true },
  { key: "mobile", label: "Mobile / Contact No.", required: true },
  { key: "email", label: "Email" },
  { key: "company_name", label: "Business / Company Name" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "source", label: "Source" },
  { key: "service_required", label: "Service" },
  { key: "budget", label: "Budget / Amount (₹)" },
];

// Synonyms used to auto-guess the mapping from the CSV headers.
const FIELD_SYNONYMS: Record<string, string[]> = {
  client_name: ["client name", "name", "contact name", "client", "customer name", "full name"],
  mobile: ["cont no", "cont. no.", "contact no", "contact no.", "contact number", "mobile", "mobile no", "phone", "phone number", "contact"],
  email: ["email id", "email", "e-mail", "email address"],
  company_name: ["business name", "company name", "company", "business", "firm"],
  city: ["city", "location"],
  state: ["state"],
  source: ["booking source", "lead source", "source"],
  service_required: ["service", "service required", "solution type", "solution", "plan name", "vo plan"],
  budget: ["vo amount", "total amount", "revenue", "amount", "budget", "deal value", "value"],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/₹/g, "").replace(/\(.*?\)/g, "").replace(/[^a-z0-9. ]/g, "").replace(/\s+/g, " ").trim();
}

// Minimal robust CSV parser: handles quoted fields, escaped quotes, commas and
// newlines inside quotes, CRLF, and a leading BOM.
function parseCSV(input: string): string[][] {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function mapSource(raw: string): string {
  const n = raw.toLowerCase().trim();
  if (!n) return "website";
  if (n.includes("indiamart") || n.includes("india mart")) return "indiamart";
  if (n.includes("google")) return "google_ads";
  if (n.includes("meta") || n.includes("facebook") || n.includes("insta")) return "meta_ads";
  if (n.includes("whatsapp")) return "whatsapp";
  if (n.includes("refer")) return "referral";
  if (n.includes("website") || n.includes("web")) return "website";
  if (n.includes("email") || n.includes("mail")) return "email";
  if (n.includes("call") || n.includes("direct")) return "direct_call";
  const exact = SOURCES.find((s) => s.label.toLowerCase() === n || s.id === n);
  return exact?.id ?? "other";
}

function mapService(raw: string): string | null {
  const n = raw.toLowerCase().trim();
  if (!n) return null;
  if (n.includes("gst")) return "gst_registration";
  if (n.includes("virtual") || n.includes("vo")) return "virtual_office";
  if (n.includes("apob")) return "apob";
  if (n.includes("iec")) return "iec";
  if (n.includes("trademark") || n.includes("tm")) return "trademark";
  if (n.includes("registration") || n.includes("incorp")) return "business_registration";
  const exact = SERVICES.find((s) => s.label.toLowerCase() === n || s.id === n);
  return exact?.id ?? null;
}

function parseAmount(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

type Parsed = { headers: string[]; rows: string[][] };
type ImportResult = { inserted: number; skipped: number; skippedReasons: string[] };

function ImportLeadsPage() {
  const { isAdmin, hasRole, user, loading } = useAuth();
  const navigate = useNavigate();
  const canImport = isAdmin || hasRole("sales") || hasRole("bd");

  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [appendNotes, setAppendNotes] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState("");

  const dataRows = useMemo(
    () => (parsed ? parsed.rows.filter((r) => r.some((c) => (c ?? "").trim() !== "")) : []),
    [parsed],
  );

  const onFile = async (file: File) => {
    setResult(null);
    setFileName(file.name);
    const text = await file.text();
    const all = parseCSV(text);
    // Skip leading blank/title rows: the header row is the first row that has at
    // least 2 non-empty cells (handles sheets with an empty or merged title row 1).
    let headerRowIdx = all.findIndex((r) => r.filter((c) => (c ?? "").trim() !== "").length >= 2);
    if (headerRowIdx < 0) headerRowIdx = 0;
    const headerRow = all[headerRowIdx] ?? [];
    const rows = all.slice(headerRowIdx + 1);
    if (headerRow.length === 0 || rows.length === 0) { toast.error("That file has no data rows."); return; }
    const headers = headerRow.map((h) => h.trim());
    // auto-map: exact header matches first (avoids e.g. "Business Name" grabbing
    // the "Name" field), then looser "contains" matches. Each header used once.
    const auto: Record<string, string> = {};
    const used = new Set<string>();
    for (const f of LEAD_FIELDS) {
      const syns = FIELD_SYNONYMS[f.key] ?? [];
      const match = headers.find((h) => !used.has(h) && syns.includes(normalizeHeader(h)));
      if (match) { auto[f.key] = match; used.add(match); }
    }
    for (const f of LEAD_FIELDS) {
      if (auto[f.key]) continue;
      const syns = FIELD_SYNONYMS[f.key] ?? [];
      const match = headers.find((h) => !used.has(h) && syns.some((s) => normalizeHeader(h).includes(s)));
      if (match) { auto[f.key] = match; used.add(match); }
    }
    setMapping(auto);
    setParsed({ headers, rows });
  };

  const headerIndex = useMemo(() => {
    const m: Record<string, number> = {};
    parsed?.headers.forEach((h, i) => { m[h] = i; });
    return m;
  }, [parsed]);

  const buildRows = () => {
    const out: any[] = [];
    const skippedReasons: string[] = [];
    let skipped = 0;
    const mappedHeaders = new Set(Object.values(mapping).filter(Boolean));
    const get = (cols: string[], field: string) => {
      const h = mapping[field];
      if (!h) return "";
      const idx = headerIndex[h];
      return (cols[idx] ?? "").trim();
    };
    dataRows.forEach((cols, i) => {
      const client_name = get(cols, "client_name");
      const mobile = get(cols, "mobile");
      if (!client_name || !mobile) {
        skipped++;
        if (skippedReasons.length < 8) skippedReasons.push(`Row ${i + 2}: missing ${!client_name ? "Client Name" : "Mobile"}`);
        return;
      }
      let notes: string | null = null;
      if (appendNotes) {
        const parts: string[] = [];
        parsed!.headers.forEach((h, idx) => {
          if (mappedHeaders.has(h)) return;
          const val = (cols[idx] ?? "").trim();
          if (val) parts.push(`${h}: ${val}`);
        });
        if (parts.length) notes = parts.join("\n");
      }
      // Keep every row's keys identical (so the bulk insert is uniform) and
      // never send null for the required service_required column.
      const lead = {
        client_name,
        mobile,
        email: get(cols, "email") || null,
        company_name: get(cols, "company_name") || null,
        city: get(cols, "city") || null,
        state: get(cols, "state") || null,
        source: mapSource(get(cols, "source")),
        service_required: mapService(get(cols, "service_required")) ?? "virtual_office",
        budget: parseAmount(get(cols, "budget")),
        notes,
        created_by: user?.id ?? null,
      };
      out.push(lead);
    });
    return { out, skipped, skippedReasons };
  };

  const preview = useMemo(() => {
    if (!parsed || !mapping.client_name || !mapping.mobile) return null;
    return buildRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, mapping, appendNotes, dataRows]);

  const runImport = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const { out, skipped, skippedReasons } = preview;
      let inserted = 0;
      const chunkSize = 200;
      for (let i = 0; i < out.length; i += chunkSize) {
        const chunk = out.slice(i, i + chunkSize);
        const { error } = await supabase.from("leads").insert(chunk);
        if (error) throw new Error(error.message);
        inserted += chunk.length;
      }
      setResult({ inserted, skipped, skippedReasons });
      toast.success(`Imported ${inserted} lead${inserted === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error(e.message ?? "Import failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!canImport) return <div className="p-8 text-muted-foreground">You don't have permission to import leads.</div>;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-5">
      <div>
        <Link to="/leads" className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Back to Leads
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Import Leads</h1>
        <p className="text-sm text-muted-foreground">
          Export your Google Sheet as CSV (File → Download → Comma-separated values), then upload it here.
        </p>
      </div>

      {result ? (
        <Card><CardContent className="p-6 space-y-3">
          <div className="flex items-center gap-2 text-emerald-600"><CheckCircle2 className="h-5 w-5" /><span className="font-medium">Import complete</span></div>
          <div className="text-sm">✅ Imported: <b>{result.inserted}</b> leads</div>
          {result.skipped > 0 && (
            <div className="text-sm text-muted-foreground">
              ⚠️ Skipped: <b>{result.skipped}</b> (missing Client Name or Mobile)
              {result.skippedReasons.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs">{result.skippedReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              )}
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <Button onClick={() => navigate({ to: "/leads" })}>View leads</Button>
            <Button variant="outline" onClick={() => { setParsed(null); setResult(null); setMapping({}); setFileName(""); }}>Import another file</Button>
          </div>
        </CardContent></Card>
      ) : !parsed ? (
        <Card><CardContent className="p-8">
          <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-lg p-10 cursor-pointer hover:bg-accent/40">
            <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
            <div className="text-sm font-medium">Click to choose a CSV file</div>
            <div className="text-xs text-muted-foreground">Exported from Google Sheets or Excel</div>
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          </label>
        </CardContent></Card>
      ) : (
        <>
          <Card><CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm"><b>{fileName}</b> · {dataRows.length} data row{dataRows.length === 1 ? "" : "s"} detected</div>
              <Button variant="ghost" size="sm" onClick={() => { setParsed(null); setMapping({}); setFileName(""); }}>Choose another file</Button>
            </div>

            <div>
              <div className="font-medium text-sm mb-2">Map your columns to CRM fields</div>
              <div className="grid gap-2">
                {LEAD_FIELDS.map((f) => (
                  <div key={f.key} className="grid grid-cols-2 gap-3 items-center">
                    <Label className="text-sm">
                      {f.label}{f.required && <span className="text-destructive"> *</span>}
                    </Label>
                    <select
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                      value={mapping[f.key] ?? ""}
                      onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                    >
                      <option value="">— not mapped —</option>
                      {parsed.headers.map((h, i) => <option key={`${h}-${i}`} value={h}>{h || `(column ${i + 1})`}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={appendNotes} onCheckedChange={(v) => setAppendNotes(!!v)} />
              Save all other columns (Booking ID, amounts, payment, etc.) into each lead's Notes
            </label>

            {(!mapping.client_name || !mapping.mobile) && (
              <div className="text-sm text-amber-600">Please map both <b>Client Name</b> and <b>Mobile / Contact No.</b> to continue.</div>
            )}
          </CardContent></Card>

          {preview && (
            <Card><CardContent className="p-4 space-y-3">
              <div className="text-sm font-medium">Preview — first {Math.min(5, preview.out.length)} of {preview.out.length} ready to import
                {preview.skipped > 0 && <span className="text-muted-foreground font-normal"> ({preview.skipped} will be skipped)</span>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground"><tr>
                    <th className="text-left px-2 py-1">Client</th><th className="text-left px-2 py-1">Mobile</th>
                    <th className="text-left px-2 py-1">Company</th><th className="text-left px-2 py-1">City</th>
                    <th className="text-left px-2 py-1">Source</th><th className="text-left px-2 py-1">Budget</th>
                  </tr></thead>
                  <tbody>
                    {preview.out.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1">{r.client_name}</td><td className="px-2 py-1">{r.mobile}</td>
                        <td className="px-2 py-1">{r.company_name ?? "—"}</td><td className="px-2 py-1">{r.city ?? "—"}</td>
                        <td className="px-2 py-1">{r.source}</td><td className="px-2 py-1">{r.budget ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <Button disabled={busy || preview.out.length === 0} onClick={runImport}>
                  <Upload className="h-4 w-4 mr-2" />
                  {busy ? "Importing…" : `Import ${preview.out.length} lead${preview.out.length === 1 ? "" : "s"}`}
                </Button>
              </div>
            </CardContent></Card>
          )}
        </>
      )}
    </div>
  );
}
