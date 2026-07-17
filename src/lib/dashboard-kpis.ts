// Catalog of dashboard KPI cards. Each card maps to a real pipeline stage or a
// computed metric so the numbers always line up with the pipeline board. Users
// pick which cards to show (and reorder them) — see useVisibleKpis + KpiStrip.
import {
  Flame, Bell, AlertTriangle, Target, RefreshCcw, Users, CalendarPlus, Phone,
  ThumbsUp, FileText, Handshake, Repeat, Wallet, BadgeCheck, FileClock, PenLine,
  XCircle, Ban, type LucideIcon,
} from "lucide-react";

// Shape returned by dashboardStatsQuery — what every KPI resolver reads from.
export type KpiStats = {
  newLeads: number;
  total: number;
  pending: number;
  overdue: number;
  hot: number;
  closures: number;
  assignedToday: number;
  renewals: number;
  byStage: Record<string, number>;
};

type Accent = "primary" | "success" | "warning" | "destructive" | "info" | "rose";

export type KpiDef = {
  id: string;
  label: string;
  icon: LucideIcon;
  accent: Accent;
  hint?: string;
  tooltip: string;
  to?: string;
  search?: Record<string, string | undefined>;
  value: (s: KpiStats) => number | undefined;
};

// Count of leads currently sitting in a given pipeline stage.
const stageVal = (stage: string) => (s: KpiStats) => s.byStage[stage] ?? 0;

export const KPI_CATALOG: KpiDef[] = [
  { id: "new_leads", label: "New leads (mo)", icon: Target, accent: "info",
    tooltip: "Leads created this month.", to: "/leads", value: (s) => s.newLeads },
  { id: "new_today", label: "New today", icon: CalendarPlus, accent: "info",
    tooltip: "Leads added today.", to: "/leads", value: (s) => s.assignedToday },
  { id: "hot", label: "Hot leads", icon: Flame, accent: "rose",
    tooltip: "Leads marked as Hot interest.", to: "/leads", search: { interest: "hot" }, value: (s) => s.hot },
  { id: "contacted", label: "Contacted", icon: Phone, accent: "info",
    tooltip: "Leads in the Contacted stage.", to: "/leads", search: { stage: "contacted" }, value: stageVal("contacted") },
  { id: "interested", label: "Interested", icon: ThumbsUp, accent: "info",
    tooltip: "Leads in the Interested stage.", to: "/leads", search: { stage: "interested" }, value: stageVal("interested") },
  { id: "quotation_shared", label: "Quotation shared", icon: FileText, accent: "info",
    tooltip: "Leads with a quotation shared.", to: "/leads", search: { stage: "quotation_shared" }, value: stageVal("quotation_shared") },
  { id: "negotiation", label: "Negotiation", icon: Handshake, accent: "warning",
    tooltip: "Leads currently in negotiation.", to: "/leads", search: { stage: "negotiation" }, value: stageVal("negotiation") },
  { id: "followups", label: "In follow-up", icon: Repeat, accent: "warning",
    tooltip: "Leads in the Followups stage.", to: "/leads", search: { stage: "followups" }, value: stageVal("followups") },
  { id: "ready_to_pay", label: "Ready to pay", icon: Wallet, accent: "warning",
    tooltip: "Leads at Payment Pending — ready to close.", to: "/leads", search: { stage: "payment_pending" }, value: stageVal("payment_pending") },
  { id: "total_bookings", label: "Total bookings", icon: BadgeCheck, accent: "success",
    tooltip: "Leads where payment is received — confirmed bookings.", to: "/leads", search: { stage: "payment_received" }, value: stageVal("payment_received") },
  { id: "documents_pending", label: "Documents pending", icon: FileClock, accent: "warning",
    tooltip: "Bookings waiting on client documents.", to: "/leads", search: { stage: "documents_pending" }, value: stageVal("documents_pending") },
  { id: "draft_shared", label: "Draft shared", icon: FileText, accent: "info",
    tooltip: "Leads with a draft shared.", to: "/leads", search: { stage: "draft_shared" }, value: stageVal("draft_shared") },
  { id: "agreement_signed", label: "Agreement signed", icon: PenLine, accent: "success",
    tooltip: "Leads with a signed agreement.", to: "/leads", search: { stage: "agreement_signed" }, value: stageVal("agreement_signed") },
  { id: "closures", label: "Closures (mo)", icon: Target, accent: "success",
    tooltip: "Deals closed this month (agreement signed or completed).", to: "/leads", search: { stage: "completed" }, value: (s) => s.closures },
  { id: "renewals", label: "Renewals due", icon: RefreshCcw, accent: "warning",
    tooltip: "Leads due for renewal.", to: "/renewals", value: (s) => s.renewals },
  { id: "not_interested", label: "Not interested", icon: XCircle, accent: "destructive",
    tooltip: "Leads marked not interested.", to: "/leads", search: { stage: "not_interested" }, value: stageVal("not_interested") },
  { id: "lost", label: "Lost", icon: Ban, accent: "destructive",
    tooltip: "Lost leads.", to: "/leads", search: { stage: "lost" }, value: stageVal("lost") },
  { id: "pending_followups", label: "Pending follow-ups", icon: Bell, accent: "warning",
    tooltip: "Follow-ups still pending.", to: "/follow-ups", search: { filter: "today" }, value: (s) => s.pending },
  { id: "overdue_followups", label: "Overdue follow-ups", icon: AlertTriangle, accent: "destructive",
    tooltip: "Follow-ups past their due date.", to: "/follow-ups", search: { filter: "overdue" }, value: (s) => s.overdue },
  { id: "total", label: "Total leads", icon: Users, accent: "primary", hint: "All-time",
    tooltip: "Every lead assigned to you.", to: "/leads", value: (s) => s.total },
];

export const KPI_MAP: Record<string, KpiDef> = Object.fromEntries(KPI_CATALOG.map((k) => [k.id, k]));

export type KpiId = string;

// Sensible starting set: meaningful stage-based cards mapped to the pipeline.
// "Ready to pay" replaces the old empty "Overdue"; "Documents pending" and
// "Total bookings" (payment received) surface the parts of the funnel the team
// cares about day to day.
export const DEFAULT_KPIS: KpiId[] = [
  "new_leads", "hot", "ready_to_pay", "documents_pending",
  "total_bookings", "closures", "renewals", "total",
];
