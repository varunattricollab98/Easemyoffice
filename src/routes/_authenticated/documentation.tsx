import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  FileText,
  CheckCircle2,
  Clock,
  Loader2,
  AlertTriangle,
  BarChart3,
  Settings,
  User,
} from "lucide-react";
import { useState, useMemo } from "react";
import {
  format,
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfYear,
  differenceInDays,
} from "date-fns";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type DocStage = Database["public"]["Enums"]["doc_task_stage"];
type Period = "daily" | "weekly" | "monthly" | "yearly";

const DOC_STAGES = [
  { id: "assigned", label: "Assigned", color: "bg-slate-500" },
  { id: "docs_requested", label: "Docs Requested", color: "bg-blue-500" },
  { id: "docs_received", label: "Docs Received", color: "bg-cyan-500" },
  { id: "draft_shared", label: "Draft Shared", color: "bg-violet-500" },
  { id: "draft_approved", label: "Draft Approved", color: "bg-teal-500" },
  { id: "agreement_shared", label: "Agreement Shared", color: "bg-amber-500" },
  { id: "countersigned", label: "Countersigned", color: "bg-emerald-500" },
  { id: "part_b_shared", label: "Part B Shared", color: "bg-indigo-500" },
  { id: "completed", label: "Completed", color: "bg-green-600" },
] as const;

const STAGE_MAP = new Map(DOC_STAGES.map((s) => [s.id, s]));

const PARTIAL_STAGES: DocStage[] = [
  "docs_requested",
  "docs_received",
  "draft_shared",
  "draft_approved",
  "agreement_shared",
  "countersigned",
  "part_b_shared",
];

const PERIOD_OPTIONS: { id: Period; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly" },
];

export const Route = createFileRoute("/_authenticated/documentation")({
  head: () => ({ meta: [{ title: "Documentation — EaseMyOffice CRM" }] }),
  component: DocumentationPage,
});

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

interface DocTaskRow {
  id: string;
  booking_id: string;
  assigned_to: string;
  assigned_by: string | null;
  stage: DocStage;
  notes: string | null;
  created_at: string;
  updated_at: string;
  escalated: boolean;
  escalation_reason: string | null;
  escalated_at: string | null;
  bookings: {
    client_name: string | null;
    plan_name: string | null;
    business_name: string | null;
    contact_no: string | null;
    email_id: string | null;
    external_booking_id: string | null;
  } | null;
  assignee_name?: string | null;
}

function StageBadge({ stage }: { stage: DocStage }) {
  const s = STAGE_MAP.get(stage);
  return (
    <Badge className={`${s?.color ?? "bg-slate-500"} text-white hover:${s?.color ?? "bg-slate-500"}`}>
      {s?.label ?? stage}
    </Badge>
  );
}

function DocumentationPage() {
  const { isAdmin, hasRole } = useAuth();
  const isDocPerson = hasRole("documentation") && !isAdmin;

  if (isAdmin) {
    return <AdminDocumentationView />;
  }
  if (isDocPerson) {
    return <DocPersonView />;
  }
  // Other roles: just show tasks table
  return <TasksOnlyView />;
}

// ─── Admin View: Analytics | Tasks | Settings ────────────────────────────────

