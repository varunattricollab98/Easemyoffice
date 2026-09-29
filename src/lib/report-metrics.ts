// Aggregation for the Sales Reports panel.
//
// Pure functions over already-fetched rows: no Supabase, no React. The panel
// fetches period-filtered rows once and every number on screen is derived here,
// which keeps the definitions in one auditable place and makes the scoring math
// testable (see report-metrics.test.ts).
//
// Row types are structural so they accept the generated Supabase rows without
// importing them, and so a query can select fewer columns than the full table.

import { format } from "date-fns";
import type { ResolvedPeriod } from "@/lib/report-period";

export type LeadRow = {
  id?: string | null;
  assigned_to?: string | null;
  stage?: string | null;
  created_at?: string | null;
  source?: string | null;
};

export type BookingRow = {
  id?: string | null;
  sales_agent_id?: string | null;
  sales_agent_name?: string | null;
  booking_date?: string | null;
  total_amount?: number | string | null;
  amount_after_tds?: number | string | null;
  amount_received?: number | string | null;
  lead_id?: string | null;
};

export type ActivityRow = {
  actor_id?: string | null;
  type?: string | null;
  title?: string | null;
  payload?: unknown;
  created_at?: string | null;
};

export type FollowUpRow = {
  owner_id?: string | null;
  status?: string | null;
  due_at?: string | null;
  completed_at?: string | null;
};

export type ProfileRow = {
  id?: string | null;
  full_name?: string | null;
  email?: string | null;
};

const n = (v: number | string | null | undefined): number => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
};

/** Stages that mean the lead was lost. `irrelevant` exists in the DB but not in the generated types. */
const LOST_STAGES = new Set(["lost", "irrelevant", "not_interested"]);

/**
 * Booking revenue. Mirrors the dashboard's definition (`bookingStatsMonth` in
 * dashboard-queries.ts): net expected receipt after TDS, falling back to the
 * gross total when TDS was never computed. Deliberately NOT `amount_received` —
 * that is cash collected, reported separately, because a partial payment is
 * still a closed sale for the rep's credit.
 */
export function bookingRevenue(b: BookingRow): number {
  return n(b.amount_after_tds) || n(b.total_amount) || 0;
}

/**
 * Whether a timeline row is a quotation send.
 *
 * Quotations are not a first-class event: SendQuotationDialog logs them as
 * `type: "email"` with the title "Sent quotation to <email>". Newer rows also
 * carry `payload.kind === "quotation"`, which is the robust marker; the title
 * check is the fallback that keeps historical rows countable. Checked in that
 * order so the fragile string match can eventually be dropped.
 */
export function isQuotationActivity(a: ActivityRow): boolean {
  if (a.type !== "email") return false;
  const payload = a.payload;
  if (payload && typeof payload === "object") {
    const kind = (payload as Record<string, unknown>).kind;
    if (kind === "quotation") return true;
  }
  return (a.title ?? "").toLowerCase().startsWith("sent quotation to");
}

export type AgentMetrics = {
  id: string;
  name: string;
  leadsAssigned: number;
  closures: number;
  /** Closures provably traceable to a lead via bookings.lead_id (#156 onward). */
  linkedClosures: number;
  revenue: number;
  collected: number;
  avgDeal: number;
  conversionPct: number;
  calls: number;
  whatsapp: number;
  quotations: number;
  emails: number;
  activity: number;
  followupsDone: number;
  followupsOverdue: number;
  disciplinePct: number;
  lost: number;
  productivity: number;
  rank: number;
};

/**
 * Productivity index weights. Exported so the formula is inspectable from the
 * UI (the panel prints them) and tunable in one place rather than being buried
 * in the maths.
 *
 * The split is deliberately outcome-heavy — closures + revenue + conversion is
 * 70% — so that raw call volume cannot outrank someone who actually sells.
 * Activity and follow-up discipline are the remaining 30%: they are leading
 * indicators worth rewarding, but they are also the easiest numbers to inflate.
 */
export const PRODUCTIVITY_WEIGHTS = {
  closures: 0.3,
  revenue: 0.25,
  conversion: 0.15,
  activity: 0.2,
  discipline: 0.1,
} as const;

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * Scores one agent 0-100.
 *
 * Volume measures (closures, revenue, activity) are scored RELATIVE to the best
 * performer in the period, because the business has no configured targets — so
 * the index answers "how does this rep compare to the top rep right now", not
 * "did they hit quota". Two consequences worth knowing before acting on it:
 * the top performer always scores near 100, and a single-rep team trivially
 * scores 100. Ratio measures (conversion, discipline) are already absolute
 * percentages and are used as-is, capped at 100.
 */
function scoreAgent(
  a: AgentMetrics,
  max: { closures: number; revenue: number; activity: number },
): number {
  const rel = (v: number, m: number) => (m > 0 ? Math.min(100, (v / m) * 100) : 0);
  const score =
    rel(a.closures, max.closures) * PRODUCTIVITY_WEIGHTS.closures +
    rel(a.revenue, max.revenue) * PRODUCTIVITY_WEIGHTS.revenue +
    Math.min(100, a.conversionPct) * PRODUCTIVITY_WEIGHTS.conversion +
    rel(a.activity, max.activity) * PRODUCTIVITY_WEIGHTS.activity +
    Math.min(100, a.disciplinePct) * PRODUCTIVITY_WEIGHTS.discipline;
  return Math.round(score);
}

