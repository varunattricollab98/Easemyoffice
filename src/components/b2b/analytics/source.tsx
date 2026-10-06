// Source Analytics body — the per-source funnel through to Bookings/Revenue.
// Reads the CONFIGURABLE b2b_sources list (via useB2BAnalytics -> listSources),
// never a hardcoded source array, so new sources the team adds appear here
// automatically.

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/utils";
import {
  FilterBar,
  SimpleBarChart,
  DEFAULT_FILTERS,
  type AnalyticsFilters,
} from "@/components/b2b/analytics-shared";
import { PageHeader } from "@/components/b2b/analytics/performance";
import { useB2BAnalytics } from "@/components/b2b/analytics/use-analytics";
import { sourceRollups } from "@/lib/b2b-analytics";

export function B2BSourceAnalytics() {
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS);
  const a = useB2BAnalytics(filters);
  const { leads, firms, referrals } = a.filtered;

  const rollups = useMemo(
    () =>
      sourceRollups({
        sources: a.sources,
        leads,
        firms,
        referrals,
        bookingRevenue: a.all.bookingRevenue,
      }),
    [a.sources, leads, firms, referrals, a.all.bookingRevenue],
  );

  const prospectsBySource = rollups.map((r) => ({ label: r.label, value: r.prospects }));
  const revenueBySource = rollups.map((r) => ({ label: r.label, value: r.revenue }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Source Analytics"
        subtitle="Per-source funnel through to bookings and revenue"
      />
      <FilterBar
        filters={filters}
        onChange={setFilters}
        users={a.users}
        sources={a.sources}
        cities={a.cities}
        states={a.states}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <SimpleBarChart title="Prospects by source" data={prospectsBySource} />
        <SimpleBarChart
          title="Revenue by source"
          data={revenueBySource}
          color="var(--chart-2, oklch(0.7 0.17 160))"
          valueKey="revenue"
          money
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Source performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Source</th>
                  <th className="text-right">Prospects</th>
                  <th className="text-right">Contacted</th>
                  <th className="text-right">Interested</th>
                  <th className="text-right">Meetings</th>
                  <th className="text-right">Partners</th>
                  <th className="text-right">Referrals</th>
                  <th className="text-right">Bookings</th>
                  <th className="text-right">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rollups.map((s) => (
                  <tr key={s.source} className="hover:bg-muted/30">
                    <td className="py-2 font-medium">{s.label}</td>
                    <td className="text-right">{s.prospects}</td>
                    <td className="text-right">{s.contacted}</td>
                    <td className="text-right">{s.interested}</td>
                    <td className="text-right">{s.meetings}</td>
                    <td className="text-right">{s.partners}</td>
                    <td className="text-right">{s.referrals}</td>
                    <td className="text-right">{s.bookings}</td>
                    <td className="text-right">{formatINR(s.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Sources are read from the configurable B2B source list, so any source the team adds
            appears here automatically.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
