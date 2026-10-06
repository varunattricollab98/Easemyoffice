// Shared data + filtering hook for the four B2B Analytics screens.
//
// Fetches the raw analytics dataset once (b2bAnalyticsQuery), fetches the
// assignable users and the CONFIGURABLE b2b_sources list, then applies the
// shared filter bar selections to produce the filtered rows each screen feeds
// to the pure maths in src/lib/b2b-analytics.ts. The source list drives both
// the Source filter and the per-source roll-up, so Source Analytics is never
// hardcoded against the seed constants.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { b2bAnalyticsQuery, type B2BAnalyticsData } from "@/lib/b2b-analytics-queries";
import { listAssignableUsers, listSources, type AssignableUser } from "@/lib/b2b-queries";
import type { SourceOption } from "@/lib/b2b-analytics";
import { B2B_SOURCES } from "@/lib/b2b";
import { resolvePeriod } from "@/lib/report-period";
import { type AnalyticsFilters, monthToRange } from "@/components/b2b/analytics-shared";

const empty: B2BAnalyticsData = {
  leads: [],
  activities: [],
  referrals: [],
  firms: [],
  followups: [],
  bookingRevenue: new Map(),
};

export function useB2BAnalytics(filters: AnalyticsFilters) {
  const { data = empty, isLoading } = useQuery(b2bAnalyticsQuery());
  const { data: users = [] } = useQuery({
    queryKey: ["b2b-assignable-users"],
    staleTime: 300_000,
    queryFn: listAssignableUsers,
  });
  // The CONFIGURABLE source list — read from b2b_sources, falling back to the
  // seed constants only when the table is empty, so Source Analytics reflects
  // whatever sources the team has configured.
  const { data: sourceRows = [] } = useQuery({
    queryKey: ["b2b-sources", "active"],
    staleTime: 300_000,
    queryFn: () => listSources(true),
  });

  const sources: SourceOption[] = useMemo(() => {
    if (sourceRows.length > 0) return sourceRows.map((s) => ({ id: s.name, label: s.name }));
    return B2B_SOURCES.map((s) => ({ id: s.id, label: s.label }));
  }, [sourceRows]);

  // Distinct cities / states for the filter dropdowns.
  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const f of data.firms) if (f.city) set.add(f.city);
    for (const l of data.leads) if (l.city) set.add(l.city);
    return Array.from(set).sort();
  }, [data]);
  const states = useMemo(() => {
    const set = new Set<string>();
    for (const f of data.firms) if (f.state) set.add(f.state);
    for (const l of data.leads) if (l.state) set.add(l.state);
    return Array.from(set).sort();
  }, [data]);

  const period = useMemo(
    () => resolvePeriod(filters.period, { from: filters.from, to: filters.to }),
    [filters.period, filters.from, filters.to],
  );

  // The active window: an explicit Month overrides the period buttons.
  const window = useMemo(() => {
    const m = monthToRange(filters.month);
    if (m) return m;
    return { from: new Date(period.fromISO).getTime(), to: new Date(period.toISO).getTime() + 1 };
  }, [filters.month, period]);

  const inWindow = (iso: string | null | undefined): boolean => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return Number.isFinite(t) && t >= window.from && t < window.to;
  };

  const filtered = useMemo(() => {
    const leads = data.leads.filter(
      (l) =>
        (!filters.employee || l.assigned_to === filters.employee) &&
        (!filters.city || l.city === filters.city) &&
        (!filters.state || l.state === filters.state) &&
        (!filters.source || l.lead_source === filters.source) &&
        (!filters.firmType || l.firm_type === filters.firmType) &&
        (!filters.leadStatus || l.lead_status === filters.leadStatus),
    );
    const firms = data.firms.filter(
      (f) =>
        (!filters.employee || f.assigned_to === filters.employee) &&
        (!filters.city || f.city === filters.city) &&
        (!filters.state || f.state === filters.state) &&
        (!filters.source || f.lead_source === filters.source) &&
        (!filters.firmType || f.firm_type === filters.firmType) &&
        (!filters.partnerStatus || f.partner_status === filters.partnerStatus),
    );
    const firmIds = new Set(firms.map((f) => f.id).filter(Boolean) as string[]);
    const referrals = data.referrals.filter(
      (r) =>
        (!filters.employee || r.assigned_salesperson === filters.employee) &&
        (!filters.source || (r.firm_id ? firmIds.has(r.firm_id) : false) || !filters.source) &&
        (!filters.city && !filters.state && !filters.firmType
          ? true
          : !r.firm_id || firmIds.has(r.firm_id)),
    );
    const activities = data.activities.filter(
      (a) => !filters.employee || a.created_by === filters.employee,
    );
    const followups = data.followups.filter(
      (f) => !filters.employee || f.assigned_to === filters.employee,
    );
    return { leads, firms, referrals, activities, followups };
  }, [data, filters]);

  return {
    isLoading,
    users: users as AssignableUser[],
    sources,
    cities,
    states,
    period,
    window,
    inWindow,
    all: data,
    filtered,
  };
}