export type TeamMetrics = {
  leadsAssigned: number;
  closures: number;
  linkedClosures: number;
  revenue: number;
  collected: number;
  avgDeal: number;
  conversionPct: number;
  calls: number;
  whatsapp: number;
  quotations: number;
  activity: number;
  followupsDone: number;
  followupsOverdue: number;
  disciplinePct: number;
  lost: number;
  /** Mean of the members' indices — see scoreAgent for what the index means. */
  productivity: number;
  /** Agents with any signal at all in the period. */
  activeAgents: number;
};

export type TrendPoint = { key: string; label: string; closures: number; revenue: number };

export type ReportResult = {
  agents: AgentMetrics[];
  team: TeamMetrics;
  trend: TrendPoint[];
  /** Conversion by lead source, only meaningful for bookings carrying lead_id. */
  bySource: {
    source: string;
    leads: number;
    closures: number;
    revenue: number;
    conversionPct: number;
  }[];
};

export function buildReport(input: {
  leads: LeadRow[];
  bookings: BookingRow[];
  activities: ActivityRow[];
  followUps: FollowUpRow[];
  profiles: ProfileRow[];
  period: ResolvedPeriod;
  now?: Date;
}): ReportResult {
  const { leads, bookings, activities, followUps, profiles, period } = input;
  const now = input.now ?? new Date();

  const nameById = new Map<string, string>();
  // Bookings may only carry the agent's NAME (sales_agent_id is nullable and has
  // no FK), so keep a name→id map to recover the owner rather than dropping the
  // row the way the legacy reports page does.
  const idByName = new Map<string, string>();
  for (const p of profiles) {
    if (!p.id) continue;
    const label = p.full_name || p.email || "Unknown";
    nameById.set(p.id, label);
    if (p.full_name) idByName.set(p.full_name.trim().toLowerCase(), p.id);
    if (p.email) idByName.set(p.email.trim().toLowerCase(), p.id);
  }

  const blank = (id: string): AgentMetrics => ({
    id,
    name: nameById.get(id) ?? "Unknown",
    leadsAssigned: 0,
    closures: 0,
    linkedClosures: 0,
    revenue: 0,
    collected: 0,
    avgDeal: 0,
    conversionPct: 0,
    calls: 0,
    whatsapp: 0,
    quotations: 0,
    emails: 0,
    activity: 0,
    followupsDone: 0,
    followupsOverdue: 0,
    disciplinePct: 0,
    lost: 0,
    productivity: 0,
    rank: 0,
  });

  const map = new Map<string, AgentMetrics>();
  const ensure = (id: string, fallbackName?: string): AgentMetrics => {
    let row = map.get(id);
    if (!row) {
      row = blank(id);
      if (row.name === "Unknown" && fallbackName) row.name = fallbackName;
      map.set(id, row);
    }
    return row;
  };

  // --- Leads assigned -------------------------------------------------------
  // NOTE: `leads` has no assigned_at column, so "assigned in this period" is
  // approximated by leads CREATED in the period that currently sit with this
  // rep. A lead reassigned later is therefore counted against its current
  // owner, not the original one.
  for (const l of leads) {
    if (!l.assigned_to) continue;
    const row = ensure(l.assigned_to);
    row.leadsAssigned++;
    if (l.stage && LOST_STAGES.has(l.stage)) row.lost++;
  }

  // --- Closures / revenue ---------------------------------------------------
  for (const b of bookings) {
    const byId = b.sales_agent_id ?? null;
    const byName = b.sales_agent_name
      ? idByName.get(b.sales_agent_name.trim().toLowerCase())
      : undefined;
    const ownerId = byId || byName;
    if (!ownerId) continue; // unattributable to a person; still counted in team totals below
    const row = ensure(ownerId, b.sales_agent_name ?? undefined);
    row.closures++;
    if (b.lead_id) row.linkedClosures++;
    row.revenue += bookingRevenue(b);
    row.collected += n(b.amount_received);
  }

  // --- Activity -------------------------------------------------------------
  for (const a of activities) {
    if (!a.actor_id) continue;
    const row = ensure(a.actor_id);
    if (a.type === "call") row.calls++;
    else if (a.type === "whatsapp") row.whatsapp++;
    else if (a.type === "email") {
      row.emails++;
      if (isQuotationActivity(a)) row.quotations++;
    }
  }

  // --- Follow-up discipline -------------------------------------------------
  const nowTs = now.getTime();
  for (const f of followUps) {
    if (!f.owner_id) continue;
    const row = ensure(f.owner_id);
    if (f.status === "done") row.followupsDone++;
    else if (f.status === "pending" && f.due_at && new Date(f.due_at).getTime() < nowTs)
      row.followupsOverdue++;
  }

  // --- Derived per-agent ----------------------------------------------------
  for (const row of map.values()) {
    row.activity = row.calls + row.whatsapp + row.quotations;
    row.avgDeal = row.closures > 0 ? Math.round(row.revenue / row.closures) : 0;
    row.conversionPct = pct(row.closures, row.leadsAssigned);
    row.disciplinePct = pct(row.followupsDone, row.followupsDone + row.followupsOverdue);
  }

  const agents = Array.from(map.values());
  const max = {
    closures: Math.max(0, ...agents.map((a) => a.closures)),
    revenue: Math.max(0, ...agents.map((a) => a.revenue)),
    activity: Math.max(0, ...agents.map((a) => a.activity)),
  };
  for (const row of agents) row.productivity = scoreAgent(row, max);

  agents.sort(
    (x, y) =>
      y.productivity - x.productivity ||
      y.revenue - x.revenue ||
      y.closures - x.closures ||
      x.name.localeCompare(y.name),
  );
  agents.forEach((a, i) => (a.rank = i + 1));

  // --- Team ----------------------------------------------------------------
  // Closures and revenue are summed from the RAW bookings, not from the agent
  // rows, so a booking with no identifiable owner still counts towards the
  // team's output instead of vanishing from the headline number.
  const teamClosures = bookings.length;
  const teamRevenue = bookings.reduce((s, b) => s + bookingRevenue(b), 0);
  const teamCollected = bookings.reduce((s, b) => s + n(b.amount_received), 0);
  const teamLeads = leads.filter((l) => !!l.assigned_to).length;
  const sum = (pick: (a: AgentMetrics) => number) => agents.reduce((s, a) => s + pick(a), 0);
  const active = agents.filter(
    (a) => a.leadsAssigned || a.closures || a.activity || a.followupsDone || a.followupsOverdue,
  );
  const teamDone = sum((a) => a.followupsDone);
  const teamOverdue = sum((a) => a.followupsOverdue);

  const team: TeamMetrics = {
    leadsAssigned: teamLeads,
    closures: teamClosures,
    linkedClosures: bookings.filter((b) => !!b.lead_id).length,
    revenue: teamRevenue,
    collected: teamCollected,
    avgDeal: teamClosures > 0 ? Math.round(teamRevenue / teamClosures) : 0,
    conversionPct: pct(teamClosures, teamLeads),
    calls: sum((a) => a.calls),
    whatsapp: sum((a) => a.whatsapp),
    quotations: sum((a) => a.quotations),
    activity: sum((a) => a.activity),
    followupsDone: teamDone,
    followupsOverdue: teamOverdue,
    disciplinePct: pct(teamDone, teamDone + teamOverdue),
    lost: sum((a) => a.lost),
    productivity: active.length > 0 ? Math.round(sum((a) => a.productivity) / active.length) : 0,
    activeAgents: active.length,
  };

  // --- Trend ---------------------------------------------------------------
  const trendMap = new Map<string, TrendPoint>();
  const keyFor = (iso: string) => {
    const d = new Date(iso);
    return period.bucket === "hour" ? format(d, "yyyy-MM-dd HH") : format(d, "yyyy-MM-dd");
  };
  for (const b of bookings) {
    if (!b.booking_date) continue;
    const key = keyFor(b.booking_date);
    let point = trendMap.get(key);
    if (!point) {
      point = {
        key,
        label:
          period.bucket === "hour"
            ? format(new Date(b.booking_date), "HH:mm")
            : format(new Date(b.booking_date), "d MMM"),
        closures: 0,
        revenue: 0,
      };
      trendMap.set(key, point);
    }
    point.closures++;
    point.revenue += bookingRevenue(b);
  }
  const trend = Array.from(trendMap.values()).sort((a, b) => a.key.localeCompare(b.key));

  // --- Conversion by lead source -------------------------------------------
  // Only bookings carrying lead_id can be attributed to a source, so this is
  // accurate for #156-onward data and understates older periods.
  const leadsById = new Map<string, LeadRow>();
  for (const l of leads) if (l.id) leadsById.set(l.id, l);
  const sourceMap = new Map<
    string,
    { source: string; leads: number; closures: number; revenue: number }
  >();
  const ensureSource = (source: string) => {
    let s = sourceMap.get(source);
    if (!s) {
      s = { source, leads: 0, closures: 0, revenue: 0 };
      sourceMap.set(source, s);
    }
    return s;
  };
  for (const l of leads) ensureSource(l.source || "unknown").leads++;
  for (const b of bookings) {
    if (!b.lead_id) continue;
    const lead = leadsById.get(b.lead_id);
    // A booking whose lead falls outside the period still belongs to that
    // lead's source, so fall back to "unknown" rather than skipping it.
    const s = ensureSource(lead?.source || "unknown");
    s.closures++;
    s.revenue += bookingRevenue(b);
  }
  const bySource = Array.from(sourceMap.values())
    .map((s) => ({ ...s, conversionPct: pct(s.closures, s.leads) }))
    .filter((s) => s.leads > 0 || s.closures > 0)
    .sort((a, b) => b.closures - a.closures || b.leads - a.leads);

  return { agents, team, trend, bySource };
}
