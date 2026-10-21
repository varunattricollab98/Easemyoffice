// The B2B department dashboard body.
//
// Heavy by design (KPI grid, a 10-stage funnel, the activity section, the
// employee leaderboard, partner health and the source table), so it lives here
// in src/components/b2b and the route file at
// src/routes/_authenticated/b2b/index.tsx stays thin — route-based code
// splitting then keeps this (and recharts, pulled in by the analytics screens)
// out of the entry chunk.
//
// Every number comes from the pure, tested maths in src/lib/b2b-analytics.ts;
// this component only fetches via b2bAnalyticsQuery and renders.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Phone,
  MessageSquare,
  Users,
  Bell,
  CalendarCheck,
  Share2,
  BookOpen,
  IndianRupee,
  Handshake,
  Sparkles,
  AlertTriangle,
  ArrowUpDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KpiTile } from "@/components/dashboard/widgets/kpi-tile";
import { QuickPunch } from "@/components/hrms/quick-punch";
import { formatINR } from "@/lib/utils";
import { b2bAnalyticsQuery } from "@/lib/b2b-analytics-queries";
import { listAssignableUsers, type AssignableUser } from "@/lib/b2b-queries";
import {
  buildFunnel,
  activityBreakdown,
  employeeLeaderboard,
  partnerHealthDistribution,
  sourceRollups,
  bookingValue,
  type EmployeeRow,
} from "@/lib/b2b-analytics";
import { PARTNER_HEALTH, B2B_SOURCES } from "@/lib/b2b";
import type { B2BAnalyticsData } from "@/lib/b2b-analytics-queries";

// Stable empty dataset so the `data ?? EMPTY` reference does not change identity
// between renders (which would otherwise re-run every memo on each render).
const EMPTY: B2BAnalyticsData = {
  leads: [],
  activities: [],
  referrals: [],
  firms: [],
  followups: [],
  bookingRevenue: new Map(),
};

function startOfWeekISO(now = new Date()): number {
  const d = new Date(now);
  const day = (d.getDay() + 6) % 7; // Monday-first
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}

function startOfMonthISO(now = new Date()): number {
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  return d.getTime();
}

