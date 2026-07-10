import { Fragment } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Download, RefreshCcw, ShieldAlert, ChevronDown, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/kpi-report")({
  head: () => ({ meta: [{ title: "KPI Click Report — Admin" }] }),
  component: KpiReportPage,
});

type RangeKey = "today" | "7d" | "30d" | "all";

const RANGE_MS: Record<RangeKey, number | null> = {
  today: 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  all: null,
};

type EventRow = {
  id: string;
  user_id: string;
  team: string | null;
  kpi_id: string;
  label: string | null;
  path: string | null;
  search: Record<string, unknown> | null;
  created_at: string;
};

type ProfileRow = { id: string; full_name: string | null; email: string | null };

function KpiReportPage() {
  const { isAdmin, loading } = useAuth();
  const [range, setRange] = useState<RangeKey>("7d");
  const [team, setTeam] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const sinceIso = useMemo(() => {
    const ms = RANGE_MS[range];
    return ms ? new Date(Date.now() - ms).toISOString() : null;
  }, [range]);

  const eventsQ = useQuery({
    enabled: !!isAdmin,
    queryKey: ["kpi-events", range, team],
    queryFn: async (): Promise<EventRow[]> => {
      let q = supabase
        .from("kpi_events")
        .select("id,user_id,team,kpi_id,label,path,search,created_at")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (sinceIso) q = q.gte("created_at", sinceIso);
      if (team !== "all") q = q.eq("team", team === "—" ? null as never : team);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as EventRow[];
    },
  });

  const profilesQ = useQuery({
    enabled: !!isAdmin,
    queryKey: ["kpi-events-profiles"],
    queryFn: async (): Promise<Record<string, ProfileRow>> => {
      const { data } = await supabase.from("profiles").select("id,full_name,email");
      const map: Record<string, ProfileRow> = {};
      (data ?? []).forEach((p: any) => { map[p.id] = p; });
      return map;
    },
  });

  const events = eventsQ.data ?? [];
  const profiles = profilesQ.data ?? {};

  const teams = useMemo(() => {
    const s = new Set<string>();
    (eventsQ.data ?? []).forEach((e) => { if (e.team) s.add(e.team); });
    return Array.from(s).sort();
  }, [eventsQ.data]);

  const byKpi = useMemo(() => {
    const map = new Map<string, {
      label: string;
      count: number;
      lastTs: number;
      teams: Record<string, number>;
      byUser: Record<string, number>;
      byDate: Record<string, number>;
      path: string | null;
      sampleSearch: Record<string, unknown> | null;
    }>();
    for (const e of events) {
      const id = e.kpi_id;
      const cur = map.get(id) ?? {
        label: e.label ?? id, count: 0, lastTs: 0,
        teams: {}, byUser: {}, byDate: {},
        path: e.path, sampleSearch: e.search,
      };
      cur.count++;
      const ts = new Date(e.created_at).getTime();
      cur.lastTs = Math.max(cur.lastTs, ts);
      const t = e.team ?? "—";
      cur.teams[t] = (cur.teams[t] ?? 0) + 1;
      cur.byUser[e.user_id] = (cur.byUser[e.user_id] ?? 0) + 1;
      const dKey = e.created_at.slice(0, 10);
      cur.byDate[dKey] = (cur.byDate[dKey] ?? 0) + 1;
      map.set(id, cur);
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.count - a.count);
  }, [events]);

  const total = events.length;
  const userLabel = (uid: string) => {
    const p = profiles[uid];
    return p?.full_name || p?.email || uid.slice(0, 8);
  };

  const exportCsv = () => {
    const rows = [
      ["kpi_id", "label", "clicks", "last_click_iso", "team_breakdown", "top_user", "top_user_clicks"],
      ...byKpi.map((r) => {
        const topUser = Object.entries(r.byUser).sort((a, b) => b[1] - a[1])[0];
        return [
          r.id,
          r.label,
          String(r.count),
          new Date(r.lastTs).toISOString(),
          Object.entries(r.teams).map(([t, c]) => `${t}:${c}`).join("|"),
          topUser ? userLabel(topUser[0]) : "",
          topUser ? String(topUser[1]) : "0",
        ];
      }),
    ];
    downloadCsv(rows, `kpi-clicks-summary-${range}${team !== "all" ? `-${team}` : ""}.csv`);
  };

  // Detailed export: every captured event in the current window/team scope,
  // joined to the user's display name so admins can drill down per click.
  const exportDetailsCsv = () => {
    const rows = [
      ["created_at_iso", "kpi_id", "label", "user_id", "user_name", "team", "path", "search_json"],
      ...events.map((e) => [
        e.created_at,
        e.kpi_id,
        e.label ?? "",
        e.user_id,
        userLabel(e.user_id),
        e.team ?? "",
        e.path ?? "",
        e.search ? JSON.stringify(e.search) : "",
      ]),
    ];
    downloadCsv(rows, `kpi-clicks-details-${range}${team !== "all" ? `-${team}` : ""}.csv`);
  };

  function downloadCsv(rows: string[][], filename: string) {
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!isAdmin) {
    return (
      <div className="p-8 max-w-lg">
        <div className="surface-card p-6 text-center">
          <ShieldAlert className="h-8 w-8 mx-auto text-destructive" />
          <h1 className="text-lg font-semibold mt-2">Admins only</h1>
          <p className="text-sm text-muted-foreground mt-1">
            This report is restricted to administrators.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-[1100px] mx-auto space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">KPI Click Report</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Aggregated KPI tile usage across all devices. Filter by team or date,
            and expand a row to see top click dates and users.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => eventsQ.refetch()}>
            <RefreshCcw className="h-4 w-4" /> Refresh
          </Button>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!byKpi.length}>
            <Download className="h-4 w-4" /> Summary CSV
          </Button>
          <Button size="sm" onClick={exportDetailsCsv} disabled={!events.length}>
            <Download className="h-4 w-4" /> Details CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="surface-card p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1" role="tablist" aria-label="Date range">
          {(Object.keys(RANGE_MS) as RangeKey[]).map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={range === r}
              onClick={() => setRange(r)}
              className={`px-2.5 py-1 text-xs rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                range === r ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"
              }`}
            >
              {r === "today" ? "Today" : r === "all" ? "All time" : `Last ${r}`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label htmlFor="team" className="text-muted-foreground">Team</label>
          <select
            id="team"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            className="bg-card border rounded-md px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All teams</option>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="ml-auto text-xs text-muted-foreground tabular-nums">
          {eventsQ.isPending ? "Loading…" : `${total} click${total === 1 ? "" : "s"} in window`}
        </div>
      </div>

      {/* Table */}
      <div className="surface-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left p-3 w-8"></th>
              <th className="text-left p-3">KPI</th>
              <th className="text-right p-3">Clicks</th>
              <th className="text-left p-3 hidden md:table-cell">By team</th>
              <th className="text-right p-3 hidden sm:table-cell">Last click</th>
            </tr>
          </thead>
          <tbody>
            {!eventsQ.isPending && byKpi.length === 0 && (
              <tr><td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">
                No KPI clicks captured yet for this range.
              </td></tr>
            )}
            {byKpi.map((r) => {
              const maxCount = byKpi[0].count || 1;
              const pct = Math.round((r.count / maxCount) * 100);
              const isOpen = expanded === r.id;
              const topDates = Object.entries(r.byDate)
                .sort((a, b) => b[1] - a[1]).slice(0, 7);
              const topUsers = Object.entries(r.byUser)
                .sort((a, b) => b[1] - a[1]).slice(0, 5);
              return (
                <Fragment key={r.id}>
                  <tr className="border-t hover:bg-muted/20">
                    <td className="p-3">
                      <button
                        aria-label={isOpen ? "Collapse" : "Expand"}
                        aria-expanded={isOpen}
                        onClick={() => setExpanded(isOpen ? null : r.id)}
                        className="rounded p-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    </td>
                    <td className="p-3">
                      <div className="font-medium">{r.label}</div>
                      <div className="text-[11px] text-muted-foreground">{r.id}{r.path ? ` → ${r.path}` : ""}</div>
                      <div className="mt-1 h-1 rounded bg-muted overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                    <td className="p-3 text-right tabular-nums font-semibold">{r.count}</td>
                    <td className="p-3 hidden md:table-cell text-xs text-muted-foreground">
                      {Object.entries(r.teams)
                        .sort((a, b) => b[1] - a[1])
                        .map(([t, c]) => `${t} (${c})`)
                        .join(", ")}
                    </td>
                    <td className="p-3 hidden sm:table-cell text-right text-xs text-muted-foreground tabular-nums">
                      {new Date(r.lastTs).toLocaleString()}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-t bg-muted/10">
                      <td></td>
                      <td colSpan={4} className="p-3">
                        <div className="grid md:grid-cols-2 gap-4">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                              Top click dates
                            </div>
                            {topDates.length === 0 && <div className="text-xs text-muted-foreground">No data.</div>}
                            <ul className="space-y-1">
                              {topDates.map(([d, c]) => (
                                <li key={d} className="flex items-center gap-2 text-xs">
                                  <span className="tabular-nums w-24">{d}</span>
                                  <div className="flex-1 h-1.5 rounded bg-muted overflow-hidden">
                                    <div className="h-full bg-primary" style={{ width: `${(c / topDates[0][1]) * 100}%` }} />
                                  </div>
                                  <span className="tabular-nums font-medium w-8 text-right">{c}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                              Top users
                            </div>
                            {topUsers.length === 0 && <div className="text-xs text-muted-foreground">No data.</div>}
                            <ul className="space-y-1">
                              {topUsers.map(([uid, c]) => (
                                <li key={uid} className="flex items-center gap-2 text-xs">
                                  <span className="truncate flex-1" title={uid}>{userLabel(uid)}</span>
                                  <span className="tabular-nums font-medium">{c}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Events are now stored server-side in a secure table; only admins can read them.
      </p>
    </div>
  );
}
