import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, LayoutDashboard, RotateCcw, Volume2, VolumeX, Check } from "lucide-react";
import { KpiStrip, resetWidgetLayout } from "@/components/dashboard/widget-grid";

// Lazy-load WidgetGrid — it pulls in react-grid-layout (~60KB) which is only
// needed once the grid section scrolls into view / mounts. KpiStrip is lightweight
// and renders immediately.
const WidgetGrid = lazy(() =>
  import("@/components/dashboard/widget-grid").then((m) => ({ default: m.WidgetGrid })),
);

// Lazy-load below-fold / interaction-gated components
const NewBookingDialog = lazy(() =>
  import("@/components/dashboard/new-booking-dialog").then((m) => ({ default: m.NewBookingDialog })),
);
const HeroOfMonth = lazy(() =>
  import("@/components/dashboard/hero-of-month").then((m) => ({ default: m.HeroOfMonth })),
);
import { getSheetConfig } from "@/lib/bookings-sheet";
import { LivePulsePill } from "@/components/dashboard/live-pulse-pill";
import { AddWidgetPanel } from "@/components/dashboard/add-widget-panel";
import { useQuietMode, useVisibleWidgets, useVisibleKpis } from "@/lib/dashboard-prefs";
import { useAuth } from "@/lib/auth";
import { pushPulse } from "@/lib/realtime-pulse";
import { subscribeRealtime } from "@/lib/realtime-manager";
import { usePagePerf } from "@/lib/perf";
import { RenewalDashboardInline } from "@/components/dashboard/renewal-dashboard-inline";
import {
  affectedKeysFor,
  resolveScope,
  dashboardStatsQuery,
  heroTodayQuery,
  needsAttentionQuery,
  todayFollowupsQuery,
  overdueFollowupsQuery,
  activityTickerQuery,
} from "@/lib/dashboard-queries";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — EaseMyOffice CRM" }] }),
  // Prefetch the most important queries on navigation so the dashboard is
  // already warm by the time the component mounts. Fire-and-forget — this
  // does not block navigation; cache freshness is governed by each query's
  // staleTime, so revisiting within the window is instant.
  loader: ({ context }) => {
    const qc = context.queryClient;
    // Scope-aware prefetch (fire-and-forget) so caches match the widgets' keys
    // once the user's scope resolves. Does not block navigation.
    void resolveScope().then((scope) => {
      qc.prefetchQuery(dashboardStatsQuery(scope));
      qc.prefetchQuery(heroTodayQuery(scope));
      qc.prefetchQuery(needsAttentionQuery(scope));
      // pipelineCountsQuery now shares the same cache key as dashboardStatsQuery,
      // so prefetching it separately is unnecessary.
      qc.prefetchQuery(activityTickerQuery(scope));
    });
    // Follow-up queries are scoped by RLS already — no scope param needed.
    qc.prefetchQuery(todayFollowupsQuery());
    qc.prefetchQuery(overdueFollowupsQuery());
    // Warm the booking sheet config (plans + next ID) so the New Booking form opens instantly.
    qc.prefetchQuery({ queryKey: ["booking-sheet-config"], queryFn: getSheetConfig, staleTime: 5 * 60 * 1000 });
  },
  component: DashboardPage,
});

