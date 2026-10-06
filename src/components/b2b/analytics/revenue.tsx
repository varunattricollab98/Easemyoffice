// Revenue Analytics body — bookings and revenue by month, plus revenue per
// active partner.

import { useState, useMemo } from "react";
import {
  FilterBar,
  SimpleBarChart,
  SimpleLineChart,
  DEFAULT_FILTERS,
  type AnalyticsFilters,
} from "@/components/b2b/analytics-shared";
import { PageHeader, Stat } from "@/components/b2b/analytics/performance";
import { useB2BAnalytics } from "@/components/b2b/analytics/use-analytics";
import { formatINR } from "@/lib/utils";
import { monthlyTrend, revenuePerPartner } from "@/lib/b2b-analytics";

export function B2BRevenueAnalytics() {
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS);
  const a = useB2BAnalytics(filters);
  const { firms, referrals } = a.filtered;
  const bookingRevenue = a.all.bookingRevenue;

  // Only referrals with a linked booking carry revenue.
  const booked = useMemo(() => referrals.filter((r) => r.booking_id), [referrals]);

  const revenueByMonth = useMemo(
    () =>
      monthlyTrend(
        booked,
        (r) => r.referral_date ?? r.date_received ?? r.created_at,
        (r) => (r.booking_id ? (bookingRevenue.get(r.booking_id) ?? 0) : 0),
      ).map((p) => ({ label: p.month, value: Math.round(p.revenue) })),
    [booked, bookingRevenue],
  );
  const bookingsByMonth = useMemo(
    () =>
      monthlyTrend(booked, (r) => r.referral_date ?? r.date_received ?? r.created_at).map((p) => ({
        label: p.month,
        value: p.count,
      })),
    [booked],
  );

  const rpp = useMemo(
    () => revenuePerPartner({ firms, referrals, bookingRevenue }),
    [firms, referrals, bookingRevenue],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Revenue Analytics"
        subtitle="B2B-sourced bookings, revenue and revenue per partner"
      />
      <FilterBar
        filters={filters}
        onChange={setFilters}
        users={a.users}
        sources={a.sources}
        cities={a.cities}
        states={a.states}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total revenue" value={formatINR(rpp.totalRevenue)} />
        <Stat label="Active partners" value={rpp.activePartners} />
        <Stat label="Revenue / partner" value={formatINR(rpp.revenuePerPartner)} />
        <Stat label="Bookings" value={booked.length} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SimpleBarChart title="Revenue by month" data={revenueByMonth} valueKey="revenue" money />
        <SimpleLineChart title="Bookings by month" data={bookingsByMonth} />
      </div>
    </div>
  );
}
