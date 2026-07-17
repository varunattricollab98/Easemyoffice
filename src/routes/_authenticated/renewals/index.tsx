import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RefreshCcw, CalendarClock, CheckCircle2, XCircle, MapPin, TrendingDown,
  Users, Trophy, AlertTriangle, Bell, Clock, BarChart3,
} from "lucide-react";
import { useMemo, useEffect, useState } from "react";
import { format, differenceInDays, startOfMonth, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/renewals/")({
  head: () => ({ meta: [{ title: "Renewal Dashboard — EaseMyOffice CRM" }] }),
  component: RenewalDashboard,
});

const RENEWAL_STAGES = [
  { id: "pending", label: "New Renewal", color: "bg-slate-500" },
  { id: "contacted", label: "Contacted", color: "bg-blue-500" },
  { id: "following_up", label: "Following Up", color: "bg-violet-500" },
  { id: "not_responding", label: "Not Responding", color: "bg-amber-500" },
  { id: "pending_payment", label: "Pending Payment", color: "bg-cyan-500" },
  { id: "renewed", label: "Renewed", color: "bg-emerald-500" },
  { id: "not_interested", label: "Not Interested", color: "bg-rose-400" },
  { id: "address_changed", label: "Address Changed", color: "bg-orange-400" },
  { id: "lost", label: "Lost", color: "bg-red-600" },
  { id: "cancelled", label: "Cancelled", color: "bg-gray-500" },
];

