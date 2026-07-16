// Shared TanStack Query factories for the dashboard.
// Used by widgets AND prefetched in the route loader so navigating to
// /dashboard arrives with hot caches.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/lib/auth";

// Per-user dashboard scoping.
// - Admins + cross-team roles (documentation/accounts/renewals) see everything.
// - Everyone else (sales / bd / roleless) sees only leads they own
//   (assigned_to = me OR created_by = me).
export type DashboardScope = { uid: string | null; scoped: boolean };

const CROSS_TEAM_ROLES: AppRole[] = ["documentation", "accounts", "renewals"];

function computeScope(uid: string | null, roles: AppRole[]): DashboardScope {
  const crossTeam = roles.includes("admin") || roles.some((r) => CROSS_TEAM_ROLES.includes(r));
  return { uid, scoped: !crossTeam && !!uid };
}

// Stable cache-key fragment so each scope caches separately.
const scopeKey = (s: DashboardScope) => (s.scoped && s.uid ? `mine:${s.uid}` : "all");

// Restrict a leads query to "my leads" when scoped. `.or(...)` combines with any
// existing filters using AND, so e.g. `.eq(stage).or(mine)` => stage AND mine.
function scopeLeads<Q>(q: Q, s: DashboardScope): Q {
  if (s.scoped && s.uid) {
    return (q as unknown as { or: (f: string) => Q }).or(`assigned_to.eq.${s.uid},created_by.eq.${s.uid}`);
  }
  return q;
}

// Hook for widgets to read the current user's dashboard scope.
export function useDashboardScope(): DashboardScope {
  const { user, roles, isAdmin } = useAuth();
  return computeScope(user?.id ?? null, isAdmin ? ["admin", ...roles] : roles);
}

// Loader-side (non-React) scope resolver, so prefetched queries use the same
// cache keys as the widgets that render them.
export async function resolveScope(): Promise<DashboardScope> {
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user?.id ?? null;
  if (!uid) return { uid: null, scoped: false };
  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", uid);
  const roles = ((roleRows ?? []) as { role: AppRole }[]).map((r) => r.role);
  return computeScope(uid, roles);
}

export const dashboardStatsQuery = (scope: DashboardScope) =>
  queryOptions({
    queryKey: ["dashboard-stats", scopeKey(scope)] as const,
    staleTime: 30_000,
    queryFn: async () => {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const now = new Date();
      const [a, b, c, d, e, f, g] = await Promise.all([
        scopeLeads(supabase.from("leads").select("id", { count: "exact", head: true }).gte("created_at", startOfMonth.toISOString()), scope),
        scopeLeads(supabase.from("leads").select("id", { count: "exact", head: true }).eq("interest", "hot"), scope),
        supabase.from("follow_ups").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("follow_ups").select("id", { count: "exact", head: true }).eq("status", "pending").lt("due_at", now.toISOString()),
        scopeLeads(supabase.from("leads").select("id", { count: "exact", head: true }).in("stage", ["agreement_signed", "completed"]).gte("updated_at", startOfMonth.toISOString()), scope),
        scopeLeads(supabase.from("leads").select("id", { count: "exact", head: true }).eq("stage", "renewal_due"), scope),
        scopeLeads(supabase.from("leads").select("id", { count: "exact", head: true }), scope),
      ]);
      return {
        newLeads: a.count ?? 0, hot: b.count ?? 0, pending: c.count ?? 0,
        overdue: d.count ?? 0, closures: e.count ?? 0, renewals: f.count ?? 0,
        total: g.count ?? 0,
      };
    },
  });

