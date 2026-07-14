import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMemo, useState } from "react";
import { Trophy, Package, IndianRupee, Ticket } from "lucide-react";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fmtINR = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
const MEDALS = ["🥇", "🥈", "🥉"];

type AgentRow = { key: string; name: string; bookings: number; revenue: number; profit: number; avg: number };

// Hero of the Month leaderboard — rendered as a section inside the Dashboard.
export function HeroOfMonth() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [rankBy, setRankBy] = useState<"bookings" | "profit">("bookings");

  const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const endDateObj = new Date(year, month + 1, 1);
  const end = `${endDateObj.getFullYear()}-${String(endDateObj.getMonth() + 1).padStart(2, "0")}-01`;
  const years = useMemo(() => { const y = now.getFullYear(); return [y + 1, y, y - 1, y - 2]; }, [now]);

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ["hero-bookings", start, end],
    queryFn: async () => {
      const { data, error } = await supabase.from("bookings")
        .select("id, sales_agent_id, sales_agent_name, plan_name, total_amount, profit, booking_date")
        .gte("booking_date", start).lt("booking_date", end).limit(5000);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["hero-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email");
      return data ?? [];
    },
  });

  const agents = useMemo<AgentRow[]>(() => {
    const nameOf = (id: string | null, fallback?: string) => {
      if (fallback) return fallback;
      const p = (profiles as any[]).find((x) => x.id === id);
      return p?.full_name || p?.email || "Unknown";
    };
    const map = new Map<string, AgentRow>();
    (bookings as any[]).forEach((b) => {
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
    const t = (bookings as any[]).reduce(
      (acc, b) => { acc.count++; acc.sales += Number(b.total_amount ?? 0); acc.profit += Number(b.profit ?? 0); return acc; },
      { count: 0, sales: 0, profit: 0 },
    );
    return { ...t, avgTicket: t.count > 0 ? t.sales / t.count : 0 };
  }, [bookings]);

  const topPlans = useMemo(() => {
    const map = new Map<string, { plan: string; bookings: number; revenue: number }>();
    (bookings as any[]).forEach((b) => {
      const plan = (b.plan_name || "—").trim() || "—";
      const e = map.get(plan) ?? { plan, bookings: 0, revenue: 0 };
      e.bookings++; e.revenue += Number(b.total_amount ?? 0);
      map.set(plan, e);
    });
    return Array.from(map.values()).sort((a, b) => b.bookings - a.bookings).slice(0, 6);
  }, [bookings]);

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
        {hero && hero.bookings > 0 && (
          <div className="rounded-lg bg-gradient-to-br from-amber-100 to-amber-50 dark:from-amber-950/40 dark:to-amber-950/10 border border-amber-300 p-4 flex flex-wrap items-center gap-4">
            <div className="text-4xl">🏆</div>
            <div className="flex-1 min-w-[180px]">
              <div className="text-xs uppercase tracking-wide text-amber-700 dark:text-amber-400 font-semibold">Hero of {MONTHS[month]} {year} · by {rankBy === "profit" ? "profit" : "bookings"}</div>
              <div className="text-xl font-bold">{hero.name}</div>
              <div className="text-sm text-muted-foreground">{hero.bookings} bookings · {fmtINR(hero.revenue)} revenue · {fmtINR(hero.profit)} profit</div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi icon={Package} label="Bookings" value={String(totals.count)} tone="blue" />
          <Kpi icon={IndianRupee} label="Total sales" value={fmtINR(totals.sales)} tone="emerald" />
          <Kpi icon={Trophy} label="Profit" value={fmtINR(totals.profit)} tone="amber" />
          <Kpi icon={Ticket} label="Avg ticket" value={fmtINR(totals.avgTicket)} tone="violet" />
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground text-center py-6">Loading…</div>
        ) : agents.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">No bookings for {MONTHS[month]} {year} yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 w-14">Rank</th>
                  <th className="text-left">Salesperson</th>
                  <th className="text-right">Bookings</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">Profit</th>
                  <th className="text-right">Avg booking</th>
                  <th className="text-left pl-4 w-[20%]">Revenue share</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {agents.map((a, i) => (
                  <tr key={a.key} className={`hover:bg-muted/30 ${i === 0 ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
                    <td className="py-2 text-lg">{MEDALS[i] ?? <span className="text-sm text-muted-foreground pl-1">#{i + 1}</span>}</td>
                    <td className="font-medium">{a.name}</td>
                    <td className="text-right font-medium">{a.bookings}</td>
                    <td className="text-right">{fmtINR(a.revenue)}</td>
                    <td className="text-right text-emerald-600">{fmtINR(a.profit)}</td>
                    <td className="text-right">{fmtINR(a.avg)}</td>
                    <td className="pl-4">
                      <div className="h-2 bg-muted rounded overflow-hidden">
                        <div className="h-full bg-amber-500" style={{ width: `${(a.revenue / maxRevenue) * 100}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {topPlans.length > 0 && (
          <div>
            <div className="text-sm font-medium mb-2">Top plans</div>
            <div className="space-y-2">
              {topPlans.map((p) => (
                <div key={p.plan} className="flex items-center gap-3">
                  <div className="w-36 shrink-0 truncate text-sm">{p.plan}</div>
                  <div className="flex-1 h-6 bg-muted rounded relative overflow-hidden">
                    <div className="absolute inset-y-0 left-0 bg-blue-500/70 rounded" style={{ width: `${(p.bookings / (topPlans[0]?.bookings || 1)) * 100}%` }} />
                    <div className="absolute inset-0 flex items-center px-2 text-xs font-medium">{p.bookings} bookings · {fmtINR(p.revenue)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: string }) {
  const tones: Record<string, string> = {
    blue: "from-blue-500/10 to-blue-500/5 text-blue-600",
    emerald: "from-emerald-500/10 to-emerald-500/5 text-emerald-600",
    amber: "from-amber-500/10 to-amber-500/5 text-amber-600",
    violet: "from-violet-500/10 to-violet-500/5 text-violet-600",
  };
  return (
    <div className={`rounded-lg border bg-gradient-to-br ${tones[tone]} p-3 flex items-center gap-3`}>
      <Icon className="h-6 w-6" />
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-bold">{value}</div>
      </div>
    </div>
  );
}
