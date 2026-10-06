// B2B Performance analytics body — prospects added by month, contact rate,
// response rate, meetings, partnerships and referrals over the filtered window.
// Thin route renders this; recharts stays in this chunk, out of the entry
// bundle.

import { useState, useMemo } from "react";
import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FilterBar,
  SimpleBarChart,
  SimpleLineChart,
  DEFAULT_FILTERS,
  type AnalyticsFilters,
} from "@/components/b2b/analytics-shared";
import { useB2BAnalytics } from "@/components/b2b/analytics/use-analytics";
import {
  buildFunnel,
  contactRate,
  responseRate,
  monthlyTrend,
  activityBreakdown,
} from "@/lib/b2b-analytics";

export function B2BPerformanceAnalytics() {
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS);
  const a = useB2BAnalytics(filters);
  const { leads, referrals, activities, followups } = a.filtered;

  const prospectsByMonth = useMemo(
    () => monthlyTrend(leads, (l) => l.created_at).map((p) => ({ label: p.month, value: p.count })),
    [leads],
  );
  const referralsByMonth = useMemo(
    () =>
      monthlyTrend(referrals, (r) => r.referral_date ?? r.date_received ?? r.created_at).map(
        (p) => ({
          label: p.month,
          value: p.count,
        }),
      ),
    [referrals],
  );
  const contact = useMemo(() => contactRate(leads), [leads]);
  const response = useMemo(() => responseRate(leads), [leads]);
  const funnel = useMemo(() => buildFunnel(leads), [leads]);
  const act = useMemo(() => activityBreakdown(activities, followups), [activities, followups]);

  return (
    <div className="space-y-4">
      <PageHeader title="B2B Performance" subtitle="Prospecting, contact and response funnel" />
      <FilterBar
        filters={filters}
        onChange={setFilters}
        users={a.users}
        sources={a.sources}
        cities={a.cities}
        states={a.states}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Prospects" value={contact.total} />
        <Stat
          label="Contact rate"
          value={`${contact.rate}%`}
          hint={`${contact.contacted} contacted`}
        />
        <Stat
          label="Response rate"
          value={`${response.rate}%`}
          hint={`${response.responded} responded`}
        />
        <Stat label="Meetings" value={act.meetings} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SimpleBarChart title="Prospects added by month" data={prospectsByMonth} />
        <SimpleLineChart title="Referrals by month" data={referralsByMonth} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Partnership funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Stage</th>
                  <th className="text-right">Count</th>
                  <th className="text-right">% of top</th>
                  <th className="text-right">Step %</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {funnel.map((s) => (
                  <tr key={s.id} className="hover:bg-muted/30">
                    <td className="py-2 font-medium">{s.label}</td>
                    <td className="text-right tabular-nums">{s.count}</td>
                    <td className="text-right tabular-nums">{s.conversionFromTop}%</td>
                    <td className="text-right tabular-nums">{s.conversionFromPrev}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="flex items-center gap-3">
      <div className="grid size-10 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
        <TrendingUp className="h-5 w-5" />
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </header>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}