export function RenewalDashboard() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();

  // All bookings with expiry dates — the core data for the renewal team
  const { data: bookings = [], isLoading, refetch } = useQuery({
    queryKey: ["renewal-bookings"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("bookings")
        .select("id, booking_code, external_booking_id, client_name, business_name, contact_no, email_id, plan_name, plan_start_date, plan_expiry_date, renewal_status, renewal_assigned_to, renewal_followup_at, renewal_notes, renewal_outcome, total_amount, amount_received, created_at")
        .not("plan_expiry_date", "is", null)
        .order("plan_expiry_date", { ascending: true })
        .limit(2000);
      return (data ?? []) as any[];
    },
  });

  // Team members for name lookup
  const { data: team = [] } = useQuery({
    queryKey: ["renewal-team"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").order("full_name");
      return (data ?? []) as { id: string; full_name: string | null; email: string | null }[];
    },
  });

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    team.forEach((u) => m.set(u.id, u.full_name || u.email || ""));
    return m;
  }, [team]);

  // Compute KPIs
  const stats = useMemo(() => {
    const now = new Date();
    const in30 = new Date(Date.now() + 30 * 86400000);
    const in90 = new Date(Date.now() + 90 * 86400000);

    const dueIn30 = bookings.filter((b: any) => {
      const exp = new Date(b.plan_expiry_date);
      return exp >= now && exp <= in30 && b.renewal_status === "pending";
    });
    const dueIn90 = bookings.filter((b: any) => {
      const exp = new Date(b.plan_expiry_date);
      return exp >= now && exp <= in90 && b.renewal_status === "pending";
    });
    const assigned = bookings.filter((b: any) => b.renewal_assigned_to);
    const renewed = bookings.filter((b: any) => b.renewal_status === "renewed");
    const notInterested = bookings.filter((b: any) => b.renewal_status === "not_interested");
    const addressChanged = bookings.filter((b: any) => b.renewal_status === "address_changed");
    const lost = bookings.filter((b: any) => b.renewal_status === "lost");
    const cancelled = bookings.filter((b: any) => b.renewal_status === "cancelled");

    // Monthly performance (this month's renewals)
    const monthStart = startOfMonth(now);
    const thisMonthRenewed = renewed.filter((b: any) => b.renewal_stage_changed_at && new Date(b.renewal_stage_changed_at) >= monthStart);

    // Referrals (from renewal_outcome)
    const referrals = bookings.filter((b: any) => (b.renewal_outcome || "").toLowerCase().includes("referral"));

    return {
      dueIn30: dueIn30.length,
      dueIn90: dueIn90.length,
      assigned: assigned.length,
      renewed: renewed.length,
      notInterested: notInterested.length,
      addressChanged: addressChanged.length,
      lost: lost.length,
      cancelled: cancelled.length,
      referrals: referrals.length,
      thisMonthRenewed: thisMonthRenewed.length,
      total: bookings.length,
    };
  }, [bookings]);

  // Needs attention: expiring in next 7 days + not yet contacted
  const needsAttention = useMemo(() => {
    const now = new Date();
    const in7 = new Date(Date.now() + 7 * 86400000);
    return bookings
      .filter((b: any) => {
        const exp = new Date(b.plan_expiry_date);
        return exp >= now && exp <= in7 && !["renewed", "cancelled", "lost", "not_interested"].includes(b.renewal_status);
      })
      .slice(0, 8);
  }, [bookings]);

  // Today's follow-ups
  const todayFollowups = useMemo(() => {
    const today = format(new Date(), "yyyy-MM-dd");
    return bookings
      .filter((b: any) => b.renewal_followup_at && format(new Date(b.renewal_followup_at), "yyyy-MM-dd") === today)
      .slice(0, 10);
  }, [bookings]);

  // Overdue follow-ups
  const overdueFollowups = useMemo(() => {
    const now = new Date();
    return bookings
      .filter((b: any) => b.renewal_followup_at && new Date(b.renewal_followup_at) < now && !["renewed", "cancelled", "lost", "not_interested"].includes(b.renewal_status))
      .slice(0, 10);
  }, [bookings]);

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <RefreshCcw className="h-7 w-7 text-primary" /> Renewal Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            {profile?.full_name ? `Welcome back, ${profile.full_name}` : "Track and convert expiring bookings into renewals."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCcw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <KpiCard icon={CalendarClock} label="Due in 30 days" value={stats.dueIn30} color="text-amber-600" highlight />
        <KpiCard icon={CalendarClock} label="Due in 90 days" value={stats.dueIn90} color="text-blue-600" />
        <KpiCard icon={Users} label="Assigned" value={stats.assigned} color="text-violet-600" />
        <KpiCard icon={CheckCircle2} label="Renewed" value={stats.renewed} color="text-emerald-600" />
        <KpiCard icon={Trophy} label="This Month" value={stats.thisMonthRenewed} color="text-primary" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard icon={XCircle} label="Not Interested" value={stats.notInterested} color="text-rose-500" small />
        <KpiCard icon={MapPin} label="Address Changed" value={stats.addressChanged} color="text-orange-500" small />
        <KpiCard icon={TrendingDown} label="Lost" value={stats.lost} color="text-red-600" small />
        <KpiCard icon={XCircle} label="Cancelled" value={stats.cancelled} color="text-gray-500" small />
        <KpiCard icon={Users} label="Referrals" value={stats.referrals} color="text-cyan-600" small />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Needs Attention */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span className="font-semibold text-sm">Needs Attention</span>
              <Badge variant="secondary" className="ml-auto">{needsAttention.length}</Badge>
            </div>
            {needsAttention.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">All caught up!</p>
            ) : (
              <div className="space-y-2 max-h-[280px] overflow-y-auto">
                {needsAttention.map((b: any) => (
                  <div key={b.id} className="flex items-center gap-3 p-2 rounded-lg border hover:bg-muted/40 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{b.client_name}</div>
                      <div className="text-xs text-muted-foreground">{b.plan_name} · Expires {format(new Date(b.plan_expiry_date), "MMM d")}</div>
                    </div>
                    <Badge variant="outline" className="text-amber-600 border-amber-300 text-[10px] shrink-0">
                      {differenceInDays(new Date(b.plan_expiry_date), new Date())}d left
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Today's Follow-ups */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Bell className="h-4 w-4 text-blue-600" />
              <span className="font-semibold text-sm">Today's Follow-ups</span>
              <Badge variant="secondary" className="ml-auto">{todayFollowups.length}</Badge>
            </div>
            {todayFollowups.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No follow-ups scheduled today.</p>
            ) : (
              <div className="space-y-2 max-h-[280px] overflow-y-auto">
                {todayFollowups.map((b: any) => (
                  <div key={b.id} className="flex items-center gap-3 p-2 rounded-lg border text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{b.client_name}</div>
                      <div className="text-xs text-muted-foreground">{b.contact_no} · {b.plan_name}</div>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {b.renewal_followup_at && format(new Date(b.renewal_followup_at), "h:mm a")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Overdue follow-ups */}
      {overdueFollowups.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-destructive" />
              <span className="font-semibold text-sm text-destructive">Overdue Follow-ups</span>
              <Badge variant="destructive" className="ml-auto">{overdueFollowups.length}</Badge>
            </div>
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {overdueFollowups.map((b: any) => (
                <div key={b.id} className="flex items-center gap-3 p-2 rounded-lg border border-destructive/20 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{b.client_name}</div>
                    <div className="text-xs text-muted-foreground">{b.plan_name}</div>
                  </div>
                  <span className="text-xs text-destructive font-medium shrink-0">
                    {formatDistanceToNow(new Date(b.renewal_followup_at), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pipeline snapshot */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Renewal Pipeline</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {RENEWAL_STAGES.filter((s) => !["cancelled"].includes(s.id)).map((stage) => {
              const count = bookings.filter((b: any) => b.renewal_status === stage.id).length;
              return (
                <div key={stage.id} className="rounded-lg border p-3 text-center">
                  <div className="flex items-center justify-center gap-1.5 mb-1">
                    <span className={`h-2 w-2 rounded-full ${stage.color}`} />
                    <span className="text-[11px] text-muted-foreground">{stage.label}</span>
                  </div>
                  <div className="text-xl font-bold">{count}</div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, color, highlight, small }: {
  icon: any; label: string; value: number; color: string; highlight?: boolean; small?: boolean;
}) {
  return (
    <Card className={highlight ? "border-amber-300 bg-amber-50/50 dark:bg-amber-950/20" : ""}>
      <CardContent className={small ? "p-3" : "p-4"}>
        <div className="flex items-center gap-2">
          <Icon className={`${small ? "h-4 w-4" : "h-5 w-5"} ${color}`} />
          <span className={`${small ? "text-[11px]" : "text-xs"} text-muted-foreground font-medium`}>{label}</span>
        </div>
        <div className={`${small ? "text-xl" : "text-2xl"} font-bold mt-1`}>{value}</div>
      </CardContent>
    </Card>
  );
}