export const heroTodayQuery = (scope: DashboardScope) =>
  queryOptions({
    queryKey: ["hero-today", scopeKey(scope)] as const,
    staleTime: 30_000,
    queryFn: async () => {
      const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const startOfYesterday = new Date(startOfDay.getTime() - 86400_000);
      const endOfYesterday = new Date(startOfDay.getTime() - 1);
      const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
      const trendDays = 30;
      const trendStart = new Date(Date.now() - trendDays * 86400_000);
      trendStart.setHours(0, 0, 0, 0);
      const nowIso = new Date().toISOString();

      const [closures, today, yesterday, hot, dueToday, doneToday, monthLeads, trend] = await Promise.all([
        scopeLeads(supabase.from("leads").select("id", { count: "exact", head: true })
          .in("stage", ["agreement_signed", "completed"])
          .gte("updated_at", startOfMonth.toISOString()), scope),
        scopeLeads(supabase.from("leads").select("id", { count: "exact", head: true })
          .gte("created_at", startOfDay.toISOString()), scope),
        scopeLeads(supabase.from("leads").select("id", { count: "exact", head: true })
          .gte("created_at", startOfYesterday.toISOString())
          .lte("created_at", endOfYesterday.toISOString()), scope),
        scopeLeads(supabase.from("leads").select("id", { count: "exact", head: true }).eq("interest", "hot"), scope),
        supabase.from("follow_ups").select("id", { count: "exact", head: true })
          .eq("status", "pending")
          .gte("due_at", startOfDay.toISOString())
          .lte("due_at", endOfDay.toISOString()),
        supabase.from("follow_ups").select("id", { count: "exact", head: true })
          .eq("status", "done")
          .gte("updated_at", startOfDay.toISOString())
          .lte("updated_at", nowIso),
        scopeLeads(supabase.from("leads").select("id", { count: "exact", head: true })
          .gte("created_at", startOfMonth.toISOString()), scope),
        scopeLeads(supabase.from("leads").select("created_at, stage, updated_at")
          .gte("created_at", trendStart.toISOString())
          .limit(5000), scope),
      ]);

      // Build per-day buckets for the full 30-day window.
      const newBuckets = Array(trendDays).fill(0);
      const closeBuckets = Array(trendDays).fill(0);
      const startMs = trendStart.getTime();
      (trend.data ?? []).forEach((r: { created_at: string; stage: string; updated_at: string }) => {
        const dCreate = Math.floor((new Date(r.created_at).getTime() - startMs) / 86400_000);
        if (dCreate >= 0 && dCreate < trendDays) newBuckets[dCreate]++;
        if (r.stage === "agreement_signed" || r.stage === "completed") {
          const dClose = Math.floor((new Date(r.updated_at).getTime() - startMs) / 86400_000);
          if (dClose >= 0 && dClose < trendDays) closeBuckets[dClose]++;
        }
      });
      // Day labels (ISO date) aligned with the buckets.
      const trendDates: string[] = Array.from({ length: trendDays }, (_, i) => {
        const d = new Date(startMs + i * 86400_000);
        return d.toISOString().slice(0, 10);
      });

      const closuresN = closures.count ?? 0;
      const monthLeadsN = monthLeads.count ?? 0;
      const conversion = monthLeadsN > 0 ? Math.round((closuresN / monthLeadsN) * 100) : 0;
      const todayN = today.count ?? 0;
      const yesterdayN = yesterday.count ?? 0;
      const delta = todayN - yesterdayN;

      return {
        closures: closuresN,
        today: todayN,
        yesterday: yesterdayN,
        delta,
        hot: hot.count ?? 0,
        dueToday: dueToday.count ?? 0,
        doneToday: doneToday.count ?? 0,
        conversion,
        monthLeads: monthLeadsN,
        trendNew: newBuckets,
        trendClose: closeBuckets,
        trendDates,
        trendMax: Math.max(1, ...newBuckets, ...closeBuckets),
      };
    },
  });

export const needsAttentionQuery = (scope: DashboardScope) =>
  queryOptions({
    queryKey: ["needs-attention", scopeKey(scope)] as const,
    staleTime: 20_000,
    queryFn: async () => {
      const now = new Date().toISOString();
      let q = supabase
        .from("leads")
        .select("id, lead_code, client_name, company_name, interest, stage, next_follow_up_at, service_required, updated_at")
        .or(`next_follow_up_at.lt.${now},and(interest.eq.hot,next_follow_up_at.is.null)`);
      // Second .or() combines with the first using AND: (attention) AND (mine).
      q = scopeLeads(q, scope);
      const { data } = await q
        .order("next_follow_up_at", { ascending: true, nullsFirst: false })
        .limit(8);
      return data ?? [];
    },
  });

