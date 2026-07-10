import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Download, FileSpreadsheet, AlertTriangle, BarChart3, Users, Loader2,
  FileText, ExternalLink, Mail,
} from "lucide-react";
import { useAuth, type AppRole } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useState } from "react";
import { STAGES, SERVICES, labelFor } from "@/lib/crm";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
// jsPDF + autotable are lazy-loaded on first export to keep them out of the
// reports route's initial chunk (~250KB minified saved on first paint).

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports — EaseMyOffice CRM" }] }),
  component: ReportsPage,
});

type Lead = {
  id: string; lead_code: string; client_name: string; mobile: string; email: string | null;
  company_name: string | null; service_required: string; stage: string; interest: string;
  score: number; assigned_to: string | null; created_by: string | null;
  next_follow_up_at: string | null; last_activity_at: string; created_at: string;
};
type FollowUp = {
  id: string; lead_id: string; owner_id: string | null; action: string;
  due_at: string; status: string; completed_at: string | null; created_at: string;
};
type Profile = { id: string; full_name: string | null; email: string | null; department: string | null };
type RoleRow = { user_id: string; role: AppRole };

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) { toast.info("No data to export"); return; }
  const headers = Object.keys(rows[0]);
  const body = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(",")),
  ].join("\n");
  const blob = new Blob([`\uFEFF${body}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
async function downloadPDF(filename: string, title: string, subtitle: string, headers: string[], rows: string[][]) {
  if (!rows.length) { toast.info("No data to export"); return; }
  toast.message("Preparing PDF…");
  // Defer to next tick so the toast paints before the heavy chunk loads/parses.
  await new Promise((r) => setTimeout(r, 0));
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFontSize(16); doc.text(title, 40, 40);
  doc.setFontSize(10); doc.setTextColor(120); doc.text(subtitle, 40, 58);
  autoTable(doc, {
    startY: 78,
    head: [headers],
    body: rows,
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
  });
  doc.save(filename);
}
const today = () => new Date().toISOString().slice(0, 10);

function ReportsPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);

  // Global filters
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [serviceFilter, setServiceFilter] = useState<string>("all");

  // Productivity filters
  const [empFilter, setEmpFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    (async () => {
      setLoading(true);
      const [l, f, p, r] = await Promise.all([
        supabase.from("leads").select(
          "id, lead_code, client_name, mobile, email, company_name, service_required, stage, interest, score, assigned_to, created_by, next_follow_up_at, last_activity_at, created_at",
        ),
        supabase.from("follow_ups").select(
          "id, lead_id, owner_id, action, due_at, status, completed_at, created_at",
        ),
        supabase.from("profiles").select("id, full_name, email, department"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      setLeads((l.data ?? []) as Lead[]);
      setFollowUps((f.data ?? []) as FollowUp[]);
      setProfiles((p.data ?? []) as Profile[]);
      setRoles((r.data ?? []) as RoleRow[]);
      setLoading(false);
    })();
  }, [authLoading, isAdmin]);

  if (!authLoading && !isAdmin) return <Navigate to="/dashboard" />;

  const nameOf = (id: string | null) => {
    const p = profiles.find((x) => x.id === id);
    return p?.full_name || p?.email || "—";
  };
  const rolesOf = (uid: string) => roles.filter((r) => r.user_id === uid).map((r) => r.role);

  const fromTs = from ? new Date(from + "T00:00:00").getTime() : null;
  const toTs = to ? new Date(to + "T23:59:59").getTime() : null;

  const inDateRange = (iso: string | null | undefined) => {
    if (!iso) return true;
    const t = new Date(iso).getTime();
    if (fromTs && t < fromTs) return false;
    if (toTs && t > toTs) return false;
    return true;
  };

  // Filtered datasets
  const leadsF = useMemo(() => leads.filter((l) => {
    if (!inDateRange(l.created_at)) return false;
    if (stageFilter !== "all" && l.stage !== stageFilter) return false;
    if (serviceFilter !== "all" && l.service_required !== serviceFilter) return false;
    return true;
  }), [leads, fromTs, toTs, stageFilter, serviceFilter]);

  const followUpsF = useMemo(() => followUps.filter((f) => {
    if (!inDateRange(f.due_at)) return false;
    if (stageFilter !== "all" || serviceFilter !== "all") {
      const lead = leads.find((l) => l.id === f.lead_id);
      if (!lead) return false;
      if (stageFilter !== "all" && lead.stage !== stageFilter) return false;
      if (serviceFilter !== "all" && lead.service_required !== serviceFilter) return false;
    }
    return true;
  }), [followUps, leads, fromTs, toTs, stageFilter, serviceFilter]);

  const now = Date.now();
  const periodLabel = `${from || "all time"} → ${to || "today"}`;

  // KPIs
  const totalLeads = leadsF.length;
  const won = leadsF.filter((l) => l.stage === "completed").length;
  const lost = leadsF.filter((l) => l.stage === "lost").length;
  const conversionRate = totalLeads ? ((won / totalLeads) * 100).toFixed(1) + "%" : "0%";

  // Overdue follow-ups
  const overdue = useMemo(() => followUpsF
    .filter((f) => f.status === "pending" && f.due_at && new Date(f.due_at).getTime() < now)
    .map((f) => {
      const lead = leads.find((l) => l.id === f.lead_id);
      const overdueHrs = Math.round((now - new Date(f.due_at).getTime()) / 3.6e6);
      return {
        lead_id: lead?.id ?? "",
        lead_code: lead?.lead_code ?? "",
        client_name: lead?.client_name ?? "",
        mobile: lead?.mobile ?? "",
        company: lead?.company_name ?? "",
        service: labelFor(SERVICES, lead?.service_required),
        stage: labelFor(STAGES, lead?.stage),
        interest: lead?.interest ?? "",
        score: lead?.score ?? 0,
        action: f.action,
        due_at: new Date(f.due_at).toLocaleString(),
        overdue_hours: overdueHrs,
        owner: nameOf(f.owner_id),
        assigned_to: nameOf(lead?.assigned_to ?? null),
      };
    })
    .sort((a, b) => b.overdue_hours - a.overdue_hours),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [followUpsF]);

  // Pipeline health
  const pipelineHealth = STAGES.map((s) => {
    const inStage = leadsF.filter((l) => l.stage === s.id);
    const hot = inStage.filter((l) => l.interest === "hot").length;
    const stale = inStage.filter((l) => (now - new Date(l.last_activity_at).getTime()) / 8.64e7 > 7).length;
    const overdueCount = inStage.filter((l) => l.next_follow_up_at && new Date(l.next_follow_up_at).getTime() < now).length;
    return {
      stage_id: s.id,
      stage: s.label,
      total_leads: inStage.length,
      hot_leads: hot,
      overdue_followups: overdueCount,
      stale_over_7_days: stale,
      avg_score: inStage.length ? Math.round(inStage.reduce((a, b) => a + (b.score || 0), 0) / inStage.length) : 0,
    };
  });

  // Productivity (filtered)
  const productivity = useMemo(() => {
    const candidates = profiles.filter((p) => {
      if (empFilter !== "all" && p.id !== empFilter) return false;
      if (roleFilter !== "all" && !rolesOf(p.id).includes(roleFilter as AppRole)) return false;
      return true;
    });
    return candidates.map((p) => {
      const myLeads = leadsF.filter((l) => l.assigned_to === p.id);
      const myFus = followUpsF.filter((f) => f.owner_id === p.id);
      const completed = myFus.filter((f) => f.status === "completed").length;
      const overdueFu = myFus.filter((f) => f.status === "pending" && f.due_at && new Date(f.due_at).getTime() < now).length;
      const wonByMe = myLeads.filter((l) => l.stage === "completed").length;
      const lostByMe = myLeads.filter((l) => l.stage === "lost").length;
      const hotByMe = myLeads.filter((l) => l.interest === "hot").length;
      const userRoles = rolesOf(p.id).join(", ") || "—";
      return {
        user_id: p.id,
        employee: p.full_name || p.email || p.id.slice(0, 8),
        email: p.email ?? "",
        role: userRoles,
        department: p.department ?? "",
        assigned_leads: myLeads.length,
        hot_leads: hotByMe,
        followups_total: myFus.length,
        followups_completed: completed,
        followups_overdue: overdueFu,
        conversions_won: wonByMe,
        lost: lostByMe,
        win_rate: myLeads.length > 0 ? ((wonByMe / myLeads.length) * 100).toFixed(1) + "%" : "0%",
      };
    }).filter((r) => r.assigned_leads > 0 || r.followups_total > 0)
      .sort((a, b) => b.conversions_won - a.conversions_won);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, roles, leadsF, followUpsF, empFilter, roleFilter]);

  if (loading || authLoading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const stripIds = <T extends Record<string, unknown>>(rows: T[]) =>
    rows.map((r) => {
      const { lead_id: _l, user_id: _u, stage_id: _s, ...rest } = r as Record<string, unknown>;
      void _l; void _u; void _s;
      return rest;
    });

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Operational Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Filter, export, and email reports. Period: <span className="font-medium">{periodLabel}</span>
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/settings"><Mail className="h-4 w-4 mr-2" />Email schedules</Link>
        </Button>
      </div>

      {/* Global filters */}
      <Card>
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Stage</Label>
            <Select value={stageFilter} onValueChange={setStageFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stages</SelectItem>
                {STAGES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Service</Label>
            <Select value={serviceFilter} onValueChange={setServiceFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All services</SelectItem>
                {SERVICES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* KPI strip with drill-down */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiLink label="Total Leads" value={totalLeads} to="/leads" search={{ stage: stageFilter, service: serviceFilter }} />
        <KpiLink label="Won" value={won} tone="success" to="/leads" search={{ stage: "completed", service: serviceFilter }} />
        <KpiLink label="Lost" value={lost} tone="danger" to="/leads" search={{ stage: "lost", service: serviceFilter }} />
        <KpiLink label="Conversion" value={conversionRate} tone="primary" to="/leads" search={{ stage: "completed", service: serviceFilter }} />
      </div>

      {/* Overdue */}
      <ReportCard
        icon={<AlertTriangle className="h-5 w-5 text-amber-500" />}
        title="Overdue Follow-ups"
        description="All pending follow-ups past due date, sorted by most overdue."
        count={overdue.length} countLabel="overdue" countTone="danger"
        onCSV={() => downloadCSV(`overdue-followups-${today()}.csv`, stripIds(overdue))}
        onPDF={() => downloadPDF(
          `overdue-followups-${today()}.pdf`,
          "Overdue Follow-ups", `Period: ${periodLabel}`,
          ["Lead", "Client", "Action", "Owner", "Stage", "Overdue (hrs)"],
          overdue.map((r) => [r.lead_code, r.client_name, r.action, r.owner, r.stage, String(r.overdue_hours)]),
        )}
      >
        <PreviewTable
          headers={["Lead", "Client", "Action", "Owner", "Overdue", ""]}
          rows={overdue.slice(0, 6).map((r) => [
            r.lead_code, r.client_name, r.action, r.owner,
            `${r.overdue_hours}h`,
            <Link key={r.lead_id} to="/leads/$id" params={{ id: r.lead_id }} className="text-primary hover:underline inline-flex items-center gap-1">
              Open <ExternalLink className="h-3 w-3" />
            </Link>,
          ])}
        />
      </ReportCard>

      {/* Pipeline health */}
      <ReportCard
        icon={<BarChart3 className="h-5 w-5 text-primary" />}
        title="Pipeline Health"
        description="Lead counts, hot leads, overdue follow-ups, and stale leads per stage."
        count={STAGES.length} countLabel="stages"
        onCSV={() => downloadCSV(`pipeline-health-${today()}.csv`, stripIds(pipelineHealth))}
        onPDF={() => downloadPDF(
          `pipeline-health-${today()}.pdf`,
          "Pipeline Health", `Period: ${periodLabel}`,
          ["Stage", "Total", "Hot", "Overdue FU", "Stale 7d+", "Avg Score"],
          pipelineHealth.map((r) => [r.stage, String(r.total_leads), String(r.hot_leads), String(r.overdue_followups), String(r.stale_over_7_days), String(r.avg_score)]),
        )}
      >
        <PreviewTable
          headers={["Stage", "Total", "Hot", "Overdue", "Stale 7d+", ""]}
          rows={pipelineHealth.map((r) => [
            r.stage, String(r.total_leads), String(r.hot_leads),
            String(r.overdue_followups), String(r.stale_over_7_days),
            <Link key={r.stage_id} to="/leads" search={{ stage: r.stage_id }} className="text-primary hover:underline inline-flex items-center gap-1">
              View <ExternalLink className="h-3 w-3" />
            </Link>,
          ])}
        />
      </ReportCard>

      {/* Productivity with extra filters */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5 text-emerald-500" /> Department Productivity
              <Badge variant="secondary">{productivity.length} employees</Badge>
            </CardTitle>
            <CardDescription>Filter by employee or role and export the filtered set.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() =>
              downloadCSV(`team-productivity-${today()}.csv`, stripIds(productivity))
            }>
              <Download className="h-4 w-4 mr-2" /> CSV
            </Button>
            <Button variant="outline" onClick={() => downloadPDF(
              `team-productivity-${today()}.pdf`,
              "Department Productivity", `Period: ${periodLabel}`,
              ["Employee", "Role", "Leads", "Hot", "FU Done", "FU Overdue", "Won", "Win %"],
              productivity.map((r) => [r.employee, r.role, String(r.assigned_leads), String(r.hot_leads), String(r.followups_completed), String(r.followups_overdue), String(r.conversions_won), r.win_rate]),
            )}>
              <FileText className="h-4 w-4 mr-2" /> PDF
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Select value={empFilter} onValueChange={setEmpFilter}>
              <SelectTrigger><SelectValue placeholder="Employee" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All employees</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger><SelectValue placeholder="Role" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {(["admin","sales","documentation","accounts","renewals","bd"] as AppRole[]).map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {productivity.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" /> No matching records.
            </div>
          ) : (
            <PreviewTable
              headers={["Employee", "Role", "Leads", "FU Done", "Overdue", "Won", "Win %", ""]}
              rows={productivity.map((r) => [
                r.employee, r.role, String(r.assigned_leads),
                String(r.followups_completed), String(r.followups_overdue),
                String(r.conversions_won), r.win_rate,
                <Link key={r.user_id} to="/leads" search={{ owner: r.user_id }} className="text-primary hover:underline inline-flex items-center gap-1">
                  Leads <ExternalLink className="h-3 w-3" />
                </Link>,
              ])}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiLink({ label, value, tone, to, search }: {
  label: string; value: string | number; tone?: "primary" | "success" | "danger";
  to: string; search?: Record<string, string>;
}) {
  const toneCls =
    tone === "success" ? "text-emerald-600 dark:text-emerald-400" :
    tone === "danger" ? "text-rose-600 dark:text-rose-400" :
    tone === "primary" ? "text-primary" : "text-foreground";
  return (
    <Link to={to} search={search as never} className="block">
      <Card className="hover:border-primary/50 transition-colors">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
            <ExternalLink className="h-3 w-3 text-muted-foreground" />
          </div>
          <div className={`text-2xl font-bold mt-1 ${toneCls}`}>{value}</div>
        </CardContent>
      </Card>
    </Link>
  );
}

function ReportCard(props: {
  icon: React.ReactNode; title: string; description: string;
  count: number; countLabel: string; countTone?: "danger";
  onCSV: () => void; onPDF: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            {props.icon} {props.title}
            <Badge variant={props.countTone === "danger" ? "destructive" : "secondary"}>
              {props.count} {props.countLabel}
            </Badge>
          </CardTitle>
          <CardDescription>{props.description}</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={props.onCSV}><Download className="h-4 w-4 mr-2" /> CSV</Button>
          <Button variant="outline" onClick={props.onPDF}><FileText className="h-4 w-4 mr-2" /> PDF</Button>
        </div>
      </CardHeader>
      <CardContent>
        {props.count === 0 ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2 py-4">
            <FileSpreadsheet className="h-4 w-4" /> No records.
          </div>
        ) : props.children}
      </CardContent>
    </Card>
  );
}

function PreviewTable({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="text-left px-3 py-2 font-medium text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 truncate max-w-[200px]">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
