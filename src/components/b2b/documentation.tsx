// B2B Documentation — partner onboarding checklist (spec section 17).
//
// Reuses the existing Documentation design (src/routes/_authenticated/
// documentation.tsx): KPI tiles + a workflow table, with the glassy card look.
// Each CA firm has one b2b_onboarding checklist of 8 items (Firm Details,
// Contact Details, Agreement, Required Documents, Partner Terms, Referral
// Process Explained, Communication Setup, Onboarding Completed). The page shows
// Pending / Completed Documents, average TAT and Delayed counts, and lets the
// user tick items inline with a live progress %.
//
// All progress / TAT / delayed maths lives in the pure, tested
// src/lib/b2b-documentation.ts; this component only renders it. Data goes
// through the RLS-scoped onboarding helpers in b2b-queries.ts. Heavy component
// kept out of the route file so it stays code-split.

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, CheckCircle2, Clock, AlertTriangle, Building2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/utils";
import { ONBOARDING_ITEMS, type OnboardingItemId } from "@/lib/b2b";
import { listOnboarding, updateOnboarding, type OnboardingWithFirm } from "@/lib/b2b-queries";
import {
  onboardingProgress,
  summarizeOnboarding,
  DEFAULT_ONBOARDING_TAT_DAYS,
} from "@/lib/b2b-documentation";

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{percent}%</span>
    </div>
  );
}

export function B2BDocumentationPage() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<OnboardingWithFirm | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["b2b-onboarding"],
    queryFn: () => listOnboarding(),
  });

  const summary = useMemo(() => summarizeOnboarding(rows), [rows]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      [r.firm_name, r.firm_city, r.firm_state]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(term)),
    );
  }, [rows, search]);

  async function toggleItem(row: OnboardingWithFirm, item: OnboardingItemId, value: boolean) {
    setSaving(true);
    try {
      const updated = await updateOnboarding(row.id, { [item]: value });
      await qc.invalidateQueries({ queryKey: ["b2b-onboarding"] });
      // Keep the open dialog in sync with the fresh row.
      setEditing((prev) => (prev && prev.id === row.id ? { ...prev, ...updated } : prev));
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
          <FileText className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">B2B Documentation</h1>
          <p className="text-sm text-muted-foreground">
            Partner onboarding checklists per CA firm — progress, turnaround and delays.
          </p>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={Clock}
          label="Pending Documents"
          value={String(summary.pending)}
          tone="text-amber-600"
        />
        <KpiCard
          icon={CheckCircle2}
          label="Completed Documents"
          value={String(summary.completed)}
          tone="text-emerald-600"
        />
        <KpiCard
          icon={FileText}
          label="Avg TAT"
          value={summary.avgTatDays !== null ? `${summary.avgTatDays}d` : "—"}
          hint="completed onboarding"
        />
        <KpiCard
          icon={AlertTriangle}
          label="Delayed Documents"
          value={String(summary.delayed)}
          hint={`open > ${DEFAULT_ONBOARDING_TAT_DAYS}d`}
          tone={summary.delayed ? "text-rose-600" : undefined}
        />
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4">
          <Input
            className="max-w-sm"
            placeholder="Search firm, city, state…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Onboarding Checklists</CardTitle>
          <CardDescription>
            {isAdmin
              ? "Every CA firm's onboarding progress."
              : "Onboarding progress for the firms assigned to you."}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              No onboarding checklists yet. Start one from a CA firm's page.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CA Firm</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>TAT</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => {
                  const p = onboardingProgress(row);
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap">
                        <Link
                          to="/b2b/firms/$id"
                          params={{ id: row.firm_id }}
                          className="inline-flex items-center gap-1 font-medium hover:underline"
                        >
                          <Building2 className="h-3 w-3" />
                          {row.firm_name ?? "Firm"}
                        </Link>
                        {(row.firm_city || row.firm_state) && (
                          <div className="text-xs text-muted-foreground">
                            {[row.firm_city, row.firm_state].filter(Boolean).join(", ")}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <ProgressBar percent={p.percent} />
                        <div className="mt-1 text-xs text-muted-foreground">
                          {p.completed}/{p.total} items
                        </div>
                      </TableCell>
                      <TableCell>
                        {p.isComplete ? (
                          <Badge className="bg-emerald-500 text-white hover:bg-emerald-500">
                            Completed
                          </Badge>
                        ) : p.isDelayed ? (
                          <Badge variant="destructive">Delayed</Badge>
                        ) : (
                          <Badge variant="outline">In Progress</Badge>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {p.tatDays !== null ? `${p.tatDays}d` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setEditing(row)}>
                          Open checklist
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              {editing?.firm_name ?? "Onboarding checklist"}
            </DialogTitle>
            <DialogDescription>
              Tick each item as it is completed. The final item marks the partner onboarded.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <ProgressBar percent={onboardingProgress(editing).percent} />
              <div className="space-y-2">
                {ONBOARDING_ITEMS.map((item) => (
                  <label
                    key={item.id}
                    className="flex items-center gap-3 rounded-lg border p-2.5 text-sm"
                  >
                    <Checkbox
                      checked={editing[item.id] === true}
                      disabled={saving}
                      onCheckedChange={(checked) => toggleItem(editing, item.id, checked === true)}
                    />
                    <span className="flex-1">{item.label}</span>
                    {editing[item.id] === true && (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    )}
                  </label>
                ))}
              </div>
              {saving && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof FileText;
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon className="h-4 w-4" /> {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold tabular-nums ${tone ?? ""}`}>{value}</div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
