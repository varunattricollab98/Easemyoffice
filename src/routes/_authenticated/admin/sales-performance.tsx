import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMemo } from "react";
import { Users, Trophy, IndianRupee, Percent } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/sales-performance")({
  head: () => ({ meta: [{ title: "Sales Performance — EaseMyOffice CRM" }] }),
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/login" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
    if (!(roles ?? []).some((r: any) => r.role === "admin")) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: SalesPerformancePage,
});

const WON_STAGES = ["completed", "agreement_signed"];

type Row = {
  id: string;
  name: string;
  leads: number;
  won: number;
  overdue: number;
  bookings: number;
  revenue: number;
  received: number;
};

function SalesPerformancePage() {
  const { data: leads = [] } = useQuery({
    queryKey: ["perf-leads"],
    queryFn: async () => {
      const { data } = await supabase.from("leads").select("id, stage, assigned_to").limit(5000);
      return data ?? [];
    },
  });

  const { data: followups = [] } = useQuery({
    queryKey: ["perf-followups"],
    queryFn: async () => {
      const { data } = await supabase.from("follow_ups").select("id, owner_id, status, due_at").limit(5000);
      return data ?? [];
    },
  });

  const { data: bookings = [] } = useQuery({
    queryKey: ["perf-bookings"],
    queryFn: async () => {
      const { data } = await supabase.from("bookings").select("id, sales_agent_id, sales_agent_name, total_amount, amount_received").limit(5000);
      return data ?? [];
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["perf-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email");
      return data ?? [];
    },
  });

  const rows = useMemo<Row[]>(() => {
    const now = Date.now();
    const map = new Map<string, Row>();
    const nameOf = (id: string) => {
      const p = (profiles as any[]).find((x) => x.id === id);
      return p?.full_name || p?.email || "Unknown";
    };
    const ensure = (id: string, fallbackName?: string): Row => {
      let r = map.get(id);
      if (!r) { r = { id, name: fallbackName || nameOf(id), leads: 0, won: 0, overdue: 0, bookings: 0, revenue: 0, received: 0 }; map.set(id, r); }
      return r;
    };

    (leads as any[]).forEach((l) => {
      if (!l.assigned_to) return;
      const r = ensure(l.assigned_to);
      r.leads++;
      if (WON_STAGES.includes(l.stage)) r.won++;
    });

    (followups as any[]).forEach((f) => {
      if (!f.owner_id) return;
      if (f.status === "pending" && f.due_at && new Date(f.due_at).getTime() < now) {
        ensure(f.owner_id).overdue++;
      }
    });

    (bookings as any[]).forEach((b) => {
      const id = b.sales_agent_id;
      if (!id) return;
      const r = ensure(id, b.sales_agent_name);
      r.bookings++;
      r.revenue += Number(b.total_amount ?? 0);
      r.received += Number(b.amount_received ?? 0);
    });

    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue || b.won - a.won || b.leads - a.leads);
  }, [leads, followups, bookings, profiles]);

  const totals = useMemo(() => {
    const t = rows.reduce((acc, r) => {
      acc.leads += r.leads; acc.won += r.won; acc.revenue += r.revenue; acc.received += r.received;
      return acc;
    }, { leads: 0, won: 0, revenue: 0, received: 0 });
    return { ...t, winRate: t.leads > 0 ? (t.won / t.leads) * 100 : 0 };
  }, [rows]);

  const fmtINR = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
  const maxRevenue = Math.max(1, ...rows.map((r) => r.revenue));

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Sales Performance</h1>
        <p className="text-sm text-muted-foreground">Per-person leads, conversions, revenue &amp; follow-up health.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={Users} label="Total leads" value={String(totals.leads)} tone="blue" />
        <KpiCard icon={Trophy} label="Total won" value={String(totals.won)} tone="emerald" />
        <KpiCard icon={Percent} label="Win rate" value={`${totals.winRate.toFixed(1)}%`} tone="amber" />
        <KpiCard icon={IndianRupee} label="Total revenue" value={fmtINR(totals.revenue)} tone="violet" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">By salesperson</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">No data yet. Assign some leads or add bookings.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2">Salesperson</th>
                    <th className="text-right">Leads</th>
                    <th className="text-right">Won</th>
                    <th className="text-right">Win %</th>
                    <th className="text-right">Overdue</th>
                    <th className="text-right">Bookings</th>
                    <th className="text-right">Revenue</th>
                    <th className="text-right">Received</th>
                    <th className="text-left pl-4 w-[22%]">Revenue share</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => {
                    const winRate = r.leads > 0 ? (r.won / r.leads) * 100 : 0;
                    return (
                      <tr key={r.id} className="hover:bg-muted/30">
                        <td className="py-2 font-medium">{r.name}</td>
                        <td className="text-right">{r.leads}</td>
                        <td className="text-right text-emerald-600 font-medium">{r.won}</td>
                        <td className="text-right">{winRate.toFixed(0)}%</td>
                        <td className={`text-right ${r.overdue > 0 ? "text-destructive font-medium" : "text-muted-foreground"}`}>{r.overdue}</td>
                        <td className="text-right">{r.bookings}</td>
                        <td className="text-right">{fmtINR(r.revenue)}</td>
                        <td className="text-right text-emerald-600">{fmtINR(r.received)}</td>
                        <td className="pl-4">
                          <div className="h-2 bg-muted rounded overflow-hidden">
                            <div className="h-full bg-emerald-500" style={{ width: `${(r.revenue / maxRevenue) * 100}%` }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        "Won" counts leads in the <span className="font-medium">Agreement Signed</span> or <span className="font-medium">Completed</span> stage.
        Revenue is the total booking amount recorded for each salesperson.
      </p>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: string }) {
  const tones: Record<string, string> = {
    blue: "from-blue-500/10 to-blue-500/5 text-blue-600",
    emerald: "from-emerald-500/10 to-emerald-500/5 text-emerald-600",
    amber: "from-amber-500/10 to-amber-500/5 text-amber-600",
    violet: "from-violet-500/10 to-violet-500/5 text-violet-600",
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
