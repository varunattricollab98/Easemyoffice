// Employee Performance analytics body — the per-employee leaderboard with every
// tracked column plus a revenue-by-employee chart.

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
import { employeeLeaderboard } from "@/lib/b2b-analytics";

export function B2BEmployeeAnalytics() {
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS);
  const a = useB2BAnalytics(filters);
  const { leads, firms, referrals, activities, followups } = a.filtered;

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of a.users) map.set(u.id, u.full_name || u.email || "Unknown");
    return (id: string) => map.get(id) ?? "Unknown";
  }, [a.users]);

  const rows = useMemo(
    () =>
      employeeLeaderboard({
        leads,
        activities,
        referrals,
        firms,
        followups,
        bookingRevenue: a.all.bookingRevenue,
      }),
    [leads, activities, referrals, firms, followups, a.all.bookingRevenue],
  );

  const revenueByEmployee = rows.map((r) => ({ label: nameOf(r.employeeId), value: r.revenue }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Employee Performance"
        subtitle="Per-employee prospecting, partnerships and revenue"
      />
      <FilterBar
        filters={filters}
        onChange={setFilters}
        users={a.users}
        sources={a.sources}
        cities={a.cities}
        states={a.states}
      />

      <SimpleBarChart
        title="Revenue by employee"
        data={revenueByEmployee}
        valueKey="revenue"
        money
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Employee leaderboard</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No employee activity in this window.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 text-left">Employee</th>
                    <th className="text-right">Prospects</th>
                    <th className="text-right">Contacted</th>
                    <th className="text-right">Calls</th>
                    <th className="text-right">Follow-ups</th>
                    <th className="text-right">Meetings</th>
                    <th className="text-right">Partners</th>
                    <th className="text-right">Referrals</th>
                    <th className="text-right">Bookings</th>
                    <th className="text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.employeeId} className="hover:bg-muted/30">
                      <td className="py-2 font-medium">{nameOf(r.employeeId)}</td>
                      <td className="text-right tabular-nums">{r.prospectsAssigned}</td>
                      <td className="text-right tabular-nums">{r.prospectsContacted}</td>
                      <td className="text-right tabular-nums">{r.calls}</td>
                      <td className="text-right tabular-nums">{r.followups}</td>
                      <td className="text-right tabular-nums">{r.meetings}</td>
                      <td className="text-right tabular-nums">{r.partnersOnboarded}</td>
                      <td className="text-right tabular-nums">{r.referrals}</td>
                      <td className="text-right tabular-nums">{r.bookings}</td>
                      <td className="text-right tabular-nums">{formatINR(r.revenue)}</td>
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
