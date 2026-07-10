import { lazy, Suspense, type ReactElement } from "react";
import { Responsive, WidthProvider, type Layout, type LayoutItem, type ResponsiveLayouts } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { loadLayouts, saveLayouts, clearLayouts, type WidgetId } from "@/lib/dashboard-prefs";
import { KpiTile } from "./widgets/kpi-tile";
import { WidgetSkeleton } from "./widget-skeleton";
import { Flame, Bell, AlertTriangle, Target, RefreshCcw, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { dashboardStatsQuery } from "@/lib/dashboard-queries";

// Lazy-load each widget so they're shipped as their own JS chunks.
// The page becomes interactive faster; slow widgets don't block fast ones.
const HeroToday = lazy(() => import("./widgets/hero-today").then((m) => ({ default: m.HeroToday })));
const NeedsAttention = lazy(() => import("./widgets/needs-attention").then((m) => ({ default: m.NeedsAttention })));
const TodayFollowups = lazy(() => import("./widgets/today-followups").then((m) => ({ default: m.TodayFollowups })));
const OverdueFollowups = lazy(() => import("./widgets/overdue-followups").then((m) => ({ default: m.OverdueFollowups })));
const PipelineSnapshot = lazy(() => import("./widgets/pipeline-snapshot").then((m) => ({ default: m.PipelineSnapshot })));
const ActivityTicker = lazy(() => import("./widgets/activity-ticker").then((m) => ({ default: m.ActivityTicker })));

const ResponsiveGrid = WidthProvider(Responsive);

// Widget grid (lower section) — KPIs are now in a separate top strip.
const LG_BASE: Record<WidgetId, LayoutItem> = {
  hero:     { i: "hero",     x: 0, y: 0,  w: 7, h: 7, minW: 5, minH: 6 },
  needs:    { i: "needs",    x: 7, y: 0,  w: 5, h: 7, minW: 4, minH: 6 },
  today:    { i: "today",    x: 0, y: 7,  w: 4, h: 8, minW: 3, minH: 6 },
  overdue:  { i: "overdue",  x: 4, y: 7,  w: 4, h: 8, minW: 3, minH: 6 },
  activity: { i: "activity", x: 8, y: 7,  w: 4, h: 8, minW: 3, minH: 6 },
  pipeline: { i: "pipeline", x: 0, y: 15, w: 12, h: 7, minW: 6, minH: 6 },
};

function buildLayouts(visible: WidgetId[]): ResponsiveLayouts {
  const lg: LayoutItem[] = visible.map((id) => LG_BASE[id]).filter(Boolean);
  const sm: LayoutItem[] = visible.map((id, i) => ({ ...LG_BASE[id], x: 0, y: i * 8, w: 12 }));
  return { lg, md: lg, sm, xs: sm };
}

export function WidgetGrid({
  editing,
  pulseTick,
  visible,
}: {
  editing: boolean;
  pulseTick: number;
  visible: WidgetId[];
}) {
  const { user } = useAuth();
  const uid = user?.id ?? "anon";
  const [layouts, setLayoutsState] = useState<ResponsiveLayouts>(() => {
    const saved = typeof window !== "undefined" ? loadLayouts(uid) : null;
    return (saved as ResponsiveLayouts) ?? buildLayouts(visible);
  });

  // Re-merge whenever visible widget set changes — keep saved positions, fill gaps with defaults.
  useEffect(() => {
    setLayoutsState((prev) => {
      const merge = (existing: readonly LayoutItem[] | undefined): LayoutItem[] => {
        const map = new Map((existing ?? []).map((l) => [l.i, l] as const));
        return visible.map((id) => map.get(id) ?? LG_BASE[id]).filter(Boolean) as LayoutItem[];
      };
      return {
        lg: merge(prev.lg),
        md: merge(prev.md),
        sm: merge(prev.sm),
        xs: merge(prev.xs),
      };
    });
  }, [visible]);

  const onChange = (_layout: Layout, all: ResponsiveLayouts) => {
    setLayoutsState(all);
    saveLayouts(uid, all as Record<string, LayoutItem[]>);
  };

  const widgetMap: Record<WidgetId, ReactElement> = {
    hero: <Suspense fallback={<WidgetSkeleton rows={3} />}><HeroToday /></Suspense>,
    needs: <Suspense fallback={<WidgetSkeleton rows={5} />}><NeedsAttention pulseTick={pulseTick} /></Suspense>,
    today: <Suspense fallback={<WidgetSkeleton rows={4} />}><TodayFollowups /></Suspense>,
    overdue: <Suspense fallback={<WidgetSkeleton rows={5} />}><OverdueFollowups /></Suspense>,
    pipeline: <Suspense fallback={<WidgetSkeleton rows={3} />}><PipelineSnapshot /></Suspense>,
    activity: <Suspense fallback={<WidgetSkeleton rows={6} />}><ActivityTicker /></Suspense>,
  };

  return (
    <div className={editing ? "dash-edit" : ""}>
      <ResponsiveGrid
        className="layout"
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 0 }}
        cols={{ lg: 12, md: 12, sm: 12, xs: 12 }}
        rowHeight={48}
        margin={[14, 14]}
        containerPadding={[0, 0]}
        isDraggable={editing}
        isResizable={editing}
        draggableHandle=".widget-handle"
        onLayoutChange={onChange}
        compactType="vertical"
      >
        {visible.map((id) => (
          <div key={id} className="overflow-hidden">{widgetMap[id]}</div>
        ))}
      </ResponsiveGrid>
    </div>
  );
}