export function B2BDashboard() {
  const { data, isLoading } = useQuery(b2bAnalyticsQuery());
  const { data: users = [] } = useQuery({
    queryKey: ["b2b-assignable-users"],
    staleTime: 300_000,
    queryFn: listAssignableUsers,
  });

  const now = Date.now();
  const weekStart = startOfWeekISO();
  const monthStart = startOfMonthISO();

  const { leads, activities, referrals, firms, followups, bookingRevenue } = data ?? EMPTY;

  // --- KPIs ----------------------------------------------------------------
  const kpis = useMemo(() => {
    const totalProspects = leads.length;
    const contacted = leads.filter(
      (l) =>
        [
          "contacted",
          "interested",
          "meeting_discussion",
          "meeting_scheduled",
          "meeting_completed",
          "partnership_discussion",
          "partner_onboarded",
          "first_referral",
          "active_partner",
        ].includes(l.lead_status ?? "") || !!l.last_contacted_at,
    ).length;
    const interested = leads.filter((l) =>
      [
        "interested",
        "meeting_discussion",
        "meeting_scheduled",
        "meeting_completed",
        "partnership_discussion",
        "partner_onboarded",
        "first_referral",
        "active_partner",
      ].includes(l.lead_status ?? ""),
    ).length;
    const activePartners = firms.filter((f) =>
      ["strategic", "active"].includes(f.partner_status ?? ""),
    ).length;
    const followupsDue = followups.filter(
      (f) => f.status === "pending" && f.due_at && new Date(f.due_at).getTime() <= now,
    ).length;
    const meetingsThisWeek = activities.filter(
      (a) =>
        a.type === "meeting" && a.happened_at && new Date(a.happened_at).getTime() >= weekStart,
    ).length;
    const referralsThisMonth = referrals.filter((r) => {
      const d = r.referral_date ?? r.date_received ?? r.created_at;
      return d && new Date(d).getTime() >= monthStart;
    }).length;
    const monthReferralsWithBooking = referrals.filter((r) => {
      const d = r.referral_date ?? r.date_received ?? r.created_at;
      return r.booking_id && d && new Date(d).getTime() >= monthStart;
    });
    const b2bBookingsThisMonth = monthReferralsWithBooking.length;
    const b2bRevenueThisMonth = Math.round(
      monthReferralsWithBooking.reduce(
        (s, r) => s + (r.booking_id ? (bookingRevenue.get(r.booking_id) ?? 0) : 0),
        0,
      ),
    );
    return {
      totalProspects,
      contacted,
      interested,
      activePartners,
      followupsDue,
      meetingsThisWeek,
      referralsThisMonth,
      b2bBookingsThisMonth,
      b2bRevenueThisMonth,
    };
  }, [leads, firms, followups, activities, referrals, bookingRevenue, now, weekStart, monthStart]);

  const funnel = useMemo(() => buildFunnel(leads), [leads]);
  const activity = useMemo(
    () => activityBreakdown(activities, followups, now),
    [activities, followups, now],
  );
  const health = useMemo(() => partnerHealthDistribution(firms), [firms]);
  const sources = useMemo(() => {
    const seed = B2B_SOURCES.map((s) => ({ id: s.id, label: s.label }));
    return sourceRollups({ sources: seed, leads, firms, referrals, bookingRevenue });
  }, [leads, firms, referrals, bookingRevenue]);

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of users as AssignableUser[]) map.set(u.id, u.full_name || u.email || "Unknown");
    return (id: string) => map.get(id) ?? "Unknown";
  }, [users]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="grid size-10 place-items-center rounded-lg bg-[image:var(--gradient-brand)] text-primary-foreground">
          <Building2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">B2B Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            CA firm partnerships, referrals and prospecting at a glance
          </p>
        </div>
        {/* Attendance LOGIN / LOGOUT, top right. */}
        <div className="ml-auto">
          <QuickPunch />
        </div>
      </header>

      {/* 9 KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <KpiTile
          label="Total Prospects"
          value={isLoading ? undefined : kpis.totalProspects}
          icon={Users}
          to="/b2b/leads"
        />
        <KpiTile
          label="Contacted"
          value={isLoading ? undefined : kpis.contacted}
          icon={Phone}
          accent="info"
        />
        <KpiTile
          label="Interested"
          value={isLoading ? undefined : kpis.interested}
          icon={Sparkles}
          accent="info"
        />
        <KpiTile
          label="Active Partners"
          value={isLoading ? undefined : kpis.activePartners}
          icon={Handshake}
          accent="success"
          to="/b2b/partners"
        />
        <KpiTile
          label="Follow-ups Due"
          value={isLoading ? undefined : kpis.followupsDue}
          icon={Bell}
          accent="warning"
          to="/b2b/activities/followups"
        />
        <KpiTile
          label="Meetings This Week"
          value={isLoading ? undefined : kpis.meetingsThisWeek}
          icon={CalendarCheck}
          accent="primary"
          to="/b2b/activities/meetings"
        />
        <KpiTile
          label="Referrals This Month"
          value={isLoading ? undefined : kpis.referralsThisMonth}
          icon={Share2}
          accent="info"
          to="/b2b/referrals"
        />
        <KpiTile
          label="B2B Bookings This Month"
          value={isLoading ? undefined : kpis.b2bBookingsThisMonth}
          icon={BookOpen}
          accent="success"
        />
        <RevenueTile value={isLoading ? undefined : kpis.b2bRevenueThisMonth} />
      </div>

      {/* Funnel */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Partnership funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {funnel.map((stage) => {
              const widthPct = Math.max(4, stage.conversionFromTop);
              return (
                <div key={stage.id} className="flex items-center gap-3">
                  <div className="w-44 shrink-0 text-sm text-muted-foreground">{stage.label}</div>
                  <div className="relative h-8 flex-1 overflow-hidden rounded-md bg-muted/40">
                    <div
                      className="flex h-full items-center rounded-md bg-[image:var(--gradient-brand)] px-2 text-xs font-medium text-primary-foreground transition-all"
                      style={{ width: `${widthPct}%` }}
                    >
                      {stage.count}
                    </div>
                  </div>
                  <div className="w-28 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                    {stage.conversionFromTop}% of top
                  </div>
                  <div className="w-24 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                    {stage.conversionFromPrev}% step
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Activity + Partner health */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <ActivityStat icon={Phone} label="Calls Made" value={activity.calls} />
              <ActivityStat icon={MessageSquare} label="WhatsApp" value={activity.whatsapp} />
              <ActivityStat icon={Share2} label="Emails" value={activity.emails} />
              <ActivityStat icon={CalendarCheck} label="Meetings" value={activity.meetings} />
              <ActivityStat
                icon={Bell}
                label="Follow-ups Completed"
                value={activity.followupsCompleted}
              />
              <ActivityStat
                icon={AlertTriangle}
                label="Overdue Follow-ups"
                value={activity.overdueFollowups}
                tone="destructive"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Partner health</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {health.map((slice) => {
                const color =
                  PARTNER_HEALTH.find((h) => h.id === slice.id)?.color ?? "bg-muted-foreground";
                return (
                  <div key={slice.id} className="flex items-center gap-3">
                    <span className={`size-2.5 shrink-0 rounded-full ${color}`} />
                    <span className="flex-1 text-sm">{slice.label}</span>
                    <span className="text-sm font-semibold tabular-nums">{slice.count}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Employee leaderboard */}
      <EmployeeLeaderboard
        rows={employeeLeaderboard({
          leads,
          activities,
          referrals,
          firms,
          followups,
          bookingRevenue,
        })}
        nameOf={nameOf}
      />

      {/* Source performance */}
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
                {sources.map((s) => (
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
        </CardContent>
      </Card>
    </div>
  );
}

function RevenueTile({ value }: { value: number | undefined }) {
  return (
    <div className="surface-card relative flex h-full flex-col justify-between overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-success/15 to-transparent" />
      <div className="relative flex items-start justify-between gap-2">
        <div className="text-[11px] font-medium uppercase leading-tight tracking-wide text-muted-foreground">
          B2B Revenue This Month
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-success/20 bg-success/10 p-1.5 text-success">
          <IndianRupee className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="relative mt-3">
        <div className="text-2xl font-semibold leading-none tabular-nums">
          {value === undefined ? "—" : formatINR(value)}
        </div>
        <div className="mt-1 min-h-4 text-[11px] text-muted-foreground" />
      </div>
    </div>
  );
}

function ActivityStat({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: typeof Phone;
  label: string;
  value: number;
  tone?: "default" | "destructive";
}) {
  return (
    <div className="rounded-lg border bg-background/50 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className={`h-4 w-4 ${tone === "destructive" ? "text-destructive" : ""}`} />
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === "destructive" && value > 0 ? "text-destructive" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

type SortKey = keyof Omit<EmployeeRow, "employeeId">;

function EmployeeLeaderboard({
  rows,
  nameOf,
}: {
  rows: EmployeeRow[];
  nameOf: (id: string) => string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [filter, setFilter] = useState("");

  const sorted = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q ? rows.filter((r) => nameOf(r.employeeId).toLowerCase().includes(q)) : rows;
    return [...filtered].sort((a, b) => (b[sortKey] as number) - (a[sortKey] as number));
  }, [rows, filter, sortKey, nameOf]);

  const columns: { key: SortKey; label: string; money?: boolean }[] = [
    { key: "prospectsAssigned", label: "Prospects" },
    { key: "prospectsContacted", label: "Contacted" },
    { key: "calls", label: "Calls" },
    { key: "followups", label: "Follow-ups" },
    { key: "meetings", label: "Meetings" },
    { key: "partnersOnboarded", label: "Partners" },
    { key: "referrals", label: "Referrals" },
    { key: "bookings", label: "Bookings" },
    { key: "revenue", label: "Revenue", money: true },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base">Employee leaderboard</CardTitle>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Filter by name…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 w-40"
          />
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger className="h-8 w-40">
              <ArrowUpDown className="mr-1 h-3.5 w-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {columns.map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  Sort by {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No employee activity recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Employee</th>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className="cursor-pointer text-right hover:text-foreground"
                      onClick={() => setSortKey(c.key)}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {sorted.map((r) => (
                  <tr key={r.employeeId} className="hover:bg-muted/30">
                    <td className="py-2 font-medium">{nameOf(r.employeeId)}</td>
                    {columns.map((c) => (
                      <td key={c.key} className="text-right tabular-nums">
                        {c.money ? formatINR(r[c.key] as number) : (r[c.key] as number)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