function AdminDocumentationView() {
  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Documentation</h1>
        <p className="text-sm text-muted-foreground">
          Manage documentation tasks, view analytics, and configure settings.
        </p>
      </div>
      <Tabs defaultValue="analytics">
        <TabsList>
          <TabsTrigger value="analytics">
            <BarChart3 className="h-4 w-4 mr-1.5" /> Analytics
          </TabsTrigger>
          <TabsTrigger value="tasks">
            <FileText className="h-4 w-4 mr-1.5" /> Tasks
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="h-4 w-4 mr-1.5" /> Settings
          </TabsTrigger>
        </TabsList>
        <TabsContent value="analytics">
          <AnalyticsTab />
        </TabsContent>
        <TabsContent value="tasks">
          <TasksTab isAdmin />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Documentation Person View: My Stats | My Tasks ──────────────────────────

function DocPersonView() {
  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Documentation</h1>
        <p className="text-sm text-muted-foreground">
          Track your assigned documentation tasks and personal performance.
        </p>
      </div>
      <Tabs defaultValue="my-stats">
        <TabsList>
          <TabsTrigger value="my-stats">
            <User className="h-4 w-4 mr-1.5" /> My Stats
          </TabsTrigger>
          <TabsTrigger value="my-tasks">
            <FileText className="h-4 w-4 mr-1.5" /> My Tasks
          </TabsTrigger>
        </TabsList>
        <TabsContent value="my-stats">
          <MyStatsTab />
        </TabsContent>
        <TabsContent value="my-tasks">
          <TasksTab isAdmin={false} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Tasks Only View (other roles) ──────────────────────────────────────────

function TasksOnlyView() {
  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Documentation</h1>
        <p className="text-sm text-muted-foreground">
          Track assigned documentation tasks and move them through each stage.
        </p>
      </div>
      <TasksTab isAdmin={false} />
    </div>
  );
}

// ─── Analytics Tab (Admin) ───────────────────────────────────────────────────

function AnalyticsTab() {
  const [period, setPeriod] = useState<Period>("monthly");
  const filterISO = useMemo(() => periodStart(period).toISOString(), [period]);

  // Fetch escalation threshold for stuck detection
  const { data: escalationDays = 3 } = useQuery({
    queryKey: ["doc-escalation-days"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "doc_escalation_days")
        .maybeSingle();
      if (error) throw error;
      const val = data?.value as number | null;
      return val ?? 3;
    },
  });

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["doc-analytics-tasks", period],
    queryFn: async (): Promise<DocTaskRow[]> => {
      const { data, error } = await supabase
        .from("documentation_tasks")
        .select(
          "id, booking_id, assigned_to, assigned_by, stage, notes, created_at, updated_at, escalated, escalation_reason, escalated_at, bookings(client_name, plan_name, business_name, contact_no, email_id, external_booking_id)",
        )
        .gte("created_at", filterISO)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as unknown as DocTaskRow[];
      const assigneeIds = Array.from(new Set(rows.map((r) => r.assigned_to).filter(Boolean)));
      if (assigneeIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", assigneeIds);
        const nameMap = new Map((profs ?? []).map((p) => [p.id, p.full_name]));
        for (const r of rows) {
          r.assignee_name = nameMap.get(r.assigned_to) ?? null;
        }
      }
      return rows;
    },
  });

  const perPerson = useMemo(() => {
    const map = new Map<string, { name: string; total: number; completed: number; escalated: number; pending: number; avgDays: number }>();
    for (const t of tasks) {
      const key = t.assigned_to;
      if (!map.has(key)) {
        map.set(key, { name: t.assignee_name ?? "Unknown", total: 0, completed: 0, escalated: 0, pending: 0, avgDays: 0 });
      }
      const entry = map.get(key)!;
      entry.total++;
      if (t.stage === "completed") entry.completed++;
      else entry.pending++;
      if (t.escalated) entry.escalated++;
    }
    // Calculate avg days per person
    for (const [key, entry] of map.entries()) {
      const personCompletedTasks = tasks.filter((t) => t.assigned_to === key && t.stage === "completed");
      if (personCompletedTasks.length > 0) {
        const totalDays = personCompletedTasks.reduce((sum, t) => {
          return sum + differenceInDays(new Date(t.updated_at), new Date(t.created_at));
        }, 0);
        entry.avgDays = Math.round(totalDays / personCompletedTasks.length);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [tasks]);

  // Bottleneck: stuck tasks (updated_at > escalationDays ago AND stage != completed)
  const bottleneckStages = useMemo(() => {
    const now = new Date();
    const stageCount = new Map<DocStage, number>();
    for (const t of tasks) {
      if (t.stage !== "completed") {
        const daysSinceUpdate = differenceInDays(now, new Date(t.updated_at));
        if (daysSinceUpdate > escalationDays) {
          stageCount.set(t.stage, (stageCount.get(t.stage) ?? 0) + 1);
        }
      }
    }
    return Array.from(stageCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [tasks, escalationDays]);

  // Escalated tasks list: manually escalated OR auto-detected stuck
  const escalatedTasks = useMemo(() => {
    const now = new Date();
    return tasks
      .filter((t) => {
        if (t.escalated) return true;
        if (t.stage !== "completed") {
          const daysSinceUpdate = differenceInDays(now, new Date(t.updated_at));
          return daysSinceUpdate > escalationDays;
        }
        return false;
      })
      .map((t) => ({
        ...t,
        daysStuck: differenceInDays(now, new Date(t.updated_at)),
      }))
      .sort((a, b) => b.daysStuck - a.daysStuck);
  }, [tasks, escalationDays]);

  const totalEscalated = escalatedTasks.length;
  const totalCompleted = tasks.filter((t) => t.stage === "completed").length;

  // Avg days to complete
  const avgDaysToComplete = useMemo(() => {
    const completedTasks = tasks.filter((t) => t.stage === "completed");
    if (completedTasks.length === 0) return null;
    const totalDays = completedTasks.reduce((sum, t) => {
      return sum + differenceInDays(new Date(t.updated_at), new Date(t.created_at));
    }, 0);
    return Math.round(totalDays / completedTasks.length);
  }, [tasks]);

  // Completion rate
  const completionRate = tasks.length > 0 ? Math.round((totalCompleted / tasks.length) * 100) : 0;

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Team Performance</h2>
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

      {isLoading ? (
        <div className="p-10 text-center text-muted-foreground">Loading analytics...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Total Tasks
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{tasks.length}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" /> Completed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalCompleted}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" /> Escalated
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">{totalEscalated}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Active
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{tasks.length - totalCompleted}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Avg Days
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {avgDaysToComplete !== null ? avgDaysToComplete : "-"}
                </div>
                <p className="text-xs text-muted-foreground">to complete</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" /> Completion Rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{completionRate}%</div>
              </CardContent>
            </Card>
          </div>

          {/* Per-person performance */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Per-Person Performance</CardTitle>
              <CardDescription>Task distribution, completion rate, and average days per team member.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Completed</TableHead>
                    <TableHead>Pending</TableHead>
                    <TableHead>Escalated</TableHead>
                    <TableHead>Avg Days</TableHead>
                    <TableHead>Completion Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {perPerson.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                        No data available for this period.
                      </TableCell>
                    </TableRow>
                  ) : (
                    perPerson.map((p) => (
                      <TableRow key={p.name}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell>{p.total}</TableCell>
                        <TableCell>{p.completed}</TableCell>
                        <TableCell>{p.pending}</TableCell>
                        <TableCell>
                          {p.escalated > 0 ? (
                            <span className="text-red-600 font-medium">{p.escalated}</span>
                          ) : (
                            "0"
                          )}
                        </TableCell>
                        <TableCell>
                          {p.completed > 0 ? `${p.avgDays}d` : "-"}
                        </TableCell>
                        <TableCell>
                          {p.total > 0 ? `${Math.round((p.completed / p.total) * 100)}%` : "-"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Bottleneck stages - stuck tasks */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Stage Bottlenecks (Stuck Tasks)</CardTitle>
              <CardDescription>
                Stages with the most stuck tasks (no update for more than {escalationDays} days).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {bottleneckStages.length === 0 ? (
                <div className="text-sm text-muted-foreground">No stuck tasks detected.</div>
              ) : (
                <div className="space-y-2">
                  {bottleneckStages.map(([stage, count]) => {
                    const info = STAGE_MAP.get(stage);
                    return (
                      <div key={stage} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`h-3 w-3 rounded-full ${info?.color ?? "bg-slate-500"}`} />
                          <span className="text-sm">{info?.label ?? stage}</span>
                        </div>
                        <Badge variant="outline" className="text-red-600 border-red-200">
                          {count} stuck
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Escalated Tasks Section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-red-600">Escalated Tasks</CardTitle>
              <CardDescription>
                Tasks that are manually escalated or auto-detected as stuck (no update for more than {escalationDays} days).
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {escalatedTasks.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground text-center">
                  No escalated tasks in this period.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>Assignee</TableHead>
                      <TableHead>Days Stuck</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {escalatedTasks.map((t) => (
                      <TableRow key={t.id} className="bg-red-50 dark:bg-red-950/20">
                        <TableCell className="font-medium">
                          {t.bookings?.client_name ?? "-"}
                        </TableCell>
                        <TableCell>{t.assignee_name ?? "-"}</TableCell>
                        <TableCell>
                          <span className="text-red-600 font-medium">{t.daysStuck}d</span>
                        </TableCell>
                        <TableCell>
                          <StageBadge stage={t.stage} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {t.escalation_reason ?? "Auto-detected (no updates)"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ─── My Stats Tab (Documentation Person) ────────────────────────────────────

function MyStatsTab() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>("monthly");
  const filterISO = useMemo(() => periodStart(period).toISOString(), [period]);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["doc-my-stats", period, user?.id],
    queryFn: async (): Promise<DocTaskRow[]> => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("documentation_tasks")
        .select(
          "id, booking_id, assigned_to, assigned_by, stage, notes, created_at, updated_at, escalated, escalation_reason, escalated_at, bookings(client_name, plan_name, business_name, contact_no, email_id, external_booking_id)",
        )
        .eq("assigned_to", user.id)
        .gte("created_at", filterISO)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as DocTaskRow[];
    },
    enabled: !!user?.id,
  });

  const stats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.stage === "completed").length;
    const active = tasks.filter((t) => t.stage !== "completed").length;
    const escalated = tasks.filter((t) => t.escalated).length;
    return { total, completed, active, escalated };
  }, [tasks]);

  // Avg days to complete for my tasks
  const avgDays = useMemo(() => {
    const completedTasks = tasks.filter((t) => t.stage === "completed");
    if (completedTasks.length === 0) return null;
    const totalDays = completedTasks.reduce((sum, t) => {
      return sum + differenceInDays(new Date(t.updated_at), new Date(t.created_at));
    }, 0);
    return Math.round(totalDays / completedTasks.length);
  }, [tasks]);

  // Stage distribution for active (non-completed) tasks
  const stageDistribution = useMemo(() => {
    const stageCount = new Map<DocStage, number>();
    for (const t of tasks) {
      if (t.stage !== "completed") {
        stageCount.set(t.stage, (stageCount.get(t.stage) ?? 0) + 1);
      }
    }
    return Array.from(stageCount.entries())
      .sort((a, b) => b[1] - a[1]);
  }, [tasks]);

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">My Performance</h2>
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

      {isLoading ? (
        <div className="p-10 text-center text-muted-foreground">Loading stats...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Total
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
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Avg Time
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {avgDays !== null ? `${avgDays}d` : "-"}
                </div>
                <p className="text-xs text-muted-foreground">to complete</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Completion Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {stats.total > 0 ? `${Math.round((stats.completed / stats.total) * 100)}%` : "-"}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {stats.completed} of {stats.total} tasks completed this period.
              </p>
            </CardContent>
          </Card>

          {/* Stage Distribution */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Stage Distribution</CardTitle>
              <CardDescription>
                How your active tasks are distributed across stages.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {stageDistribution.length === 0 ? (
                <div className="text-sm text-muted-foreground">No active tasks.</div>
              ) : (
                <div className="space-y-2">
                  {stageDistribution.map(([stage, count]) => {
                    const info = STAGE_MAP.get(stage);
                    return (
                      <div key={stage} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`h-3 w-3 rounded-full ${info?.color ?? "bg-slate-500"}`} />
                          <span className="text-sm">{info?.label ?? stage}</span>
                        </div>
                        <Badge variant="outline">{count} tasks</Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ─── Settings Tab (Admin) ────────────────────────────────────────────────────

function SettingsTab() {
  const queryClient = useQueryClient();
  const [days, setDays] = useState<string>("");

  const { data: currentDays, isLoading } = useQuery({
    queryKey: ["doc-escalation-days-setting"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "doc_escalation_days")
        .maybeSingle();
      if (error) throw error;
      const val = data?.value as number | null;
      return val ?? 3;
    },
  });

  // Sync local state when data loads
  useMemo(() => {
    if (currentDays !== undefined && days === "") {
      setDays(String(currentDays));
    }
  }, [currentDays]);

  const saveMutation = useMutation({
    mutationFn: async (newDays: number) => {
      const { error } = await supabase
        .from("app_settings")
        .upsert({ key: "doc_escalation_days", value: newDays as unknown as Database["public"]["Tables"]["app_settings"]["Row"]["value"] }, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Escalation threshold updated");
      queryClient.invalidateQueries({ queryKey: ["doc-escalation-days-setting"] });
      queryClient.invalidateQueries({ queryKey: ["doc-escalation-days"] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to save setting");
    },
  });

  const handleSave = () => {
    const num = parseInt(days, 10);
    if (isNaN(num) || num < 1) {
      toast.error("Please enter a valid number of days (minimum 1)");
      return;
    }
    saveMutation.mutate(num);
  };

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Escalation Settings</CardTitle>
          <CardDescription>
            Configure how many days a task can stay without progress before being auto-flagged as escalated.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : (
            <>
              <div className="max-w-xs space-y-2">
                <Label htmlFor="escalation-days" className="text-sm">
                  Escalation threshold (days)
                </Label>
                <Input
                  id="escalation-days"
                  type="number"
                  min={1}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  placeholder="3"
                />
                <p className="text-xs text-muted-foreground">
                  Tasks with no update for more than this many days will be visually flagged as escalated.
                  Current threshold: <strong>{currentDays} days</strong>.
                </p>
              </div>
              <Button onClick={handleSave} disabled={saveMutation.isPending}>
                {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Save Setting
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tasks Tab (shared between Admin and Doc Person) ─────────────────────────

function TasksTab({ isAdmin }: { isAdmin: boolean }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<Period>("monthly");
  const [search, setSearch] = useState("");

  const filterISO = useMemo(() => periodStart(period).toISOString(), [period]);

  // Fetch escalation threshold from app_settings
  const { data: escalationDays = 3 } = useQuery({
    queryKey: ["doc-escalation-days"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "doc_escalation_days")
        .maybeSingle();
      if (error) throw error;
      const val = data?.value as number | null;
      return val ?? 3;
    },
  });

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["documentation-tasks", period, isAdmin ? "all" : user?.id],
    queryFn: async (): Promise<DocTaskRow[]> => {
      let query = supabase
        .from("documentation_tasks")
        .select(
          "id, booking_id, assigned_to, assigned_by, stage, notes, created_at, updated_at, escalated, escalation_reason, escalated_at, bookings(client_name, plan_name, business_name, contact_no, email_id, external_booking_id)",
        )
        .gte("created_at", filterISO)
        .order("created_at", { ascending: false });

      if (!isAdmin && user?.id) {
        query = query.eq("assigned_to", user.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      const rows = (data ?? []) as unknown as DocTaskRow[];

      const assigneeIds = Array.from(new Set(rows.map((r) => r.assigned_to).filter(Boolean)));
      if (assigneeIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", assigneeIds);
        const nameMap = new Map((profs ?? []).map((p) => [p.id, p.full_name]));
        for (const r of rows) {
          r.assignee_name = nameMap.get(r.assigned_to) ?? null;
        }
      }
      return rows;
    },
  });

  const stageMutation = useMutation({
    mutationFn: async ({ taskId, stage }: { taskId: string; stage: DocStage }) => {
      const { error } = await supabase
        .from("documentation_tasks")
        .update({ stage })
        .eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Stage updated");
      queryClient.invalidateQueries({ queryKey: ["documentation-tasks"] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to update stage");
    },
  });

  const escalateMutation = useMutation({
    mutationFn: async ({ taskId, reason }: { taskId: string; reason: string }) => {
      const { error } = await supabase
        .from("documentation_tasks")
        .update({
          escalated: true,
          escalation_reason: reason,
          escalated_at: new Date().toISOString(),
        })
        .eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Task escalated");
      queryClient.invalidateQueries({ queryKey: ["documentation-tasks"] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to escalate task");
    },
  });

  const stats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.stage === "completed").length;
    const active = tasks.filter((t) => t.stage !== "completed").length;
    const partial = tasks.filter((t) => PARTIAL_STAGES.includes(t.stage)).length;
    return { total, active, completed, partial };
  }, [tasks]);

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return tasks;
    return tasks.filter((task) => {
      const b = task.bookings;
      return [b?.client_name, b?.plan_name, b?.business_name].some((v) =>
        (v ?? "").toLowerCase().includes(t),
      );
    });
  }, [tasks, search]);

  // Check if a task is auto-escalated (client-side detection)
  const isAutoEscalated = (task: DocTaskRow): boolean => {
    if (task.stage === "completed") return false;
    const daysSinceUpdate = differenceInDays(new Date(), new Date(task.updated_at));
    return daysSinceUpdate > escalationDays;
  };

  // Check if a task should show as escalated (either manual or auto)
  const isEscalated = (task: DocTaskRow): boolean => {
    return task.escalated || isAutoEscalated(task);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                <FileText className="h-4 w-4" /> Total
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
                <Loader2 className="h-4 w-4" /> Partial
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.partial}</div>
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
        </div>
        <div className="w-full md:w-40">
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

      <div className="relative max-w-md">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by client, plan or business..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-10 text-center text-muted-foreground">Loading documentation tasks...</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">No documentation tasks found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client Name</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Stage</TableHead>
                  {isAdmin && <TableHead>Assigned To</TableHead>}
                  <TableHead>Created</TableHead>
                  <TableHead className="w-56">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((task) => {
                  const escalated = isEscalated(task);
                  return (
                    <TableRow
                      key={task.id}
                      className={escalated ? "bg-red-50 dark:bg-red-950/20" : ""}
                    >
                      <TableCell>
                        <div className="font-medium">{task.bookings?.client_name ?? "—"}</div>
                        {task.bookings?.business_name && (
                          <div className="text-xs text-muted-foreground">{task.bookings.business_name}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{task.bookings?.plan_name ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <StageBadge stage={task.stage} />
                          {escalated && (
                            <Badge className="bg-red-600 text-white hover:bg-red-700">
                              Escalated
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-sm">{task.assignee_name ?? "—"}</TableCell>
                      )}
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(task.created_at), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Select
                            value={task.stage}
                            onValueChange={(v) =>
                              stageMutation.mutate({ taskId: task.id, stage: v as DocStage })
                            }
                            disabled={stageMutation.isPending}
                          >
                            <SelectTrigger className="h-8 flex-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {DOC_STAGES.filter((_, idx) => idx >= DOC_STAGES.findIndex((s) => s.id === task.stage)).map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {isAdmin && !task.escalated && (
                            <EscalateButton
                              taskId={task.id}
                              onEscalate={(reason) =>
                                escalateMutation.mutate({ taskId: task.id, reason })
                              }
                              isPending={escalateMutation.isPending}
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Escalate Button with Popover ────────────────────────────────────────────

function EscalateButton({
  taskId,
  onEscalate,
  isPending,
}: {
  taskId: string;
  onEscalate: (reason: string) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const handleSubmit = () => {
    if (!reason.trim()) {
      toast.error("Please provide an escalation reason");
      return;
    }
    onEscalate(reason.trim());
    setReason("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 px-2 text-red-600 border-red-200 hover:bg-red-50">
          <AlertTriangle className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-3">
          <div>
            <h4 className="font-medium text-sm">Escalate Task</h4>
            <p className="text-xs text-muted-foreground">
              Flag this task as escalated. Provide a reason below.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`reason-${taskId}`} className="text-xs">
              Escalation Reason
            </Label>
            <Input
              id={`reason-${taskId}`}
              placeholder="e.g., Client not responding..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleSubmit}
              disabled={isPending}
            >
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              Escalate
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
