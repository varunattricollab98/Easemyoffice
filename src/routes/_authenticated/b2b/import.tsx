import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { guardRoles } from "@/lib/route-guard";
import { getErrorMessage } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Upload,
  CheckCircle2,
  FileSpreadsheet,
  AlertTriangle,
  Copy,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { B2B_SOURCES, labelFor } from "@/lib/b2b";
import { logAudit } from "@/lib/audit";
import {
  listAssignableUsers,
  listFirmDedupeRows,
  listLeadDedupeRows,
  createImportBatch,
  bulkInsertFirms,
  bulkInsertContacts,
  bulkInsertLeads,
  type NewFirm,
  type NewContact,
  type NewB2BLeadRow,
} from "@/lib/b2b-queries";
import {
  classifyRows,
  resolveAssignments,
  countAssigned,
  firmCityKey,
  type AssignmentMode,
  type B2BImportField,
  type DedupeRecord,
  type ImportRow,
} from "@/lib/b2b-import";

export const Route = createFileRoute("/_authenticated/b2b/import")({
  head: () => ({ meta: [{ title: "Import B2B Leads — EaseMyOffice CRM" }] }),
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "b2b"]);
  },
  component: B2BImportPage,
});

// The B2B import fields a CSV column can map to (spec section 7 step 3).
const B2B_FIELDS: { key: B2BImportField; label: string; required?: boolean }[] = [
  { key: "firm_name", label: "Firm Name", required: true },
  { key: "contact_person", label: "Contact Person" },
  { key: "designation", label: "Designation" },
  { key: "phone", label: "Phone" },
  { key: "alt_phone", label: "Alternate Phone" },
  { key: "email", label: "Email" },
  { key: "website", label: "Website" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "full_address", label: "Full Address" },
  { key: "firm_type", label: "Firm Type" },
  { key: "firm_size", label: "Firm Size" },
  { key: "lead_source", label: "Lead Source" },
  { key: "source_url", label: "Source URL" },
];

// Synonyms used to auto-guess the mapping from the CSV headers.
const FIELD_SYNONYMS: Record<B2BImportField, string[]> = {
  firm_name: ["firm name", "ca firm", "firm", "company name", "company", "business name", "name"],
  contact_person: ["contact person", "contact name", "person", "contact", "owner name", "ca name"],
  designation: ["designation", "title", "role", "position"],
  phone: [
    "phone",
    "phone number",
    "mobile",
    "mobile no",
    "contact no",
    "contact number",
    "cont no",
  ],
  alt_phone: ["alternate phone", "alt phone", "alternate number", "secondary phone", "phone 2"],
  email: ["email", "email id", "e-mail", "email address"],
  website: ["website", "web", "url", "site", "web site"],
  city: ["city", "location"],
  state: ["state"],
  full_address: ["full address", "address", "complete address"],
  firm_type: ["firm type", "type"],
  firm_size: ["firm size", "size", "team size"],
  lead_source: ["lead source", "source"],
  source_url: ["source url", "source link", "listing url", "profile url"],
};

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/₹/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9. ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Minimal robust CSV parser: handles quoted fields, escaped quotes, commas and
// newlines inside quotes, CRLF, and a leading BOM. (Copied from the proven
// leads/import.tsx parser.)
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
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

type Parsed = { headers: string[]; rows: string[][] };
type Step = "upload" | "map" | "review" | "assign" | "done";
type ImportSummary = {
  batchId: string;
  total: number;
  newRecords: number;
  duplicates: number;
  invalid: number;
  assigned: number;
  imported: number;
};

