import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, FileText, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { useState, useMemo } from "react";
import {
  format,
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfYear,
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

// Intermediate stages: started but not completed (past "assigned", before "completed").
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
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<Period>("monthly");
  const [search, setSearch] = useState("");

  const filterISO = useMemo(() => periodStart(period).toISOString(), [period]);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["documentation-tasks", period],
    queryFn: async (): Promise<DocTaskRow[]> => {
      const { data, error } = await supabase
        .from("documentation_tasks")
        .select(
          "id, booking_id, assigned_to, assigned_by, stage, notes, created_at, updated_at, bookings(client_name, plan_name, business_name, contact_no, email_id, external_booking_id)",
        )
        .gte("created_at", filterISO)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as unknown as DocTaskRow[];

      // Resolve assignee names via a separate profiles query (FK constraint
      // name is auto-generated, so we avoid the embedded profile join).
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

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-4">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Documentation</h1>
          <p className="text-sm text-muted-foreground">
            Track assigned documentation tasks and move them through each stage.
          </p>
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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

      <div className="relative max-w-md">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by client, plan or business…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-10 text-center text-muted-foreground">Loading documentation tasks…</div>
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
                {filtered.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell>
                      <div className="font-medium">{task.bookings?.client_name ?? "—"}</div>
                      {task.bookings?.business_name && (
                        <div className="text-xs text-muted-foreground">{task.bookings.business_name}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{task.bookings?.plan_name ?? "—"}</TableCell>
                    <TableCell>
                      <StageBadge stage={task.stage} />
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-sm">{task.assignee_name ?? "—"}</TableCell>
                    )}
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(task.created_at), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={task.stage}
                        onValueChange={(v) =>
                          stageMutation.mutate({ taskId: task.id, stage: v as DocStage })
                        }
                        disabled={stageMutation.isPending}
                      >
                        <SelectTrigger className="h-8">
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