export const todayFollowupsQuery = () =>
  queryOptions({
    queryKey: ["today-followups"] as const,
    staleTime: 20_000,
    queryFn: async () => {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(); end.setHours(23, 59, 59, 999);
      const { data } = await supabase
        .from("follow_ups")
        .select("id, action, due_at, status, leads:lead_id(id, lead_code, client_name)")
        .eq("status", "pending")
        .gte("due_at", start.toISOString())
        .lte("due_at", end.toISOString())
        .order("due_at", { ascending: true });
      return data ?? [];
    },
  });

export const overdueFollowupsQuery = () =>
  queryOptions({
    queryKey: ["overdue-followups"] as const,
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("follow_ups")
        .select("id, action, due_at, leads:lead_id(id, client_name)")
        .eq("status", "pending")
        .lt("due_at", new Date().toISOString())
        .order("due_at", { ascending: true })
        .limit(25);
      return data ?? [];
    },
  });

export const pipelineCountsQuery = (scope: DashboardScope) =>
  queryOptions({
    queryKey: ["pipeline-counts", scopeKey(scope)] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await scopeLeads(supabase.from("leads").select("stage").limit(5000), scope);
      const counts: Record<string, number> = {};
      (data ?? []).forEach((r: { stage: string }) => { counts[r.stage] = (counts[r.stage] ?? 0) + 1; });
      return counts;
    },
  });

export const activityTickerQuery = (scope: DashboardScope) =>
  queryOptions({
    queryKey: ["activity-ticker", scopeKey(scope)] as const,
    staleTime: 15_000,
    queryFn: async () => {
      // Inner-join the parent lead so we can filter activities to "my leads"
      // when scoped (every activity has a lead, so inner == left for admins).
      let q = supabase
        .from("lead_activities")
        .select("id, type, title, body, created_at, lead_id, leads:lead_id!inner(client_name, assigned_to, created_by)")
        .order("created_at", { ascending: false })
        .limit(20);
      if (scope.scoped && scope.uid) {
        q = q.or(`assigned_to.eq.${scope.uid},created_by.eq.${scope.uid}`, { referencedTable: "leads" });
      }
      const { data } = await q;
      return data ?? [];
    },
  });

// Map a realtime payload to the set of query keys it affects.
// This avoids invalidating queries that the change can't possibly impact.
type RTPayload = {
  table: "leads" | "follow_ups" | "lead_activities";
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
};

export function affectedKeysFor(p: RTPayload): string[] {
  const keys = new Set<string>();
  const newRow = (p.new ?? {}) as Record<string, unknown>;
  const oldRow = (p.old ?? {}) as Record<string, unknown>;
  const changed = (field: string) =>
    p.eventType === "INSERT" || p.eventType === "DELETE" || newRow[field] !== oldRow[field];

  if (p.table === "leads") {
    // KPI stats touch stage/interest/created_at/updated_at
    if (changed("stage") || changed("interest") || p.eventType !== "UPDATE") keys.add("dashboard-stats");
    if (changed("stage") || changed("updated_at") || p.eventType === "INSERT") keys.add("hero-today");
    if (changed("stage")) keys.add("pipeline-counts");
    if (changed("next_follow_up_at") || changed("interest") || changed("stage") || changed("updated_at"))
      keys.add("needs-attention");
  } else if (p.table === "follow_ups") {
    if (changed("status") || changed("due_at") || p.eventType !== "UPDATE") {
      keys.add("today-followups");
      keys.add("overdue-followups");
      keys.add("dashboard-stats");
      keys.add("needs-attention");
    }
  } else if (p.table === "lead_activities") {
    if (p.eventType === "INSERT") keys.add("activity-ticker");
  }
  return Array.from(keys);
}
