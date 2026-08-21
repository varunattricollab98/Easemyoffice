import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FileText,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { useState, useMemo } from "react";
import { format, startOfDay, startOfWeek, startOfMonth, startOfYear } from "date-fns";
import type { Database } from "@/integrations/supabase/types";

type DocStage = Database["public"]["Enums"]["doc_task_stage"];
type Period = "daily" | "weekly" | "monthly" | "yearly";

const DOC_STAGES: { id: DocStage; label: string; color: string }[] = [
  { id: "assigned", label: "Assigned", color: "bg-slate-500" },
  { id: "docs_requested", label: "Docs Requested", color: "bg-blue-500" },
  { id: "docs_received", label: "Docs Received", color: "bg-cyan-500" },
  { id: "draft_shared", label: "Draft Shared", color: "bg-violet-500" },
  { id: "draft_approved", label: "Draft Approved", color: "bg-teal-500" },
  { id: "agreement_shared", label: "Agreement Shared", color: "bg-amber-500" },
  { id: "countersigned", label: "Countersigned", color: "bg-emerald-500" },
  { id: "part_b_shared", label: "Part B Shared", color: "bg-indigo-500" },
  { id: "completed", label: "Completed", color: "bg-green-600" },
];

const STAGE_MAP = new Map(DOC_STAGES.map((s) => [s.id, s]));

const PERIOD_OPTIONS: { id: Period; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly" },
];

function periodStart(period: Period): Date {
  const now = new Date();
  switch (period) {
    case "daily":
      return startOfDay(now);
    case "weekly":
      return startOfWeek(now);
    case "monthly":
      return startOfMonth(now);
    case "yearly":
      return startOfYear(now);
  }
}

interface DocDashboardTask {
  id: string;
  booking_id: string;
  assigned_to: string;
  stage: DocStage;
  created_at: string;
  updated_at: string;
  escalated: boolean;
  bookings: {
    client_name: string | null;
    plan_name: string | null;
    external_booking_id: string | null;
  } | null;
}

function StageBadge({ stage }: { stage: DocStage }) {
  const s = STAGE_MAP.get(stage);
  return (
    <Badge className={`${s?.color ?? "bg-slate-500"} text-white hover:${s?.color ?? "bg-slate-500"}`}>
      {s?.label ?? stage}
    </Badge>
  );
}

export function DocumentationDashboardInline() {
  const { user, profile } = useAuth();
  const [period, setPeriod] = useState<Period>("monthly");
  const filterISO = useMemo(() => periodStart(period).toISOString(), [period]);

  const dateLabel = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    [],
  );

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["doc-dashboard-tasks", period, user?.id],
    queryFn: async (): Promise<DocDashboardTask[]> => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("documentation_tasks")
        .select(
          "id, booking_id, assigned_to, stage, created_at, updated_at, escalated, bookings(client_name, plan_name, external_booking_id)",
        )
        .eq("assigned_to", user.id)
        .gte("created_at", filterISO)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as DocDashboardTask[];
    },
    enabled: !!user?.id,
  });

  const stats = useMemo(() => {
    const total = tasks.length;
    const active = tasks.filter((t) => t.stage !== "completed").length;
    const completed = tasks.filter((t) => t.stage === "completed").length;
    const escalated = tasks.filter((t) => t.escalated).length;
    return { total, active, completed, escalated };
  }, [tasks]);

  // Show the 10 most recent tasks for the quick table
  const recentTasks = useMemo(() => tasks.slice(0, 10), [tasks]);

  return (
    <div className="p-5 md:p-10 max-w-[1400px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          {profile?.full_name?.split(" ")[0] ?? "Your"}&apos;s Documentation Dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          {dateLabel} &middot; Your documentation tasks at a glance
        </p>
      </div>

      {/* Period filter */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Overview</h2>
        <div className="w-40">
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger>
              <SelectValue placeholder="Period" />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI Cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-pulse">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-24 rounded-xl bg-muted/40" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                <FileText className="h-4 w-4" /> Total Assigned
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                <Clock className="h-4 w-4" /> Active
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.active}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" /> Completed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.completed}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500" /> Escalated
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.escalated}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Recent Bookings Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent Assigned Bookings</CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/documentation">
              View All <ArrowRight className="h-4 w-4 ml-1" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-10 text-center text-muted-foreground">Loading...</div>
          ) : recentTasks.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              No documentation tasks found for this period.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client Name</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Booking ID</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentTasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="font-medium">
                      {task.bookings?.client_name ?? "-"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {task.bookings?.plan_name ?? "-"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {task.bookings?.external_booking_id ?? "-"}
                    </TableCell>
                    <TableCell>
                      <StageBadge stage={task.stage} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(task.created_at), "MMM d, yyyy")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Quick link to full documentation page */}
      <div className="text-center">
        <Button variant="outline" asChild>
          <Link to="/documentation">
            Go to Full Documentation View <ArrowRight className="h-4 w-4 ml-1" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