// Top-of-dashboard fixed KPI strip — not draggable, always visible.
export function KpiStrip({ pulseTick }: { pulseTick: number }) {
  const { data: stats } = useQuery(dashboardStatsQuery());

  const tiles = [
    <KpiTile key="new" label="New leads (mo)" value={stats?.newLeads} icon={Target} accent="info"
      pulse={pulseTick > 0} to="/leads" eventName="new_leads_month"
      tooltip="Open all leads created this month." />,
    <KpiTile key="hot" label="Hot" value={stats?.hot} icon={Flame} accent="rose"
      pulse={pulseTick > 0} to="/leads" search={{ interest: "hot" }} eventName="hot_leads"
      tooltip="Open Leads filtered to Hot interest." />,
    <KpiTile key="pending" label="Pending" value={stats?.pending} icon={Bell} accent="warning"
      to="/follow-ups" search={{ filter: "today" }} eventName="pending_followups"
      tooltip="Open Follow-ups due today." />,
    <KpiTile key="overdue" label="Overdue" value={stats?.overdue} icon={AlertTriangle} accent="destructive"
      pulse={pulseTick > 0} to="/follow-ups" search={{ filter: "overdue" }} eventName="overdue_followups"
      tooltip="Open Follow-ups that are past due." />,
    <KpiTile key="closures" label="Closures (mo)" value={stats?.closures} icon={Target} accent="success"
      to="/leads" search={{ stage: "completed" }} eventName="closures_month"
      tooltip="Open completed deals." />,
    <KpiTile key="renewals" label="Renewals due" value={stats?.renewals} icon={RefreshCcw} accent="warning"
      to="/renewals" eventName="renewals_due"
      tooltip="Open the Renewals page." />,
    <KpiTile key="total" label="Total leads" value={stats?.total} icon={Users} accent="primary" hint="All-time"
      to="/leads" eventName="total_leads"
      tooltip="Open the full leads list." />,
  ];

  return (
    <section
      aria-label="Key performance indicators"
      className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7"
    >
      {tiles.map((tile, i) => (
        <div key={i} style={{ ["--i" as never]: i, display: "contents" }}>
          {tile}
        </div>
      ))}
    </section>
  );
}

export function resetWidgetLayout(uid: string) { clearLayouts(uid); }
