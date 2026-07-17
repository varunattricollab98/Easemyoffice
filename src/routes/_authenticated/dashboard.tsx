import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Plus, LayoutDashboard, RotateCcw, Volume2, VolumeX, Check } from "lucide-react";
import { WidgetGrid, KpiStrip, resetWidgetLayout } from "@/components/dashboard/widget-grid";
import { NewBookingDialog } from "@/components/dashboard/new-booking-dialog";
import { HeroOfMonth } from "@/components/dashboard/hero-of-month";
import { getSheetConfig } from "@/lib/bookings-sheet";
import { LivePulsePill } from "@/components/dashboard/live-pulse-pill";
import { AddWidgetPanel } from "@/components/dashboard/add-widget-panel";
import { useQuietMode, useVisibleWidgets } from "@/lib/dashboard-prefs";
import { useAuth } from "@/lib/auth";
import { pushPulse } from "@/lib/realtime-pulse";
import { usePagePerf } from "@/lib/perf";
import {
  affectedKeysFor,
  resolveScope,
  dashboardStatsQuery,
  heroTodayQuery,
  needsAttentionQuery,
  todayFollowupsQuery,
  overdueFollowupsQuery,
  pipelineCountsQuery,
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
      qc.prefetchQuery(pipelineCountsQuery(scope));
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
  const { user, roles, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [quiet, setQuiet] = useQuietMode();
  const [visible, setVisible] = useVisibleWidgets(user?.id ?? "anon");
  const [pulseTick, setPulseTick] = useState(0);
  usePagePerf("Dashboard", false);

  // Renewal-only users should see the Renewal Dashboard, not this sales one.
  const isRenewalOnly = !isAdmin && roles.includes("renewals") && !roles.includes("sales") && !roles.includes("bd");
  if (isRenewalOnly) {
    return <Navigate to="/renewals" />;
  }

  // Realtime — payload-aware invalidation, debounced into a 600ms batched flush.
  // Only invalidates the queries actually impacted by the changed columns,
  // and never fires a refetch for unrelated field updates.
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

    const ch = supabase
      .channel("dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, (p) => {
        pushPulse({ kind: "lead" });
        setPulseTick((t) => (t + 1) % 1000);
        schedule(affectedKeysFor({ table: "leads", eventType: p.eventType, new: p.new, old: p.old }));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "follow_ups" }, (p) => {
        pushPulse({ kind: "follow_up" });
        schedule(affectedKeysFor({ table: "follow_ups", eventType: p.eventType, new: p.new, old: p.old }));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "lead_activities" }, (p) => {
        pushPulse({ kind: "activity" });
        schedule(affectedKeysFor({ table: "lead_activities", eventType: p.eventType, new: p.new, old: p.old }));
      })
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, [qc]);

  const dateLabel = useMemo(
    () => new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
    [],
  );

  return (
    <div className="dash-canvas min-h-full">
      <div className="relative p-4 md:p-8 max-w-[1400px] mx-auto space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="text-sm text-muted-foreground tabular-nums">{dateLabel}</div>
            <LivePulsePill />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="sm"
              onClick={() => setQuiet(!quiet)}
              title={quiet ? "Enable motion" : "Quiet / focus mode"}
              aria-pressed={quiet}
              aria-label={quiet ? "Enable animations" : "Enable quiet mode"}
            >
              {quiet ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              <span className="hidden sm:inline">{quiet ? "Quiet" : "Live"}</span>
            </Button>
            <AddWidgetPanel visible={visible} onChange={setVisible} />
            <Button
              variant={editing ? "default" : "outline"} size="sm"
              onClick={() => setEditing((e) => !e)}
              aria-pressed={editing}
            >
              {editing ? <><Check className="h-4 w-4" /> Done</> : <><LayoutDashboard className="h-4 w-4" /> <span className="hidden sm:inline">Edit layout</span></>}
            </Button>
            {editing && (
              <Button
                variant="ghost" size="sm"
                onClick={() => { resetWidgetLayout(user?.id ?? "anon"); window.location.reload(); }}
              >
                <RotateCcw className="h-4 w-4" /> Reset
              </Button>
            )}
            <NewBookingDialog />
            <Button asChild size="sm">
              <Link to="/leads/new"><Plus className="h-4 w-4" /> New Lead</Link>
            </Button>
          </div>
        </div>

        {/* Top KPI strip — always visible, fixed grid */}
        <KpiStrip pulseTick={pulseTick} />

        {/* Customizable widget grid */}
        <WidgetGrid editing={editing} pulseTick={pulseTick} visible={visible} />

        {/* Hero of the Month leaderboard */}
        <HeroOfMonth />

        {/* Footer hint */}
        <p className="text-center text-[11px] text-muted-foreground pt-2">
          Tip: tap "Widgets" to add or remove cards, and "Edit layout" to drag and resize them.
        </p>
      </div>
    </div>
  );
}
