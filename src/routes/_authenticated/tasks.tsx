import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, CalendarClock, Flag } from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { format, isPast, isToday } from "date-fns";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({ meta: [{ title: "Tasks — EaseMyOffice CRM" }] }),
  component: TasksPage,
});

type Task = {
  id: string; title: string; description: string | null; status: string;
  priority: string; due_at: string | null; owner_id: string | null; created_by: string | null;
  lead_id: string | null; created_at: string;
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  medium: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  high: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  urgent: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
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

  const { data: team = [] } = useQuery({
    queryKey: ["team-members"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").order("full_name", { ascending: true });
      return data ?? [];
    },
  });

  const reassign = useMutation({
    mutationFn: async ({ id, owner_id }: { id: string; owner_id: string }) => {
      const { error } = await supabase.from("tasks").update({ owner_id }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); toast.success("Task assigned"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Tasks</h1>
          <p className="text-sm text-muted-foreground">Personal & team task board.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> New task</Button>
          </DialogTrigger>
          <NewTaskDialog onClose={() => setOpen(false)} userId={user?.id ?? null} />
        </Dialog>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(["all", "todo", "in_progress", "done"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f === "in_progress" ? "In progress" : f[0].toUpperCase() + f.slice(1)}
            <Badge variant="secondary" className="ml-2">{counts[f]}</Badge>
          </Button>
        ))}
      </div>

      {isLoading ? (
        <Card><CardContent className="p-10 text-center text-muted-foreground">Loading…</CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-muted-foreground">No tasks. Create one to get started.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => {
            const overdue = t.due_at && isPast(new Date(t.due_at)) && !isToday(new Date(t.due_at)) && t.status !== "done";
            return (
              <Card key={t.id} className={overdue ? "border-destructive/50" : ""}>
                <CardContent className="p-3 flex items-start gap-3">
                  <Checkbox
                    checked={t.status === "done"}
                    onCheckedChange={(v) => toggle.mutate({ id: t.id, status: v ? "done" : "todo" })}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>{t.title}</div>
                    {t.description && <div className="text-sm text-muted-foreground mt-0.5">{t.description}</div>}
                    <div className="flex flex-wrap gap-2 mt-2 items-center">
                      <Badge className={PRIORITY_COLORS[t.priority] ?? ""} variant="secondary">
                        <Flag className="h-3 w-3 mr-1" /> {t.priority}
                      </Badge>
                      {t.due_at && (
                        <span className={`text-xs flex items-center gap-1 ${overdue ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                          <CalendarClock className="h-3 w-3" /> {format(new Date(t.due_at), "MMM d, h:mm a")}
                        </span>
                      )}
                      <Select value={t.status} onValueChange={(v) => toggle.mutate({ id: t.id, status: v })}>
                        <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="todo">To do</SelectItem>
                          <SelectItem value="in_progress">In progress</SelectItem>
                          <SelectItem value="done">Done</SelectItem>
                        </SelectContent>
                      </Select>
                      {isAdmin && (
                        <Select value={t.owner_id ?? ""} onValueChange={(v) => reassign.mutate({ id: t.id, owner_id: v })}>
                          <SelectTrigger className="h-7 w-40 text-xs">
                            <SelectValue placeholder="Assign to…" />
                          </SelectTrigger>
                          <SelectContent>
                            {(team as any[]).map((m) => (
                              <SelectItem key={m.id} value={m.id}>{m.full_name || m.email || "User"}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <Button size="icon" variant="ghost" onClick={() => del.mutate(t.id)} title="Delete task (admin only)">
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NewTaskDialog({ onClose, userId }: { onClose: () => void; userId: string | null }) {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueAt, setDueAt] = useState("");
  const [owner, setOwner] = useState(userId ?? "");

  const { data: team = [] } = useQuery({
    queryKey: ["team-members"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").order("full_name", { ascending: true });
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("tasks").insert({
        title, description: description || null,
        priority: priority as never, status: "todo" as never,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        owner_id: owner || userId, created_by: userId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task created");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>New task</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium">Title</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Follow up with Acme" />
        </div>
        <div>
          <label className="text-sm font-medium">Description</label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </div>
        {isAdmin && (
          <div>
            <label className="text-sm font-medium">Assign to</label>
            <Select value={owner} onValueChange={setOwner}>
              <SelectTrigger><SelectValue placeholder="Choose team member" /></SelectTrigger>
              <SelectContent>
                {(team as any[]).map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.full_name || m.email || "User"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">Priority</label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="high">High — remind every 30 min</SelectItem>
                <SelectItem value="medium">Medium — remind hourly</SelectItem>
                <SelectItem value="low">Low — remind daily</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Due</label>
            <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!title || create.isPending} onClick={() => create.mutate()}>Create</Button>
      </DialogFooter>
    </DialogContent>
  );
}