function DashboardPage() {
  const { user, roles, isAdmin, profile } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [quiet, setQuiet] = useQuietMode();
  const [visible, setVisible] = useVisibleWidgets(user?.id ?? "anon");
  const [kpis, setKpis] = useVisibleKpis(user?.id ?? "anon");
  const [pulseTick, setPulseTick] = useState(0);
  usePagePerf("Dashboard", false);

  // Renewal-only users default to Renewal view; admins can switch
  const isRenewalOnly = !isAdmin && roles.includes("renewals") && !roles.includes("sales") && !roles.includes("bd");
  const [dashView, setDashView] = useState<"fresh" | "renewals">(isRenewalOnly ? "renewals" : "fresh");

  // Available views based on role
  const availableViews = useMemo(() => {
    const views: { id: "fresh" | "renewals"; label: string }[] = [];
    if (isAdmin || roles.includes("sales") || roles.includes("bd")) views.push({ id: "fresh", label: "Fresh Sales" });
    if (isAdmin || roles.includes("renewals")) views.push({ id: "renewals", label: "Renewals" });
    return views;
  }, [isAdmin, roles]);

  // Realtime — payload-aware invalidation, debounced into a 600ms batched flush.
  // Only invalidates the queries actually impacted by the changed columns,
  // and never fires a refetch for unrelated field updates.
  // Uses the shared realtime manager (single WebSocket for all pages).
  useEffect(() => {
    const dirty = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      dirty.forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
      dirty.clear();
    };
    const schedule = (keys: string[]) => {
      if (!keys.length) return;
      keys.forEach((k) => dirty.add(k));
      if (!timer) timer = setTimeout(flush, 600);
    };

    const unsub = subscribeRealtime(
      "dashboard",
      ["leads", "follow_ups", "lead_activities"],
      (event) => {
        if (event.table === "leads") {
          pushPulse({ kind: "lead" });
          setPulseTick((t) => (t + 1) % 1000);
        } else if (event.table === "follow_ups") {
          pushPulse({ kind: "follow_up" });
        } else if (event.table === "lead_activities") {
          pushPulse({ kind: "activity" });
        }
        schedule(affectedKeysFor({
          table: event.table as "leads" | "follow_ups" | "lead_activities",
          eventType: event.eventType,
          new: event.new,
          old: event.old,
        }));
      },
    );
    return () => { if (timer) clearTimeout(timer); unsub(); };
  }, [qc]);

  const dateLabel = useMemo(
    () => new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
    [],
  );

  // Redirect renewal-only users before rendering the sales dashboard.
  if (isRenewalOnly && dashView === "fresh") {
    setDashView("renewals");
  }

  // If viewing renewals, render the renewal dashboard inline
  if (dashView === "renewals") {
    return (
      <div className="min-h-full">
        {availableViews.length > 1 && (
          <div className="px-5 md:px-10 pt-4 max-w-[1400px] mx-auto">
            <div className="inline-flex rounded-lg border bg-muted/40 p-1 gap-1">
              {availableViews.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setDashView(v.id)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ease-out ${
                    dashView === v.id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <RenewalDashboardInline />
      </div>
    );
  }

  return (
    <div className="dash-canvas min-h-full">
      <div className="relative p-5 md:p-10 max-w-[1400px] mx-auto space-y-5">
        {/* View switcher for admins */}
        {availableViews.length > 1 && (
          <div className="inline-flex rounded-lg border bg-muted/40 p-1 gap-1">
            {availableViews.map((v) => (
              <button
                key={v.id}
                onClick={() => setDashView(v.id)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ease-out ${
                  dashView === v.id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}
        {/* Personalized header — makes the salesperson feel ownership */}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            {profile?.full_name?.split(" ")[0] ?? "Your"}'s Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">{dateLabel} · Your sales performance at a glance</p>
        </div>

        {/* Actions bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <LivePulsePill />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="sm"
              className="transition-all duration-200 ease-out hover:shadow-sm"
              onClick={() => setQuiet(!quiet)}
              title={quiet ? "Enable motion" : "Quiet / focus mode"}
              aria-pressed={quiet}
              aria-label={quiet ? "Enable animations" : "Enable quiet mode"}
            >
              {quiet ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              <span className="hidden sm:inline">{quiet ? "Quiet" : "Live"}</span>
            </Button>
            <AddWidgetPanel visible={visible} onChange={setVisible} kpis={kpis} onKpisChange={setKpis} />
            <Button
              variant={editing ? "default" : "outline"} size="sm"
              className="transition-all duration-200 ease-out hover:shadow-sm"
              onClick={() => setEditing((e) => !e)}
              aria-pressed={editing}
            >
              {editing ? <><Check className="h-4 w-4" /> Done</> : <><LayoutDashboard className="h-4 w-4" /> <span className="hidden sm:inline">Edit layout</span></>}
            </Button>
            {editing && (
              <Button
                variant="ghost" size="sm"
                className="transition-all duration-200 ease-out hover:shadow-sm"
                onClick={() => { resetWidgetLayout(user?.id ?? "anon"); window.location.reload(); }}
              >
                <RotateCcw className="h-4 w-4" /> Reset
              </Button>
            )}
            <Suspense fallback={null}><NewBookingDialog /></Suspense>
            <Button asChild size="sm" className="transition-all duration-200 ease-out hover:shadow-sm">
              <Link to="/leads/new"><Plus className="h-4 w-4" /> New Lead</Link>
            </Button>
          </div>
        </div>

        {/* Top KPI strip — configurable cards; drag to reorder in edit mode */}
        <KpiStrip pulseTick={pulseTick} editing={editing} kpis={kpis} onReorder={setKpis} />

        {/* Customizable widget grid */}
        <Suspense fallback={<div className="grid gap-3 grid-cols-1 md:grid-cols-2 animate-pulse">{Array.from({length: 4}, (_, i) => <div key={i} className="h-64 rounded-xl bg-muted/40" />)}</div>}>
          <WidgetGrid editing={editing} pulseTick={pulseTick} visible={visible} />
        </Suspense>

        {/* Hero of the Month leaderboard */}
        <Suspense fallback={<div className="h-48 rounded-xl bg-muted/40 animate-pulse" />}>
          <HeroOfMonth />
        </Suspense>

        {/* Footer hint */}
        <p className="text-center text-[11px] text-muted-foreground/70 pt-2">
          Tip: tap "Widgets" to choose your stat cards, and "Edit layout" to drag stat cards and widgets into the order you want.
        </p>
      </div>
    </div>
  );
}