function B2BImportPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<B2BImportField, string>>>({});
  const [fileName, setFileName] = useState("");
  const [source, setSource] = useState<string>("ca_directory");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [step, setStep] = useState<Step>("upload");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  // Assignment
  const [assignMode, setAssignMode] = useState<AssignmentMode>("team");
  const [specificUser, setSpecificUser] = useState<string>("");
  const [rrUsers, setRrUsers] = useState<string[]>([]);

  const { data: users = [] } = useQuery({
    queryKey: ["b2b-assignable-users"],
    queryFn: listAssignableUsers,
  });

  const dataRows = useMemo(
    () => (parsed ? parsed.rows.filter((r) => r.some((c) => (c ?? "").trim() !== "")) : []),
    [parsed],
  );

  const headerIndex = useMemo(() => {
    const m: Record<string, number> = {};
    parsed?.headers.forEach((h, i) => {
      m[h] = i;
    });
    return m;
  }, [parsed]);

  const onFile = async (file: File) => {
    setSummary(null);
    setFileName(file.name);
    const text = await file.text();
    const all = parseCSV(text);
    let headerRowIdx = all.findIndex((r) => r.filter((c) => (c ?? "").trim() !== "").length >= 2);
    if (headerRowIdx < 0) headerRowIdx = 0;
    const headerRow = all[headerRowIdx] ?? [];
    const rows = all.slice(headerRowIdx + 1);
    if (headerRow.length === 0 || rows.length === 0) {
      toast.error("That file has no data rows.");
      return;
    }
    const headers = headerRow.map((h) => h.trim());
    // auto-map: exact header matches first, then looser "contains" matches.
    const auto: Partial<Record<B2BImportField, string>> = {};
    const used = new Set<string>();
    for (const f of B2B_FIELDS) {
      const syns = FIELD_SYNONYMS[f.key] ?? [];
      const match = headers.find((h) => !used.has(h) && syns.includes(normalizeHeader(h)));
      if (match) {
        auto[f.key] = match;
        used.add(match);
      }
    }
    for (const f of B2B_FIELDS) {
      if (auto[f.key]) continue;
      const syns = FIELD_SYNONYMS[f.key] ?? [];
      const match = headers.find(
        (h) => !used.has(h) && syns.some((s) => normalizeHeader(h).includes(s)),
      );
      if (match) {
        auto[f.key] = match;
        used.add(match);
      }
    }
    setMapping(auto);
    setParsed({ headers, rows });
    setStep("map");
  };

  // Build the normalised ImportRow[] from the current mapping.
  const importRows = useMemo<ImportRow[]>(() => {
    if (!parsed) return [];
    const get = (cols: string[], field: B2BImportField) => {
      const h = mapping[field];
      if (!h) return "";
      const idx = headerIndex[h];
      return (cols[idx] ?? "").trim();
    };
    return dataRows.map((cols) => {
      const r = {} as ImportRow;
      for (const f of B2B_FIELDS) r[f.key] = get(cols, f.key);
      return r;
    });
  }, [parsed, mapping, dataRows, headerIndex]);

  // Existing records for duplicate detection (firms + leads).
  const { data: existing = [] } = useQuery<DedupeRecord[]>({
    queryKey: ["b2b-dedupe-rows"],
    queryFn: async () => {
      const [firms, leads] = await Promise.all([listFirmDedupeRows(), listLeadDedupeRows()]);
      return [...firms, ...leads];
    },
  });

  const classified = useMemo(() => classifyRows(importRows, existing), [importRows, existing]);

  const hasRequiredMapping = !!mapping.firm_name && (!!mapping.phone || !!mapping.email);

  const runImport = async () => {
    if (!user) return;
    setBusy(true);
    try {
      // Which rows actually get imported: always new; duplicates only when the
      // user chose to import them anyway. Invalid rows are never imported.
      const importable = classified.classifications.filter(
        (c) => c.status === "new" || (c.status === "duplicate" && !skipDuplicates),
      );
      const rowsToImport = importable.map((c) => importRows[c.index]);

      const assignments = resolveAssignments(assignMode, rowsToImport.length, {
        specificUserId: specificUser || null,
        roundRobinUserIds: rrUsers,
      });
      const assignedCount = countAssigned(assignments);

      // 1) Record the batch with the full counts.
      const batch = await createImportBatch({
        source,
        file_name: fileName,
        uploaded_by: user.id,
        total_records: classified.counts.total,
        new_records: classified.counts.new,
        duplicate_records: classified.counts.duplicate,
        invalid_records: classified.counts.invalid,
        assigned_records: assignedCount,
      });

      // 2) Create/dedupe ca_firms (one firm per unique firm_name+city within
      //    this import) and attach a primary contact where we have a name.
      const firmKeyToIndex = new Map<string, number>(); // firmCityKey -> position in uniqueFirms
      const uniqueFirms: NewFirm[] = [];
      const contactSeed: { firmPos: number; row: ImportRow }[] = [];
      rowsToImport.forEach((row, i) => {
        const key = firmCityKey(row.firm_name, row.city) || `__row_${i}`;
        let pos = firmKeyToIndex.get(key);
        if (pos === undefined) {
          pos = uniqueFirms.length;
          firmKeyToIndex.set(key, pos);
          uniqueFirms.push({
            firm_name: row.firm_name.trim(),
            firm_type: row.firm_type || null,
            firm_size: row.firm_size || null,
            website: row.website || null,
            phone: row.phone || null,
            alt_phone: row.alt_phone || null,
            email: row.email || null,
            city: row.city || null,
            state: row.state || null,
            full_address: row.full_address || null,
            lead_source: row.lead_source || source,
            source_url: row.source_url || null,
            partner_status: "potential",
            owner: assignments[i] ?? user.id,
            assigned_to: assignments[i],
            import_batch_id: batch.id,
            created_by: user.id,
          } as NewFirm & { import_batch_id: string });
        }
        if (row.contact_person) contactSeed.push({ firmPos: pos, row });
      });

      // Insert firms in chunks and collect their ids in insertion order.
      const chunk = 200;
      const firmIds: string[] = [];
      for (let i = 0; i < uniqueFirms.length; i += chunk) {
        const created = await bulkInsertFirms(uniqueFirms.slice(i, i + chunk));
        created.forEach((f) => firmIds.push(f.id));
      }

      // 3) Contacts for each firm that had a contact person.
      const contactRows: NewContact[] = contactSeed
        .filter((c) => firmIds[c.firmPos])
        .map((c) => ({
          firm_id: firmIds[c.firmPos],
          name: c.row.contact_person.trim(),
          designation: c.row.designation || null,
          phone: c.row.phone || null,
          alt_phone: c.row.alt_phone || null,
          email: c.row.email || null,
          is_primary: true,
          created_by: user.id,
        }));
      for (let i = 0; i < contactRows.length; i += chunk) {
        await bulkInsertContacts(contactRows.slice(i, i + chunk));
      }

      // 4) b2b_leads — one per imported row, stamped with the batch id + the
      //    firm it maps to and the chosen assigned_to.
      const leadRows: NewB2BLeadRow[] = rowsToImport.map((row, i) => {
        const key = firmCityKey(row.firm_name, row.city) || `__row_${i}`;
        const pos = firmKeyToIndex.get(key);
        return {
          firm_id: pos !== undefined ? (firmIds[pos] ?? null) : null,
          contact_person: row.contact_person || null,
          designation: row.designation || null,
          phone: row.phone || null,
          alt_phone: row.alt_phone || null,
          email: row.email || null,
          website: row.website || null,
          city: row.city || null,
          state: row.state || null,
          full_address: row.full_address || null,
          firm_type: row.firm_type || null,
          firm_size: row.firm_size || null,
          lead_source: row.lead_source || source,
          source_url: row.source_url || null,
          assigned_to: assignments[i],
          lead_status: "new_prospect",
          import_batch_id: batch.id,
          created_by: user.id,
        };
      });
      for (let i = 0; i < leadRows.length; i += chunk) {
        await bulkInsertLeads(leadRows.slice(i, i + chunk));
      }

      logAudit({
        actorId: user.id,
        action: "create",
        entity: "b2b_lead",
        entityId: batch.id,
        entityLabel: `Import ${fileName} (${leadRows.length} leads)`,
      });

      setSummary({
        batchId: batch.id,
        total: classified.counts.total,
        newRecords: classified.counts.new,
        duplicates: classified.counts.duplicate,
        invalid: classified.counts.invalid,
        assigned: assignedCount,
        imported: leadRows.length,
      });
      setStep("done");
      toast.success(`Imported ${leadRows.length} B2B lead${leadRows.length === 1 ? "" : "s"}`);
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, "Import failed"));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setParsed(null);
    setMapping({});
    setFileName("");
    setSummary(null);
    setStep("upload");
    setAssignMode("team");
    setSpecificUser("");
    setRrUsers([]);
  };

  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;

  const dupSamples = classified.classifications.filter((c) => c.status === "duplicate").slice(0, 8);
  const invalidSamples = classified.classifications
    .filter((c) => c.status === "invalid")
    .slice(0, 8);

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-5">
      <div>
        <Link
          to="/b2b/leads"
          className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Back to B2B Leads
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Import B2B Leads</h1>
        <p className="text-sm text-muted-foreground">
          Upload a CSV of CA firms / prospects. Map columns, review duplicates, choose assignment,
          then import.
        </p>
        <div className="mt-2">
          <Link
            to="/b2b/import-history"
            className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
          >
            View import history →
          </Link>
        </div>
      </div>

      <StepIndicator step={step} />

      {step === "done" && summary ? (
        <Card>
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">Import complete</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <Tile label="Total" value={summary.total} />
              <Tile label="New" value={summary.newRecords} tone="emerald" />
              <Tile label="Duplicate" value={summary.duplicates} tone="amber" />
              <Tile label="Invalid" value={summary.invalid} tone="rose" />
              <Tile label="Assigned" value={summary.assigned} tone="blue" />
            </div>
            <div className="text-sm">
              Imported <b>{summary.imported}</b> lead{summary.imported === 1 ? "" : "s"} into this
              batch.
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={() => navigate({ to: "/b2b/import-history" })}>
                View import history
              </Button>
              <Button variant="outline" onClick={() => navigate({ to: "/b2b/leads" })}>
                View B2B leads
              </Button>
              <Button variant="ghost" onClick={reset}>
                Import another file
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : step === "upload" ? (
        <Card>
          <CardContent className="p-8">
            <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-lg p-10 cursor-pointer hover:bg-accent/40">
              <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
              <div className="text-sm font-medium">Click to choose a CSV file</div>
              <div className="text-xs text-muted-foreground">
                Exported from Google Sheets, a CA directory, or Excel
              </div>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                }}
              />
            </label>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Step 2/3: mapping + preview */}
          {step === "map" && parsed && (
            <>
              <Card>
                <CardContent className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm">
                      <b>{fileName}</b> · {dataRows.length} data row
                      {dataRows.length === 1 ? "" : "s"} detected
                    </div>
                    <Button variant="ghost" size="sm" onClick={reset}>
                      Choose another file
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 items-center max-w-sm">
                    <Label className="text-sm">Source</Label>
                    <Select value={source} onValueChange={setSource}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {B2B_SOURCES.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <div className="font-medium text-sm mb-2 flex items-center gap-1">
                      <Sparkles className="h-3.5 w-3.5 text-muted-foreground" /> Map your columns to
                      B2B fields
                    </div>
                    <div className="grid gap-2">
                      {B2B_FIELDS.map((f) => (
                        <div key={f.key} className="grid grid-cols-2 gap-3 items-center">
                          <Label className="text-sm">
                            {f.label}
                            {f.required && <span className="text-destructive"> *</span>}
                          </Label>
                          <select
                            className="h-9 rounded-md border bg-background px-2 text-sm"
                            value={mapping[f.key] ?? ""}
                            onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                          >
                            <option value="">— not mapped —</option>
                            {parsed.headers.map((h, i) => (
                              <option key={`${h}-${i}`} value={h}>
                                {h || `(column ${i + 1})`}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>

                  {!hasRequiredMapping && (
                    <div className="text-sm text-warning">
                      Map <b>Firm Name</b> and at least one of <b>Phone</b> / <b>Email</b> to
                      continue.
                    </div>
                  )}
                </CardContent>
              </Card>

              {hasRequiredMapping && (
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <div className="text-sm font-medium">
                      Preview — first {Math.min(5, importRows.length)} of {importRows.length} rows
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-muted-foreground">
                          <tr>
                            <th className="text-left px-2 py-1">Firm</th>
                            <th className="text-left px-2 py-1">Contact</th>
                            <th className="text-left px-2 py-1">Phone</th>
                            <th className="text-left px-2 py-1">Email</th>
                            <th className="text-left px-2 py-1">City</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importRows.slice(0, 5).map((r, i) => (
                            <tr key={i} className="border-t">
                              <td className="px-2 py-1">{r.firm_name || "—"}</td>
                              <td className="px-2 py-1">{r.contact_person || "—"}</td>
                              <td className="px-2 py-1">{r.phone || "—"}</td>
                              <td className="px-2 py-1">{r.email || "—"}</td>
                              <td className="px-2 py-1">{r.city || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex justify-end">
                      <Button onClick={() => setStep("review")}>Next: validate & dedupe</Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* Step 4/5: validation + duplicate review */}
          {step === "review" && (
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Tile label="Total Records" value={classified.counts.total} />
                  <Tile label="New Records" value={classified.counts.new} tone="emerald" />
                  <Tile
                    label="Possible Duplicates"
                    value={classified.counts.duplicate}
                    tone="amber"
                  />
                  <Tile label="Invalid Records" value={classified.counts.invalid} tone="rose" />
                </div>

                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={skipDuplicates}
                    onCheckedChange={(v) => setSkipDuplicates(!!v)}
                  />
                  Skip possible duplicates (uncheck to import them anyway)
                </label>

                {dupSamples.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-sm font-medium flex items-center gap-1">
                      <Copy className="h-3.5 w-3.5 text-warning" /> Duplicate rows
                    </div>
                    <ul className="text-xs text-muted-foreground list-disc pl-5">
                      {dupSamples.map(
                        (c) =>
                          c.status === "duplicate" && (
                            <li key={c.index}>
                              Row {c.index + 2}: {importRows[c.index].firm_name || "(no firm)"} —
                              matched on {c.matchedOn.join(", ")}
                            </li>
                          ),
                      )}
                    </ul>
                  </div>
                )}

                {invalidSamples.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-sm font-medium flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive" /> Invalid rows (skipped)
                    </div>
                    <ul className="text-xs text-muted-foreground list-disc pl-5">
                      {invalidSamples.map(
                        (c) =>
                          c.status === "invalid" && (
                            <li key={c.index}>
                              Row {c.index + 2}: {c.reasons.join(", ")}
                            </li>
                          ),
                      )}
                    </ul>
                  </div>
                )}

                <div className="flex justify-between">
                  <Button variant="ghost" onClick={() => setStep("map")}>
                    Back
                  </Button>
                  <Button onClick={() => setStep("assign")}>Next: assignment</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 6: assignment */}
          {step === "assign" && (
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="text-sm font-medium">Assignment</div>
                <div className="space-y-3">
                  <AssignRadio
                    checked={assignMode === "specific"}
                    onChange={() => setAssignMode("specific")}
                    label="Assign all to a specific B2B user"
                  >
                    <Select value={specificUser} onValueChange={setSpecificUser}>
                      <SelectTrigger className="w-full max-w-sm mt-2">
                        <SelectValue placeholder="Choose a user" />
                      </SelectTrigger>
                      <SelectContent>
                        {users.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.full_name || u.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </AssignRadio>

                  <AssignRadio
                    checked={assignMode === "team"}
                    onChange={() => setAssignMode("team")}
                    label="Assign to the B2B team (leave unassigned for pool pickup)"
                  />

                  <AssignRadio
                    checked={assignMode === "round_robin"}
                    onChange={() => setAssignMode("round_robin")}
                    label="Round-robin across selected B2B users"
                  >
                    <div className="mt-2 grid gap-1.5 max-w-sm">
                      {users.map((u) => (
                        <label
                          key={u.id}
                          className="flex items-center gap-2 text-sm cursor-pointer"
                        >
                          <Checkbox
                            checked={rrUsers.includes(u.id)}
                            onCheckedChange={(v) =>
                              setRrUsers((prev) =>
                                v ? [...prev, u.id] : prev.filter((x) => x !== u.id),
                              )
                            }
                          />
                          {u.full_name || u.email}
                        </label>
                      ))}
                    </div>
                  </AssignRadio>
                </div>

                <div className="rounded-md border bg-muted/40 p-3 text-sm">
                  Ready to import{" "}
                  <b>
                    {classified.counts.new + (skipDuplicates ? 0 : classified.counts.duplicate)}
                  </b>{" "}
                  record
                  {classified.counts.new + (skipDuplicates ? 0 : classified.counts.duplicate) === 1
                    ? ""
                    : "s"}
                  {skipDuplicates && classified.counts.duplicate > 0 && (
                    <> ({classified.counts.duplicate} duplicate(s) will be skipped)</>
                  )}
                  . Source: <b>{labelFor(B2B_SOURCES, source)}</b>.
                </div>

                <div className="flex justify-between">
                  <Button variant="ghost" onClick={() => setStep("review")}>
                    Back
                  </Button>
                  <Button
                    disabled={
                      busy ||
                      (assignMode === "specific" && !specificUser) ||
                      (assignMode === "round_robin" && rrUsers.length === 0)
                    }
                    onClick={runImport}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {busy ? "Importing…" : "Import"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: "upload", label: "Upload" },
    { id: "map", label: "Map" },
    { id: "review", label: "Review" },
    { id: "assign", label: "Assign" },
    { id: "done", label: "Done" },
  ];
  const order = steps.findIndex((s) => s.id === step);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2">
          <span
            className={
              i <= order
                ? "rounded-full bg-primary text-primary-foreground px-2.5 py-0.5"
                : "rounded-full bg-muted text-muted-foreground px-2.5 py-0.5"
            }
          >
            {i + 1}. {s.label}
          </span>
          {i < steps.length - 1 && <span className="text-muted-foreground">›</span>}
        </div>
      ))}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "amber" | "rose" | "blue";
}) {
  const toneClass =
    tone === "emerald"
      ? "text-success"
      : tone === "amber"
        ? "text-warning"
        : tone === "rose"
          ? "text-destructive"
          : tone === "blue"
            ? "text-primary"
            : "text-foreground";
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className={`text-2xl font-semibold ${toneClass}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function AssignRadio({
  checked,
  onChange,
  label,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`rounded-md border p-3 ${checked ? "border-primary bg-primary/5" : ""}`}>
      <label className="flex items-center gap-2 text-sm cursor-pointer font-medium">
        <input type="radio" checked={checked} onChange={onChange} className="accent-primary" />
        {label}
      </label>
      {checked && children}
    </div>
  );
}
