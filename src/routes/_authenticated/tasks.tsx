import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Plus, Trash2, Flag, Clock, CheckCircle2, Circle, Loader2,
  ListTodo, Timer, Sparkles, UserCircle2,
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { format, isPast, isToday, formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({ meta: [{ title: "Tasks — EaseMyOffice CRM" }] }),
  component: TasksPage,
});

type Task = {
  id: string; title: string; description: string | null; status: string;
  priority: string; due_at: string | null; owner_id: string | null; created_by: string | null;
  lead_id: string | null; created_at: string;
};

const PRIORITY_META: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  urgent: { label: "Urgent", color: "text-rose-600", bg: "bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800", icon: "bg-rose-500" },
  high: { label: "High", color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800", icon: "bg-amber-500" },
  medium: { label: "Medium", color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800", icon: "bg-blue-500" },
  low: { label: "Low", color: "text-slate-500", bg: "bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700", icon: "bg-slate-400" },
};

const STATUS_META: Record<string, { label: string; icon: typeof Circle; color: string }> = {
  todo: { label: "To do", icon: Circle, color: "text-muted-foreground" },
  in_progress: { label: "In progress", icon: Timer, color: "text-blue-600" },
  done: { label: "Done", icon: CheckCircle2, color: "text-emerald-600" },
};

function TasksPage() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "todo" | "in_progress" | "done">("all");
  const [open, setOpen] = useState(false);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tasks").select("*").order("due_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Task[];
    },
  });

  const { data: team = [] } = useQuery({
    queryKey: ["team-members"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").order("full_name", { ascending: true });
      return data ?? [];
    },
  });

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    (team as any[]).forEach((u) => m.set(u.id, u.full_name || u.email || ""));
    return m;
  }, [team]);

  const filtered = useMemo(() => {
    if (filter === "all") return tasks;
    return tasks.filter((t) => t.status === filter);
  }, [tasks, filter]);

  const counts = useMemo(() => ({
    all: tasks.length,
    todo: tasks.filter((t) => t.status === "todo").length,
    in_progress: tasks.filter((t) => t.status === "in_progress").length,
    done: tasks.filter((t) => t.status === "done").length,
  }), [tasks]);

  const toggle = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("tasks").update({ status: status as never }).eq("id", id);
      if (error) throw error;
      // When completing a task assigned by someone else, notify the assigner.
      if (status === "done") {
        const task = tasks.find((t) => t.id === id);
        if (task && task.created_by && task.created_by !== user?.id) {
          await supabase.from("notifications").insert({
            user_id: task.created_by,
            title: "Task completed",
            body: `${nameById.get(user?.id ?? "") || "Someone"} completed: "${task.title}"`,
            type: "task_done",
          }).then(() => {}); // fire-and-forget
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tasks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); toast.success("Task deleted"); },
  });

  const reassign = useMutation({
    mutationFn: async ({ id, owner_id }: { id: string; owner_id: string }) => {
      const { error } = await supabase.from("tasks").update({ owner_id }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); toast.success("Reassigned"); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Real-time: subscribe to tasks changes so updates from other users appear
  // instantly (no manual refresh needed).
  useEffect(() => {
    const channel = supabase
      .channel("tasks-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, (payload) => {
        qc.invalidateQueries({ queryKey: ["tasks"] });
        qc.invalidateQueries({ queryKey: ["calendar-tasks"] });

        // Notify the assigner when their task is marked done by someone else.
        if (payload.eventType === "UPDATE" && payload.new && payload.old) {
          const newRow = payload.new as any;
          const oldRow = payload.old as any;
          if (newRow.status === "done" && oldRow.status !== "done" && newRow.created_by === user?.id && newRow.owner_id !== user?.id) {
            const ownerName = nameById.get(newRow.owner_id) || "Someone";
            toast.success(`${ownerName} completed: "${newRow.title}"`);
          }
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc, user?.id, nameById]);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <ListTodo className="h-7 w-7 text-primary" /> Tasks
          </h1>
          <p className="text-sm text-muted-foreground">Your personal & team task board. Stay on top of deadlines.</p>
        </div>
        <Button onClick={() => setOpen(true)} className="shadow-sm">
          <Plus className="h-4 w-4 mr-2" /> New Task
        </Button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-3">
        {(["all", "todo", "in_progress", "done"] as const).map((f) => {
          const active = filter === f;
          const meta = f === "all" ? null : STATUS_META[f];
          const Icon = meta?.icon ?? Sparkles;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-xl border p-3 text-left transition-all ${
                active ? "ring-2 ring-primary bg-primary/5 border-primary/30" : "hover:border-primary/30 hover:bg-accent/40"
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${meta?.color ?? "text-primary"}`} />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {f === "in_progress" ? "In Progress" : f === "all" ? "All" : f[0].toUpperCase() + f.slice(1)}
                </span>
              </div>
              <div className="text-2xl font-bold mt-1">{counts[f]}</div>
            </button>
          );
        })}
      </div>

      {/* Task list */}
      {isLoading ? (
        <Card><CardContent className="p-10 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />Loading tasks...</CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <Circle className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-muted-foreground">No tasks here yet.</p>
            <Button size="sm" variant="link" onClick={() => setOpen(true)} className="mt-2">
              <Plus className="h-3.5 w-3.5 mr-1" /> Create your first task
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => {
            const pm = PRIORITY_META[t.priority] ?? PRIORITY_META.medium;
            const overdue = t.due_at && isPast(new Date(t.due_at)) && !isToday(new Date(t.due_at)) && t.status !== "done";
            const ownerName = t.owner_id ? nameById.get(t.owner_id) : null;
            return (
              <div
                key={t.id}
                className={`flex items-start gap-3 rounded-xl border p-4 transition-all ${
                  t.status === "done" ? "opacity-60 bg-muted/20" : overdue ? "border-destructive/40 bg-destructive/5" : "hover:shadow-sm hover:border-primary/20"
                }`}
              >
                <Checkbox
                  checked={t.status === "done"}
                  onCheckedChange={(v) => toggle.mutate({ id: t.id, status: v ? "done" : "todo" })}
                  className="mt-0.5 h-5 w-5 rounded-full"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-medium ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>{t.title}</span>
                    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${pm.bg} ${pm.color}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${pm.icon}`} /> {pm.label}
                    </span>
                  </div>
                  {t.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{t.description}</p>}
                  <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
                    {t.due_at && (
                      <span className={`inline-flex items-center gap-1 ${overdue ? "text-destructive font-medium" : ""}`}>
                        <Clock className="h-3 w-3" />
                        {overdue ? "Overdue — " : ""}
                        {format(new Date(t.due_at), "MMM d")} at {format(new Date(t.due_at), "h:mm a")}
                      </span>
                    )}
                    {ownerName && (
                      <span className="inline-flex items-center gap-1">
                        <UserCircle2 className="h-3 w-3" /> {ownerName}
                      </span>
                    )}
                    <Select value={t.status} onValueChange={(v) => toggle.mutate({ id: t.id, status: v })}>
                      <SelectTrigger className="h-6 w-28 text-[11px] border-dashed"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todo">To do</SelectItem>
                        <SelectItem value="in_progress">In progress</SelectItem>
                        <SelectItem value="done">Done</SelectItem>
                      </SelectContent>
                    </Select>
                    {isAdmin && (
                      <Select value={t.owner_id ?? ""} onValueChange={(v) => reassign.mutate({ id: t.id, owner_id: v })}>
                        <SelectTrigger className="h-6 w-32 text-[11px] border-dashed">
                          <SelectValue placeholder="Assign..." />
                        </SelectTrigger>
                        <SelectContent>
                          {(team as any[]).map((m) => (
                            <SelectItem key={m.id} value={m.id}>{m.full_name || m.email}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
                {(isAdmin || t.owner_id === user?.id || t.created_by === user?.id) && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      if (window.confirm("Delete this task?")) del.mutate(t.id);
                    }}
                    title="Delete task"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* New Task Dialog */}
      <NewTaskDialog open={open} onClose={() => setOpen(false)} userId={user?.id ?? null} team={team as any[]} />
    </div>
  );
}

function NewTaskDialog({ open, onClose, userId, team }: { open: boolean; onClose: () => void; userId: string | null; team: any[] }) {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("09:00");
  const [owner, setOwner] = useState(userId ?? "");

  const reset = () => { setTitle(""); setDescription(""); setPriority("medium"); setDueDate(""); setDueTime("09:00"); setOwner(userId ?? ""); };

  const create = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Title is required");
      const dueAt = dueDate ? new Date(`${dueDate}T${dueTime || "09:00"}:00`).toISOString() : null;
      const { error } = await supabase.from("tasks").insert({
        title: title.trim(),
        description: description.trim() || null,
        priority: priority as never,
        status: "todo" as never,
        due_at: dueAt,
        owner_id: owner || userId,
        created_by: userId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["calendar-tasks"] });
      toast.success("Task created");
      reset();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary/10 grid place-items-center">
              <Plus className="h-4 w-4 text-primary" />
            </div>
            Create New Task
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div>
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">What needs to be done?</Label>
            <Input
              autoFocus
              className="mt-1.5 text-base"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Follow up with Sudip on proposal"
            />
          </div>

          <div>
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Details (optional)</Label>
            <Textarea
              className="mt-1.5 resize-none"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add notes, context, or links..."
            />
          </div>

          {isAdmin && (
            <div>
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Assign to</Label>
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Choose team member" />
                </SelectTrigger>
                <SelectContent>
                  {team.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <span className="flex items-center gap-2">
                        <UserCircle2 className="h-4 w-4 text-muted-foreground" />
                        {m.full_name || m.email}
                        {m.id === userId && <Badge variant="secondary" className="ml-1 text-[10px]">you</Badge>}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_META).map(([key, meta]) => (
                    <SelectItem key={key} value={key}>
                      <span className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${meta.icon}`} />
                        {meta.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Due date</Label>
              <Input
                type="date"
                className="mt-1.5"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Time</Label>
              <Input
                type="time"
                className="mt-1.5"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="pt-4 border-t mt-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!title.trim() || create.isPending}
            onClick={() => create.mutate()}
            className="min-w-[100px]"
          >
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
