import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useMemo } from "react";
import { STAGES } from "@/lib/crm";
import { TrendingUp, AlertTriangle, Activity as ActivityIcon, Users, IndianRupee } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/analytics")({
  head: () => ({ meta: [{ title: "Analytics — EaseMyOffice CRM" }] }),
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/login" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
    if (!(roles ?? []).some((r: any) => r.role === "admin")) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const { data: leads = [] } = useQuery({
    queryKey: ["analytics-leads"],
    queryFn: async () => {
      const { data } = await supabase.from("leads")
        .select("id, stage, assigned_to, created_at, last_activity_at, next_follow_up_at, budget").limit(2000);
      return data ?? [];
    },
  });

  const { data: followups = [] } = useQuery({
    queryKey: ["analytics-followups"],
    queryFn: async () => {
      const { data } = await supabase.from("follow_ups")
        .select("id, due_at, status, owner_id").limit(2000);
      return data ?? [];
    },
  });

  const { data: bookings = [] } = useQuery({
    queryKey: ["analytics-bookings"],
    queryFn: async () => {
      const { data } = await supabase.from("bookings")
        .select("id, total_amount, amount_received, sales_agent_id, sales_agent_name, created_at").limit(2000);
      return data ?? [];
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["analytics-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email");
      return data ?? [];
    },
  });

  const profileMap = useMemo(() => new Map(profiles.map((p: any) => [p.id, p])), [profiles]);

  // Funnel
  const funnel = useMemo(() => {
    const counts = new Map<string, number>();
    STAGES.forEach((s) => counts.set(s.id, 0));
    leads.forEach((l: any) => counts.set(l.stage, (counts.get(l.stage) ?? 0) + 1));
    const total = leads.length;
    const won = (counts.get("completed") ?? 0) + (counts.get("agreement_signed") ?? 0);
    const lost = counts.get("lost") ?? 0;
    return {
      stages: STAGES.map((s) => ({ ...s, count: counts.get(s.id) ?? 0 })),
      total, won, lost,
      conversionRate: total > 0 ? (won / total) * 100 : 0,
    };
  }, [leads]);

  // SLA breaches: pending follow-ups overdue, by severity
  const sla = useMemo(() => {
    const now = Date.now();
    const breached = followups.filter((f: any) => f.status === "pending" && new Date(f.due_at).getTime() < now);
    const buckets = {
      mild: 0, // 0-1 day overdue
      medium: 0, // 1-3 days
      severe: 0, // 3+ days
    };
    const byOwner = new Map<string, number>();
    breached.forEach((f: any) => {
      const days = (now - new Date(f.due_at).getTime()) / 86400000;
      if (days < 1) buckets.mild++;
      else if (days < 3) buckets.medium++;
      else buckets.severe++;
      if (f.owner_id) byOwner.set(f.owner_id, (byOwner.get(f.owner_id) ?? 0) + 1);
    });
    const ownerList = Array.from(byOwner.entries())
      .map(([id, n]) => ({ id, name: (profileMap.get(id) as any)?.full_name ?? "Unknown", count: n }))
      .sort((a, b) => b.count - a.count).slice(0, 5);
    return { total: breached.length, buckets, ownerList, complianceRate: followups.length > 0 ? (1 - breached.length / followups.length) * 100 : 100 };
  }, [followups, profileMap]);

  // Productivity: leads, bookings, revenue by agent
  const productivity = useMemo(() => {
    const map = new Map<string, { name: string; leads: number; bookings: number; revenue: number; received: number }>();
    leads.forEach((l: any) => {
      if (!l.assigned_to) return;
      const name = (profileMap.get(l.assigned_to) as any)?.full_name ?? "Unknown";
      const e = map.get(l.assigned_to) ?? { name, leads: 0, bookings: 0, revenue: 0, received: 0 };
      e.leads++; map.set(l.assigned_to, e);
    });
    bookings.forEach((b: any) => {
      const id = b.sales_agent_id;
      if (!id) return;
      const name = b.sales_agent_name ?? (profileMap.get(id) as any)?.full_name ?? "Unknown";
      const e = map.get(id) ?? { name, leads: 0, bookings: 0, revenue: 0, received: 0 };
      e.bookings++;
      e.revenue += Number(b.total_amount ?? 0);
      e.received += Number(b.amount_received ?? 0);
      map.set(id, e);
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  }, [leads, bookings, profileMap]);

  const fmtINR = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
  const maxRevenue = Math.max(1, ...productivity.map((p) => p.revenue));
  const maxFunnel = Math.max(1, ...funnel.stages.map((s) => s.count));

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Management Analytics</h1>
        <p className="text-sm text-muted-foreground">Conversion funnel · SLA breaches · Agent productivity.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={Users} label="Total leads" value={String(funnel.total)} tone="blue" />
        <KpiCard icon={TrendingUp} label="Conversion" value={`${funnel.conversionRate.toFixed(1)}%`} tone="emerald" />
        <KpiCard icon={AlertTriangle} label="SLA breaches" value={String(sla.total)} tone="rose" />
        <KpiCard icon={ActivityIcon} label="SLA compliance" value={`${sla.complianceRate.toFixed(0)}%`} tone="amber" />
      </div>

      {/* Funnel */}
      <Card>
        <CardHeader><CardTitle className="text-base">Conversion Funnel</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {funnel.stages.map((s) => {
            const pct = funnel.total > 0 ? (s.count / funnel.total) * 100 : 0;
            const widthPct = (s.count / maxFunnel) * 100;
            return (
              <div key={s.id} className="flex items-center gap-3">
                <div className="w-40 shrink-0 text-sm flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${s.color}`} />{s.label}
                </div>
                <div className="flex-1 h-7 bg-muted rounded relative overflow-hidden">
                  <div className={`absolute inset-y-0 left-0 ${s.color} opacity-80 rounded`} style={{ width: `${widthPct}%` }} />
                  <div className="absolute inset-0 flex items-center px-2 text-xs font-medium">
                    {s.count} <span className="text-muted-foreground ml-2">({pct.toFixed(1)}%)</span>
                  </div>
                </div>
              </div>
            );
          })}
          <div className="flex gap-3 pt-3 text-sm border-t mt-3">
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Won {funnel.won}</Badge>
            <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">Lost {funnel.lost}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* SLA Breaches */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-rose-600" /> Follow-up SLA Breaches</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <SlaPill label="< 1 day" count={sla.buckets.mild} tone="amber" />
            <SlaPill label="1–3 days" count={sla.buckets.medium} tone="orange" />
            <SlaPill label="3+ days" count={sla.buckets.severe} tone="rose" />
          </div>
          <div>
            <div className="text-sm font-medium mb-2">Top offenders</div>
            {sla.ownerList.length === 0 ? (
              <div className="text-sm text-muted-foreground">No SLA breaches 🎉</div>
            ) : (
              <div className="space-y-1.5">
                {sla.ownerList.map((o) => (
                  <div key={o.id} className="flex items-center gap-3">
                    <div className="flex-1 text-sm">{o.name}</div>
                    <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
                      <div className="h-full bg-rose-500" style={{ width: `${(o.count / sla.ownerList[0].count) * 100}%` }} />
                    </div>
                    <Badge variant="outline">{o.count}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Productivity */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><IndianRupee className="h-4 w-4 text-emerald-600" /> Agent Productivity</CardTitle></CardHeader>
        <CardContent>
          {productivity.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-6">No data yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2">Agent</th>
                    <th className="text-right">Leads</th>
                    <th className="text-right">Bookings</th>
                    <th className="text-right">Revenue</th>
                    <th className="text-right">Received</th>
                    <th className="text-left pl-4 w-1/3">Revenue share</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {productivity.map((p) => (
                    <tr key={p.name} className="hover:bg-muted/30">
                      <td className="py-2 font-medium">{p.name}</td>
                      <td className="text-right">{p.leads}</td>
                      <td className="text-right">{p.bookings}</td>
                      <td className="text-right">{fmtINR(p.revenue)}</td>
                      <td className="text-right text-emerald-600">{fmtINR(p.received)}</td>
                      <td className="pl-4">
                        <div className="h-2 bg-muted rounded overflow-hidden">
                          <div className="h-full bg-emerald-500" style={{ width: `${(p.revenue / maxRevenue) * 100}%` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: string }) {
  const tones: Record<string, string> = {
    blue: "from-blue-500/10 to-blue-500/5 text-blue-600",
    emerald: "from-emerald-500/10 to-emerald-500/5 text-emerald-600",
    amber: "from-amber-500/10 to-amber-500/5 text-amber-600",
    rose: "from-rose-500/10 to-rose-500/5 text-rose-600",
  };
  return (
    <Card className={`bg-gradient-to-br ${tones[tone]}`}>
      <CardContent className="p-4 flex items-center gap-3">
        <Icon className="h-7 w-7" />
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function SlaPill({ label, count, tone }: { label: string; count: number; tone: string }) {
  const tones: Record<string, string> = {
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    orange: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
    rose: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  };
  return (
    <div className={`p-3 rounded-lg ${tones[tone]}`}>
      <div className="text-xs">{label} overdue</div>
      <div className="text-2xl font-bold">{count}</div>
    </div>
  );
}
