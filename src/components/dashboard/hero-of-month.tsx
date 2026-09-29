import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { useMemo, useState, useEffect } from "react";
import type { ComponentType } from "react";
import { Trophy, Package, IndianRupee, Ticket, Target, Pencil } from "lucide-react";

// Row shapes fetched by this widget's queries.
type HeroBooking = {
  id?: string;
  sales_agent_id: string | null;
  sales_agent_name: string | null;
  plan_name?: string | null;
  total_amount: number | null;
  profit: number | null;
  booking_date: string | null;
  booking_source?: string | null;
};
type HeroProfile = { id: string; full_name: string | null; email: string | null };
type UserTargetRow = { user_id: string; bookings: number | null; profit: number | null };

function barColor(pct: number) {
  if (pct >= 75) return "bg-emerald-500";
  if (pct >= 40) return "bg-amber-500";
  return "bg-rose-500";
}
function targetStatus(pct: number) {
  if (pct >= 75) return { text: "On track 🔥", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" };
  if (pct >= 40) return { text: "Keep pushing", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" };
  return { text: "Behind ⚠", cls: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" };
}
function compactINR(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fmtINR = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
const MEDALS = ["🥇", "🥈", "🥉"];

type AgentRow = { key: string; name: string; bookings: number; revenue: number; profit: number; avg: number };

// Hero of the Month leaderboard — rendered as a section inside the Dashboard.
export function HeroOfMonth() {
  const { isAdmin, user } = useAuth();
  const qc = useQueryClient();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [rankBy, setRankBy] = useState<"bookings" | "profit">("bookings");
  const [metric, setMetric] = useState<"bookings" | "revenue" | "profit">("bookings");
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetDraft, setTargetDraft] = useState({ bookings: "", profit: "" });
  const [indivDraft, setIndivDraft] = useState<Record<string, { bookings: string; profit: string }>>({});

  const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const endDateObj = new Date(year, month + 1, 1);
  const end = `${endDateObj.getFullYear()}-${String(endDateObj.getMonth() + 1).padStart(2, "0")}-01`;
  const years = useMemo(() => { const y = now.getFullYear(); return [y + 1, y, y - 1, y - 2]; }, [now]);

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ["hero-bookings", start, end],
    queryFn: async () => {
      const { data, error } = await supabase.from("bookings")
        .select("id, sales_agent_id, sales_agent_name, plan_name, total_amount, profit, booking_date, booking_source")
        .gte("booking_date", start).lt("booking_date", end)
        .neq("booking_source", "Renewal")
        .limit(5000);
      if (error) throw new Error(error.message);
      return (data ?? []) as HeroBooking[];
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["hero-profiles"],
    queryFn: async (): Promise<HeroProfile[]> => {
      const { data } = await supabase.from("profiles").select("id, full_name, email");
      return data ?? [];
    },
  });

  const agents = useMemo<AgentRow[]>(() => {
    const nameOf = (id: string | null, fallback?: string | null) => {
      if (fallback) return fallback;
      const p = profiles.find((x) => x.id === id);
      return p?.full_name || p?.email || "Unknown";
    };
    const map = new Map<string, AgentRow>();
    bookings.forEach((b) => {
      const key = b.sales_agent_id || b.sales_agent_name || "unknown";
      const r = map.get(key) ?? { key, name: nameOf(b.sales_agent_id, b.sales_agent_name), bookings: 0, revenue: 0, profit: 0, avg: 0 };
      r.bookings++;
      r.revenue += Number(b.total_amount ?? 0);
      r.profit += Number(b.profit ?? 0);
      map.set(key, r);
    });
    const rows = Array.from(map.values());
    rows.forEach((r) => { r.avg = r.bookings > 0 ? r.revenue / r.bookings : 0; });
    return rows.sort((a, b) =>
      rankBy === "profit"
        ? (b.profit - a.profit || b.bookings - a.bookings)
        : (b.bookings - a.bookings || b.revenue - a.revenue),
    );
  }, [bookings, profiles, rankBy]);

  const totals = useMemo(() => {
    const t = bookings.reduce(
      (acc, b) => { acc.count++; acc.sales += Number(b.total_amount ?? 0); acc.profit += Number(b.profit ?? 0); return acc; },
      { count: 0, sales: 0, profit: 0 },
    );
    return { ...t, avgTicket: t.count > 0 ? t.sales / t.count : 0 };
  }, [bookings]);

  // Top services, grouped by the plan code's service prefix.
  //
  // Sheet plan codes are "<SERVICE>" or "<SERVICE>_<Space>_<City>" — e.g. "BR",
  // "BR_SPMukherji_kolkata", "BR_Garbhanga_Assam". Listing raw codes split one
  // service across several rows and made the headline wrong: "BR 17" sat next to
  // three separate 1-booking BR variants when BR had actually done 20. Grouping
  // on the prefix gives the number the team is actually asking for, and the
  // variant count keeps the detail visible.
  const topPlans = useMemo(() => {
    const map = new Map<string, { plan: string; bookings: number; revenue: number; variants: Set<string> }>();
    bookings.forEach((b) => {
      const raw = (b.plan_name || "").trim();
      // Split on the first underscore only; anything without one is already a
      // bare service code.
      const service = (raw.split("_")[0] || "").trim().toUpperCase() || "—";
      const e = map.get(service) ?? { plan: service, bookings: 0, revenue: 0, variants: new Set<string>() };
      e.bookings++;
      e.revenue += Number(b.total_amount ?? 0);
      if (raw) e.variants.add(raw);
      map.set(service, e);
    });
    return Array.from(map.values())
      .map((e) => ({
        plan: e.plan,
        bookings: e.bookings,
        revenue: e.revenue,
        variantCount: e.variants.size,
        // Sorted so the tooltip listing is stable between renders.
        variantList: Array.from(e.variants).sort().join(", "),
      }))
      .sort((a, b) => b.bookings - a.bookings || b.revenue - a.revenue)
      .slice(0, 6);
  }, [bookings]);

  // Last 6 months (ending at the selected month) — RLS scopes this to the
  // signed-in user's own bookings for a salesperson, or all for an admin.
  const trendStartObj = new Date(year, month - 5, 1);
  const trendStart = `${trendStartObj.getFullYear()}-${String(trendStartObj.getMonth() + 1).padStart(2, "0")}-01`;
  const trendEndObj = new Date(year, month + 1, 1);
  const trendEnd = `${trendEndObj.getFullYear()}-${String(trendEndObj.getMonth() + 1).padStart(2, "0")}-01`;
  const { data: trendBookings = [] } = useQuery({
    queryKey: ["hero-trend", trendStart, trendEnd],
    queryFn: async () => {
      const { data, error } = await supabase.from("bookings")
        .select("booking_date, total_amount, profit")
        .gte("booking_date", trendStart).lt("booking_date", trendEnd)
        .neq("booking_source", "Renewal")
        .limit(5000);
      if (error) throw new Error(error.message);
      return (data ?? []) as HeroBooking[];
    },
  });
  const trendMonths = useMemo(() => {
    const buckets: { key: string; label: string; bookings: number; revenue: number; profit: number }[] = [];
    const idx = new Map<string, number>();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(year, month - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      idx.set(key, buckets.length);
      buckets.push({ key, label: d.toLocaleDateString(undefined, { month: "short" }), bookings: 0, revenue: 0, profit: 0 });
    }
    trendBookings.forEach((b) => {
      if (!b.booking_date) return;
      const d = new Date(b.booking_date);
      const i = idx.get(`${d.getFullYear()}-${d.getMonth()}`);
      if (i == null) return;
      buckets[i].bookings++;
      buckets[i].revenue += Number(b.total_amount ?? 0);
      buckets[i].profit += Number(b.profit ?? 0);
    });
    return buckets;
  }, [trendBookings, year, month]);
  const maxTrend = Math.max(1, ...trendMonths.map((x) => x[metric]));

  // Org (cumulative) target — shown to admins.
  const { data: targets } = useQuery({
    queryKey: ["sales-targets"],
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("value").eq("key", "sales_targets").maybeSingle();
      const v = (data?.value as { bookings?: number; profit?: number } | null) || {};
      return { bookings: Number(v.bookings) || 100, profit: Number(v.profit) || 500000 };
    },
  });
  const orgBookingsTarget = targets?.bookings ?? 100;
  const orgProfitTarget = targets?.profit ?? 500000;

  // The signed-in user's own target — shown to salespeople.
  const { data: myTarget } = useQuery({
    queryKey: ["my-target", user?.id],
    enabled: !!user?.id && !isAdmin,
    queryFn: async () => {
      const { data } = await supabase.from("user_targets").select("bookings, profit").eq("user_id", user!.id).maybeSingle();
      return data ? { bookings: Number(data.bookings) || 0, profit: Number(data.profit) || 0 } : null;
    },
  });

  // For admins assigning individual targets.
  const { data: allTargets = [] } = useQuery({
    queryKey: ["all-user-targets"],
    enabled: isAdmin,
    queryFn: async (): Promise<UserTargetRow[]> => { const { data } = await supabase.from("user_targets").select("user_id, bookings, profit"); return data ?? []; },
  });
  const { data: targetTeam = [] } = useQuery({
    queryKey: ["target-team-users"],
    enabled: isAdmin && editingTarget,
    queryFn: async (): Promise<HeroProfile[]> => { const { data } = await supabase.from("profiles").select("id, full_name, email").order("full_name", { ascending: true }); return data ?? []; },
  });

  // Seed the per-person draft when the editor opens.
  useEffect(() => {
    if (editingTarget && targetTeam.length) {
      const map: Record<string, { bookings: string; profit: string }> = {};
      targetTeam.forEach((u) => {
        const t = allTargets.find((x) => x.user_id === u.id);
        map[u.id] = { bookings: t ? String(t.bookings) : "", profit: t ? String(t.profit) : "" };
      });
      setIndivDraft(map);
    }
  }, [editingTarget, targetTeam, allTargets]);

  // Admin sees the cumulative target; a salesperson sees their own.
  const displayBookingsTarget = isAdmin ? orgBookingsTarget : (myTarget?.bookings || orgBookingsTarget);
  const displayProfitTarget = isAdmin ? orgProfitTarget : (myTarget?.profit || orgProfitTarget);
  const bPct = displayBookingsTarget > 0 ? Math.round((totals.count / displayBookingsTarget) * 100) : 0;
  const pPct = displayProfitTarget > 0 ? Math.round((totals.profit / displayProfitTarget) * 100) : 0;
  const status = targetStatus(bPct);

  const saveTarget = useMutation({
    mutationFn: async () => {
      const payload = { bookings: Number(targetDraft.bookings) || 0, profit: Number(targetDraft.profit) || 0 };
      const { error } = await supabase.from("app_settings").upsert({ key: "sales_targets", value: payload });
      if (error) throw new Error(error.message);
      const rows = targetTeam.map((u) => ({
        user_id: u.id,
        bookings: Number(indivDraft[u.id]?.bookings) || 0,
        profit: Number(indivDraft[u.id]?.profit) || 0,
        updated_by: user?.id ?? null,
      }));
      if (rows.length) {
        const { error: e2 } = await supabase.from("user_targets").upsert(rows);
        if (e2) throw new Error(e2.message);
      }
    },
    onSuccess: () => {
      toast.success("Targets updated");
      setEditingTarget(false);
      qc.invalidateQueries({ queryKey: ["sales-targets"] });
      qc.invalidateQueries({ queryKey: ["all-user-targets"] });
      qc.invalidateQueries({ queryKey: ["my-target"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const hero = agents[0];
  const maxRevenue = Math.max(1, ...agents.map((a) => a.revenue));

  return (
    <Card>
      <CardHeader className="flex-col sm:flex-row sm:items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base flex items-center gap-2"><Trophy className="h-5 w-5 text-amber-500" /> Hero of the Month</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Select value={rankBy} onValueChange={(v) => setRankBy(v as "bookings" | "profit")}>
            <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="bookings">Rank by Bookings</SelectItem>
              <SelectItem value="profit">Rank by Profit</SelectItem>
            </SelectContent>
          </Select>
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="h-8 w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i)}>{m}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="h-8 w-[92px]"><SelectValue /></SelectTrigger>
            <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid lg:grid-cols-3 gap-4">
          {/* Left: hero + KPIs */}
          <div className="lg:col-span-2 space-y-4">
            {hero && hero.bookings > 0 && (
              <div className="flex flex-wrap items-center gap-4 rounded-lg border border-amber-300 bg-gradient-to-br from-amber-100 to-amber-50 p-4 dark:border-amber-800/60 dark:from-amber-950/40 dark:to-amber-950/10">
                <div className="text-4xl leading-none">🏆</div>
                <div className="min-w-[180px] flex-1">
                  <div className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                    Hero of {MONTHS[month]} {year} · by {rankBy === "profit" ? "profit" : "bookings"}
                  </div>
                  <div className="text-xl font-bold">{hero.name}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground tabular-nums">
                    <span>{hero.bookings} bookings</span>
                    <span>{fmtINR(hero.revenue)} revenue</span>
                    <span className="text-emerald-600 dark:text-emerald-400">
                      {fmtINR(hero.profit)} profit
                    </span>
                  </div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Kpi icon={Package} label="Bookings" value={String(totals.count)} tone="blue" />
              <Kpi icon={IndianRupee} label="Total sales" value={fmtINR(totals.sales)} tone="emerald" />
              <Kpi icon={Trophy} label="Profit" value={fmtINR(totals.profit)} tone="amber" />
              <Kpi icon={Ticket} label="Avg ticket" value={fmtINR(totals.avgTicket)} tone="violet" />
            </div>
          </div>

          {/* Right: Target panel */}
          <div className="lg:col-span-1">
            <div className="rounded-lg border h-full p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="font-semibold flex items-center gap-2"><Target className="h-4 w-4 text-amber-500" /> {isAdmin ? "Our Target" : "My Target"}</div>
                {isAdmin && !editingTarget && (
                  <Button size="sm" variant="ghost" className="h-7 px-2"
                    onClick={() => { setTargetDraft({ bookings: String(orgBookingsTarget), profit: String(orgProfitTarget) }); setEditingTarget(true); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              {editingTarget ? (
                <div className="space-y-3">
                  <div className="text-xs font-semibold text-muted-foreground">Team (cumulative) target</div>
                  <div><label className="text-xs text-muted-foreground">Bookings</label><Input type="number" value={targetDraft.bookings} onChange={(e) => setTargetDraft({ ...targetDraft, bookings: e.target.value })} /></div>
                  <div><label className="text-xs text-muted-foreground">Profit (₹)</label><Input type="number" value={targetDraft.profit} onChange={(e) => setTargetDraft({ ...targetDraft, profit: e.target.value })} /></div>
                  {targetTeam.length > 0 && (
                    <>
                      <div className="text-xs font-semibold text-muted-foreground pt-1">Individual targets</div>
                      <div className="grid grid-cols-[1fr_60px_82px] gap-2 text-[11px] text-muted-foreground">
                        <span>Member</span><span>Bookings</span><span>Profit ₹</span>
                      </div>
                      <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                        {targetTeam.map((u) => (
                          <div key={u.id} className="grid grid-cols-[1fr_60px_82px] gap-2 items-center">
                            <span className="text-xs truncate">{u.full_name || u.email}</span>
                            <Input className="h-8" type="number" value={indivDraft[u.id]?.bookings ?? ""} onChange={(e) => setIndivDraft((d) => ({ ...d, [u.id]: { ...(d[u.id] ?? { bookings: "", profit: "" }), bookings: e.target.value } }))} />
                            <Input className="h-8" type="number" value={indivDraft[u.id]?.profit ?? ""} onChange={(e) => setIndivDraft((d) => ({ ...d, [u.id]: { ...(d[u.id] ?? { bookings: "", profit: "" }), profit: e.target.value } }))} />
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="ghost" onClick={() => setEditingTarget(false)}>Cancel</Button>
                    <Button size="sm" disabled={saveTarget.isPending} onClick={() => saveTarget.mutate()}>{saveTarget.isPending ? "Saving…" : "Save"}</Button>
                  </div>
                </div>
              ) : (
                // Two progress blocks plus a gap footer. The previous version was
                // six emoji-prefixed sentences (with 🎯 used for two different
                // things), which read as a list of notes rather than a target.
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs text-muted-foreground">
                      Goal: {displayBookingsTarget} bookings · {compactINR(displayProfitTarget)} profit
                    </div>
                    <span
                      className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full font-medium ${status.cls}`}
                    >
                      {status.text}
                    </span>
                  </div>

                  <TargetProgress
                    label="Bookings"
                    pct={bPct}
                    detail={`${totals.count} / ${displayBookingsTarget}`}
                  />
                  <TargetProgress
                    label="Profit"
                    pct={pPct}
                    detail={`${compactINR(totals.profit)} / ${compactINR(displayProfitTarget)}`}
                  />

                  <div className="grid grid-cols-2 gap-3 border-t pt-3">
                    <div>
                      <div className="text-[11px] text-muted-foreground">Profit gap</div>
                      <div className="text-sm font-semibold tabular-nums">
                        {fmtINR(Math.max(0, displayProfitTarget - totals.profit))}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground">Bookings left</div>
                      <div className="text-sm font-semibold tabular-nums">
                        {Math.max(0, displayBookingsTarget - totals.count)}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground text-center py-6">Loading…</div>
        ) : agents.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">No bookings for {MONTHS[month]} {year} yet.</div>
        ) : (
          <div className="overflow-x-auto border-t pt-4">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="w-12 py-2 text-left font-normal">#</th>
                  <th className="text-left font-normal">Salesperson</th>
                  <th className="text-right font-normal">Bookings</th>
                  <th className="text-right font-normal">Revenue</th>
                  <th className="text-right font-normal">Profit</th>
                  <th className="text-right font-normal">Avg booking</th>
                  <th className="w-[20%] pl-4 text-left font-normal">Revenue share</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {agents.map((a, i) => (
                  <tr
                    key={a.key}
                    className={`hover:bg-muted/30 ${i === 0 ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}
                  >
                    {/* Fixed-height cell so a medal row and a "#4" row line up. */}
                    <td className="py-2">
                      {MEDALS[i] ? (
                        <span className="text-base leading-none">{MEDALS[i]}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                      )}
                    </td>
                    <td className="font-medium">{a.name}</td>
                    <td className="text-right font-medium tabular-nums">{a.bookings}</td>
                    <td className="text-right tabular-nums">{fmtINR(a.revenue)}</td>
                    <td className="text-right tabular-nums text-emerald-600">{fmtINR(a.profit)}</td>
                    <td className="text-right tabular-nums text-muted-foreground">{fmtINR(a.avg)}</td>
                    <td className="pl-4">
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-amber-500 transition-all duration-500"
                          style={{ width: `${(a.revenue / maxRevenue) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {topPlans.length > 0 && (
          <div className="border-t pt-4">
            <SectionTitle title="Top services" hint="grouped by plan code" />
            <div className="mt-3 space-y-2">
              {topPlans.map((p) => (
                <div key={p.plan} className="flex items-center gap-3">
                  <div className="w-28 shrink-0 sm:w-36">
                    <div className="truncate text-sm font-medium" title={p.plan}>
                      {p.plan}
                    </div>
                    {p.variantCount > 1 && (
                      <div
                        className="truncate text-[11px] text-muted-foreground"
                        title={p.variantList}
                      >
                        {p.variantCount} plan codes
                      </div>
                    )}
                  </div>
                  <div className="relative h-6 flex-1 overflow-hidden rounded bg-muted">
                    <div
                      className="absolute inset-y-0 left-0 rounded bg-blue-500/70"
                      style={{ width: `${(p.bookings / (topPlans[0]?.bookings || 1)) * 100}%` }}
                    />
                    <div className="absolute inset-0 flex items-center px-2 text-xs font-medium tabular-nums">
                      {p.bookings} bookings · {fmtINR(p.revenue)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Monthly performance trend (last 6 months) */}
        <div className="border-t pt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <SectionTitle
              title={isAdmin ? "Team monthly trend" : "My monthly trend"}
              hint="last 6 months"
            />
            <Select value={metric} onValueChange={(v) => setMetric(v as "bookings" | "revenue" | "profit")}>
              <SelectTrigger className="h-8 w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bookings">Bookings</SelectItem>
                <SelectItem value="revenue">Revenue</SelectItem>
                <SelectItem value="profit">Profit</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-6 gap-2">
            {trendMonths.map((b) => {
              const val = b[metric];
              const h = val > 0 ? Math.max(4, Math.round((val / maxTrend) * 100)) : 0;
              return (
                <div key={b.key} className="flex flex-col items-center gap-1">
                  <div className="text-[10px] font-medium tabular-nums">{metric === "bookings" ? val : compactINR(val)}</div>
                  <div className="w-full h-28 bg-muted/40 rounded-md flex items-end overflow-hidden">
                    <div className="w-full bg-gradient-to-t from-primary to-primary/60 rounded-t-md transition-all duration-500" style={{ height: `${h}%` }} />
                  </div>
                  <div className="text-[11px] text-muted-foreground">{b.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// One labelled progress row in the target panel: name on the left, "current /
// target" on the right, percentage on the bar's own line. Keeps the two targets
// visually identical so they can be compared at a glance.
function TargetProgress({ label, pct, detail }: { label: string; pct: number; detail: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium">{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{detail}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full ${barColor(pct)} transition-all duration-500`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <span className="w-9 text-right text-[11px] font-semibold tabular-nums">{pct}%</span>
      </div>
    </div>
  );
}

// Consistent heading for the sections below the leaderboard.
function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="text-sm font-medium">
      {title}
      {hint && <span className="text-xs text-muted-foreground font-normal"> · {hint}</span>}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: ComponentType<{ className?: string }>; label: string; value: string; tone: string }) {
  const tones: Record<string, string> = {
    blue: "from-blue-500/10 to-blue-500/5 text-blue-600",
    emerald: "from-emerald-500/10 to-emerald-500/5 text-emerald-600",
    amber: "from-amber-500/10 to-amber-500/5 text-amber-600",
    violet: "from-violet-500/10 to-violet-500/5 text-violet-600",
  };
  return (
    <div className={`rounded-lg border bg-gradient-to-br ${tones[tone]} flex items-center gap-3 p-3`}>
      <Icon className="h-6 w-6 shrink-0" />
      {/* min-w-0 so a long INR value truncates instead of stretching the tile. */}
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="truncate text-lg font-bold tabular-nums" title={value}>
          {value}
        </div>
      </div>
    </div>
  );
}
