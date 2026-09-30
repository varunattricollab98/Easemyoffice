import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { guardRoles } from "@/lib/route-guard";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import {
  Users,
  Trophy,
  IndianRupee,
  Percent,
  Phone,
  FileText,
  Wallet,
  Gauge,
  TrendingUp,
  TrendingDown,
  Download,
  Info,
} from "lucide-react";
import { HeroOfMonth } from "@/components/dashboard/hero-of-month";
import { useAuth } from "@/lib/auth";
import { useDashboardScope } from "@/lib/dashboard-queries";
import { formatINR } from "@/lib/utils";
import { PERIOD_OPTIONS, resolvePeriod, growthPct, type PeriodId } from "@/lib/report-period";
import { PRODUCTIVITY_WEIGHTS, type AgentMetrics } from "@/lib/report-metrics";
import { salesReportQuery } from "@/lib/report-queries";
import { SERVICES, SOURCES } from "@/lib/crm";
import { useMemo } from "react";

const PERIOD_IDS = PERIOD_OPTIONS.map((p) => p.id) as string[];

type ReportSearch = { period?: PeriodId; from?: string; to?: string };

export const Route = createFileRoute("/_authenticated/admin/sales-performance")({
  head: () => ({ meta: [{ title: "Sales Performance — EaseMyOffice CRM" }] }),
  // Period lives in the URL so a report can be bookmarked and shared, matching
  // how the Leads date filter (#67) models its range.
  validateSearch: (s: Record<string, unknown>): ReportSearch => ({
    period:
      typeof s.period === "string" && PERIOD_IDS.includes(s.period)
        ? (s.period as PeriodId)
        : undefined,
    from: typeof s.from === "string" ? s.from : undefined,
    to: typeof s.to === "string" ? s.to : undefined,
  }),
  // Widened from admin-only: a rep needs to see their own productivity. RLS
  // does the actual containment — a sales user's queries only ever return
  // their own leads, bookings and activities.
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "sales", "bd"]);
  },
  component: SalesPerformancePage,
});

