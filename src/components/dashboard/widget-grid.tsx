import { lazy, Suspense, type ReactElement } from "react";
import { Responsive, WidthProvider, type Layout, type LayoutItem, type ResponsiveLayouts } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { loadLayouts, saveLayouts, clearLayouts, type WidgetId } from "@/lib/dashboard-prefs";
import { KpiTile } from "./widgets/kpi-tile";
import { WidgetSkeleton } from "./widget-skeleton";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { dashboardStatsQuery, useDashboardScope } from "@/lib/dashboard-queries";
import { KPI_MAP, type KpiId, type KpiStats } from "@/lib/dashboard-kpis";

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

// Top-of-dashboard KPI strip. Each person chooses which cards to show and can
// drag to reorder them while in Edit-layout mode. Cards are defined in the KPI
// catalog (dashboard-kpis.ts) and resolved against dashboardStatsQuery.
export function KpiStrip({
  pulseTick,
  editing = false,
  kpis,
  onReorder,
}: {
  pulseTick: number;
  editing?: boolean;
  kpis: KpiId[];
  onReorder?: (next: KpiId[]) => void;
}) {
  const { data: stats } = useQuery(dashboardStatsQuery(useDashboardScope()));
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const defs = kpis.map((id) => KPI_MAP[id]).filter(Boolean);

  const move = (from: number, to: number) => {
    if (from === to || !onReorder) return;
    const next = [...kpis];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    onReorder(next);
  };
  const remove = (id: string) => onReorder?.(kpis.filter((k) => k !== id));

  return (
    <section
      aria-label="Key performance indicators"
      className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7"
    >
      {defs.map((def, i) => {
        const value = stats ? def.value(stats as KpiStats) : undefined;
        if (editing) {
          return (
            <div
              key={def.id}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragEnter={() => setOverIdx(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragIdx !== null) move(dragIdx, i); setDragIdx(null); setOverIdx(null); }}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
              className={cn(
                "relative cursor-grab active:cursor-grabbing rounded-xl transition-all",
                dragIdx === i && "opacity-40",
                overIdx === i && dragIdx !== i && "ring-2 ring-primary ring-offset-2 ring-offset-background",
              )}
              style={{ ["--i" as never]: i }}
            >
              <button
                type="button"
                onClick={() => remove(def.id)}
                className="absolute -top-2 -right-2 z-10 rounded-full bg-destructive text-destructive-foreground p-1 shadow-md hover:scale-110 transition-transform"
                aria-label={`Remove ${def.label}`}
              >
                <X className="h-3 w-3" />
              </button>
              <KpiTile label={def.label} value={value} icon={def.icon} accent={def.accent} hint={def.hint} tooltip={def.tooltip} />
            </div>
          );
        }
        return (
          <div key={def.id} style={{ ["--i" as never]: i, display: "contents" }}>
            <KpiTile
              label={def.label} value={value} icon={def.icon} accent={def.accent} hint={def.hint}
              pulse={pulseTick > 0} to={def.to} search={def.search} tooltip={def.tooltip} eventName={def.id}
            />
          </div>
        );
      })}
    </section>
  );
}

export function resetWidgetLayout(uid: string) { clearLayouts(uid); }