function SalesPerformancePage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { isAdmin } = useAuth();
  const scope = useDashboardScope();

  const periodId: PeriodId = search.period ?? "this_month";
  const period = useMemo(
    () => resolvePeriod(periodId, { from: search.from, to: search.to }),
    [periodId, search.from, search.to],
  );

  const { data, isLoading } = useQuery(salesReportQuery(scope, period));

  const setPeriod = (id: PeriodId) => navigate({ search: (prev) => ({ ...prev, period: id }) });

  const team = data?.team;
  const prev = data?.previous;
  // A scoped (non-cross-team) user is looking at their own numbers only, so the
  // page must not call them "team" figures.
  const own = scope.scoped;

  const exportCsv = () => {
    if (!data) return;
    const header = [
      "Rank",
      "Salesperson",
      "Productivity",
      "Leads assigned",
      "Closures",
      "Conversion %",
      "Revenue",
      "Collected",
      "Avg deal",
      "Calls",
      "WhatsApp",
      "Quotations",
      "Follow-ups done",
      "Follow-ups overdue",
      "Discipline %",
      "Lost",
    ];
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      header.join(","),
      ...data.agents.map((a) =>
        [
          a.rank,
          a.name,
          a.productivity,
          a.leadsAssigned,
          a.closures,
          a.conversionPct,
          Math.round(a.revenue),
          Math.round(a.collected),
          a.avgDeal,
          a.calls,
          a.whatsapp,
          a.quotations,
          a.followupsDone,
          a.followupsOverdue,
          a.disciplinePct,
          a.lost,
        ]
          .map(esc)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-performance-${period.fromDate}_to_${period.toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const chartConfig = {
    revenue: { label: "Revenue", color: "var(--chart-1, oklch(0.62 0.19 260))" },
    closures: { label: "Closures", color: "var(--chart-2, oklch(0.7 0.17 160))" },
  } satisfies ChartConfig;

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {own ? "My Performance" : "Sales Performance"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {own
              ? "Your closures, conversions, activity and productivity index."
              : "Closures, conversions, revenue, activity and productivity index per salesperson."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={!data || data.agents.length === 0}
        >
          <Download className="h-4 w-4 mr-1" /> Export CSV
        </Button>
      </div>

      {/* Period filter */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          {PERIOD_OPTIONS.map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant={periodId === p.id ? "default" : "outline"}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </Button>
          ))}
          {periodId === "custom" && (
            <div className="flex items-center gap-2 ml-1">
              <Input
                type="date"
                className="h-9 w-auto"
                value={search.from ?? ""}
                onChange={(e) =>
                  navigate({ search: (prev) => ({ ...prev, from: e.target.value || undefined }) })
                }
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                className="h-9 w-auto"
                value={search.to ?? ""}
                onChange={(e) =>
                  navigate({ search: (prev) => ({ ...prev, to: e.target.value || undefined }) })
                }
              />
            </div>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {period.fromDate} → {period.toDate} · compared with {period.previous.fromDate} →{" "}
            {period.previous.toDate}
          </span>
        </CardContent>
      </Card>

      {data?.truncated && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          This period returned more rows than the 5,000-row read limit, so the figures below are
          incomplete. Narrow the period for accurate numbers.
        </div>
      )}

      {/* Headline metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          icon={Users}
          label="Leads assigned"
          value={String(team?.leadsAssigned ?? 0)}
          delta={growthPct(team?.leadsAssigned ?? 0, prev?.leadsAssigned ?? 0)}
          tone="blue"
          loading={isLoading}
        />
        <MetricCard
          icon={Trophy}
          label="Closures"
          value={String(team?.closures ?? 0)}
          delta={growthPct(team?.closures ?? 0, prev?.closures ?? 0)}
          tone="emerald"
          loading={isLoading}
        />
        <MetricCard
          icon={Percent}
          label="Conversion"
          value={`${team?.conversionPct ?? 0}%`}
          delta={growthPct(team?.conversionPct ?? 0, prev?.conversionPct ?? 0)}
          tone="amber"
          loading={isLoading}
        />
        <MetricCard
          icon={IndianRupee}
          label="Output (revenue)"
          value={formatINR(team?.revenue ?? 0)}
          delta={growthPct(team?.revenue ?? 0, prev?.revenue ?? 0)}
          tone="violet"
          loading={isLoading}
        />
        <MetricCard
          icon={Wallet}
          label="Collected"
          value={formatINR(team?.collected ?? 0)}
          tone="emerald"
          loading={isLoading}
        />
        <MetricCard
          icon={Phone}
          label="Calls made"
          value={String(team?.calls ?? 0)}
          hint={`+ ${team?.whatsapp ?? 0} WhatsApp`}
          tone="blue"
          loading={isLoading}
        />
        <MetricCard
          icon={FileText}
          label="Quotations shared"
          value={String(team?.quotations ?? 0)}
          tone="amber"
          loading={isLoading}
        />
        <MetricCard
          icon={Gauge}
          label={own ? "My productivity" : "Team productivity"}
          value={`${team?.productivity ?? 0}/100`}
          hint={own ? undefined : `${team?.activeAgents ?? 0} active`}
          tone="violet"
          loading={isLoading}
        />
      </div>

      {/* Trend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Closures &amp; revenue over the period</CardTitle>
        </CardHeader>
        <CardContent>
          {!data || data.trend.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-10">
              No bookings in this period.
            </div>
          ) : (
            <ChartContainer config={chartConfig} className="h-[260px] w-full">
              <ComposedChart data={data.trend}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis yAxisId="rev" tickLine={false} axisLine={false} fontSize={11} width={54} />
                <YAxis
                  yAxisId="cnt"
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  width={30}
                  allowDecimals={false}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar yAxisId="rev" dataKey="revenue" fill="var(--color-revenue)" radius={4} />
                <Line
                  yAxisId="cnt"
                  type="monotone"
                  dataKey="closures"
                  stroke="var(--color-closures)"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Leaderboard */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{own ? "My numbers" : "By salesperson"}</CardTitle>
        </CardHeader>
        <CardContent>
          {!data || data.agents.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              Nothing recorded in this period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 w-8">#</th>
                    <th className="text-left">Salesperson</th>
                    <th className="text-right">Index</th>
                    <th className="text-right">Leads</th>
                    <th className="text-right">Closures</th>
                    <th className="text-right">Conv %</th>
                    <th className="text-right">Revenue</th>
                    <th className="text-right">Growth</th>
                    <th className="text-right">Avg deal</th>
                    <th className="text-right">Calls</th>
                    <th className="text-right">Quotes</th>
                    <th className="text-right">Overdue</th>
                    <th className="text-right">Disc %</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.agents.map((a) => (
                    <AgentRow key={a.id} a={a} prev={prev?.byAgent.get(a.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Conversion by source */}
      {data && data.bySource.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Conversion by lead source</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2">Source</th>
                    <th className="text-right">Leads</th>
                    <th className="text-right">Closures</th>
                    <th className="text-right">Conv %</th>
                    <th className="text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.bySource.map((s) => (
                    <tr key={s.source} className="hover:bg-muted/30">
                      <td className="py-2 font-medium">
                        {SOURCES.find((x) => x.id === s.source)?.label ??
                          SERVICES.find((x) => x.id === s.source)?.label ??
                          s.source}
                      </td>
                      <td className="text-right">{s.leads}</td>
                      <td className="text-right text-emerald-600 font-medium">{s.closures}</td>
                      <td className="text-right">{s.conversionPct}%</td>
                      <td className="text-right">{formatINR(s.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Only bookings created through “Convert to Booking” carry a lead link, so closures here
              understate any period before that flow shipped.
            </p>
          </CardContent>
        </Card>
      )}

      {/* All-time bookings dashboard, unchanged */}
      {!own && (
        <div className="pt-2">
          <h2 className="text-lg font-semibold">All-time bookings snapshot</h2>
          <p className="text-sm text-muted-foreground">Not affected by the period filter above.</p>
        </div>
      )}
      {!own && <HeroOfMonth />}

      {/* How the numbers are defined — reporting nobody can interpret is worse
          than no reporting, and several of these definitions are approximations
          forced by the schema. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4 w-4" /> How these numbers are calculated
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1.5">
          <p>
            <strong className="text-foreground">Leads assigned</strong> — leads created in the
            period that currently sit with the rep. There is no “assigned at” timestamp in the
            database, so a lead reassigned later counts for its current owner.
          </p>
          <p>
            <strong className="text-foreground">Closures</strong> — bookings whose booking date
            falls in the period, excluding renewals.
          </p>
          <p>
            <strong className="text-foreground">Conversion</strong> — closures ÷ leads assigned in
            the same period. Both sides are period-bound, so a lead closed the month after it
            arrived is not paired with its own lead.
          </p>
          <p>
            <strong className="text-foreground">Output (revenue)</strong> — amount after TDS,
            falling back to the gross total. <strong className="text-foreground">Collected</strong>{" "}
            is cash actually received, which is lower whenever a payment is partial.
          </p>
          <p>
            <strong className="text-foreground">Calls</strong> — timeline call entries, covering
            both manual logs and TeleCMI-captured calls, counted once.{" "}
            <strong className="text-foreground">Quotations</strong> — quotation sends recorded on
            the lead timeline.
          </p>
          <p>
            <strong className="text-foreground">Growth</strong> — versus the preceding window of the
            same length ({period.previous.fromDate} → {period.previous.toDate}), not the previous
            calendar month, so a part-finished month is not compared against a complete one.
          </p>
          <p>
            <strong className="text-foreground">Productivity index</strong> — weighted 0–100:
            closures {Math.round(PRODUCTIVITY_WEIGHTS.closures * 100)}%, revenue{" "}
            {Math.round(PRODUCTIVITY_WEIGHTS.revenue * 100)}%, conversion{" "}
            {Math.round(PRODUCTIVITY_WEIGHTS.conversion * 100)}%, activity{" "}
            {Math.round(PRODUCTIVITY_WEIGHTS.activity * 100)}%, follow-up discipline{" "}
            {Math.round(PRODUCTIVITY_WEIGHTS.discipline * 100)}%. Volume parts are scored relative
            to the best performer in the period because the CRM holds no targets — so the leader
            always sits near 100, and it measures standing rather than quota attainment.
          </p>
          {own && (
            <p className="text-foreground">
              You are seeing only your own records. Team-wide figures are visible to admins.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AgentRow({ a, prev }: { a: AgentMetrics; prev?: { closures: number; revenue: number } }) {
  const delta = growthPct(a.revenue, prev?.revenue ?? 0);
  return (
    <tr className="hover:bg-muted/30">
      <td className="py-2 text-muted-foreground">{a.rank}</td>
      <td className="font-medium">{a.name}</td>
      <td className="text-right">
        <Badge variant={a.productivity >= 70 ? "default" : "secondary"}>{a.productivity}</Badge>
      </td>
      <td className="text-right">{a.leadsAssigned}</td>
      <td className="text-right text-emerald-600 font-medium">{a.closures}</td>
      <td className="text-right">{a.conversionPct}%</td>
      <td className="text-right">{formatINR(a.revenue)}</td>
      <td className="text-right">
        <Delta value={delta} />
      </td>
      <td className="text-right">{formatINR(a.avgDeal)}</td>
      <td className="text-right">{a.calls}</td>
      <td className="text-right">{a.quotations}</td>
      <td
        className={`text-right ${a.followupsOverdue > 0 ? "text-destructive font-medium" : "text-muted-foreground"}`}
      >
        {a.followupsOverdue}
      </td>
      <td className="text-right">{a.disciplinePct}%</td>
    </tr>
  );
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const up = value >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={`inline-flex items-center gap-0.5 ${up ? "text-emerald-600" : "text-destructive"}`}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(value)}%
    </span>
  );
}

// Local rather than the dashboard's KpiTile: that component takes `value: number`
// and animates it with CountUp, so it cannot render "₹1,20,000", "34%" or a
// period-over-period delta chip.
function MetricCard({
  icon: Icon,
  label,
  value,
  delta,
  hint,
  tone,
  loading,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  delta?: number | null;
  hint?: string;
  tone: "blue" | "emerald" | "amber" | "violet";
  loading?: boolean;
}) {
  const tones: Record<string, string> = {
    blue: "from-blue-500/10 to-blue-500/5 text-blue-600",
    emerald: "from-emerald-500/10 to-emerald-500/5 text-emerald-600",
    amber: "from-amber-500/10 to-amber-500/5 text-amber-600",
    violet: "from-violet-500/10 to-violet-500/5 text-violet-600",
  };
  return (
    <Card className={`bg-gradient-to-br ${tones[tone]}`}>
      <CardContent className="p-4 flex items-start gap-3">
        <Icon className="h-6 w-6 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-bold truncate">{loading ? "…" : value}</div>
          <div className="flex items-center gap-2">
            {delta !== undefined && <Delta value={delta} />}
            {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
