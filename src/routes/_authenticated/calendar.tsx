import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronLeft, ChevronRight, Bell, IndianRupee, Plus, CalendarDays,
  Flag, CheckCircle2, Circle, Clock,
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import {
  startOfMonth, endOfMonth, eachDayOfInterval, format, isSameMonth, isSameDay,
  addMonths, subMonths, startOfWeek, endOfWeek, isToday, isPast,
} from "date-fns";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({ meta: [{ title: "Calendar — EaseMyOffice CRM" }] }),
  component: CalendarPage,
});

type Task = {
  id: string; title: string; description: string | null; status: string;
  priority: string; due_at: string | null; owner_id: string | null; created_at: string;
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-slate-200 dark:bg-slate-700",
  medium: "bg-blue-200 dark:bg-blue-800",
  high: "bg-amber-200 dark:bg-amber-800",
  urgent: "bg-rose-200 dark:bg-rose-800",
};

const PRIORITY_TEXT: Record<string, string> = {
  low: "text-slate-700 dark:text-slate-200",
  medium: "text-blue-700 dark:text-blue-200",
  high: "text-amber-700 dark:text-amber-200",
  urgent: "text-rose-700 dark:text-rose-200",
};

function CalendarPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [cursor, setCursor] = useState(new Date());
  const [selected, setSelected] = useState<Date | null>(new Date());
  const [addOpen, setAddOpen] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: "", description: "", priority: "medium", due_time: "09:00" });

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  // Tasks for the visible calendar range
  const { data: tasks = [] } = useQuery({
    queryKey: ["calendar-tasks", calStart.toISOString(), calEnd.toISOString()],
    queryFn: async () => {
      const { data } = await supabase.from("tasks")
        .select("id, title, description, status, priority, due_at, owner_id, created_at")
        .not("due_at", "is", null)
        .gte("due_at", calStart.toISOString())
        .lte("due_at", calEnd.toISOString())
        .order("due_at", { ascending: true })
        .limit(500);
      return (data ?? []) as Task[];
    },
  });

  // Follow-ups
  const { data: followups = [] } = useQuery({
    queryKey: ["calendar-followups", calStart.toISOString(), calEnd.toISOString()],
    queryFn: async () => {
      const { data } = await supabase.from("follow_ups").select("id, action, due_at, status, lead_id")
        .gte("due_at", calStart.toISOString()).lte("due_at", calEnd.toISOString()).limit(500);
      return data ?? [];
    },
  });

  // Payment due dates
  const { data: bookings = [] } = useQuery({
    queryKey: ["calendar-bookings", calStart.toISOString(), calEnd.toISOString()],
    queryFn: async () => {
      const { data } = await supabase.from("bookings").select("id, client_name, balance_due_date, balance_amount, booking_code")
        .not("balance_due_date", "is", null)
        .gte("balance_due_date", format(calStart, "yyyy-MM-dd"))
        .lte("balance_due_date", format(calEnd, "yyyy-MM-dd"));
      return data ?? [];
    },
  });

  // Group events by day
  const eventsByDay = useMemo(() => {
    const m = new Map<string, { tasks: Task[]; followups: any[]; payments: any[] }>();
    days.forEach((d) => m.set(format(d, "yyyy-MM-dd"), { tasks: [], followups: [], payments: [] }));
    tasks.forEach((t) => {
      if (t.due_at) {
        const k = format(new Date(t.due_at), "yyyy-MM-dd");
        m.get(k)?.tasks.push(t);
      }
    });
    followups.forEach((f: any) => {
      const k = format(new Date(f.due_at), "yyyy-MM-dd");
      m.get(k)?.followups.push(f);
    });
    bookings.forEach((b: any) => {
      m.get(b.balance_due_date)?.payments.push(b);
    });
    return m;
  }, [days, tasks, followups, bookings]);

  const selectedKey = selected ? format(selected, "yyyy-MM-dd") : null;
  const selectedEvents = selectedKey ? eventsByDay.get(selectedKey) : null;

  // Login notification: show today's tasks as a toast when the page first loads
  const [notified, setNotified] = useState(false);
  useEffect(() => {
    if (notified || !user?.id) return;
    const todayKey = format(new Date(), "yyyy-MM-dd");
    const todayTasks = tasks.filter((t) => t.due_at && format(new Date(t.due_at), "yyyy-MM-dd") === todayKey && t.status !== "done");
    if (todayTasks.length > 0) {
      toast(`You have ${todayTasks.length} task${todayTasks.length > 1 ? "s" : ""} today`, {
        description: todayTasks.slice(0, 3).map((t) => t.title).join(", ") + (todayTasks.length > 3 ? "..." : ""),
        duration: 8000,
      });
    }
    setNotified(true);
  }, [tasks, user?.id, notified]);

  // Add task mutation
  const addTask = useMutation({
    mutationFn: async () => {
      if (!taskForm.title.trim()) throw new Error("Title is required");
      if (!selected) throw new Error("Select a date first");
      const dueAt = new Date(`${format(selected, "yyyy-MM-dd")}T${taskForm.due_time || "09:00"}:00`);
      const { error } = await supabase.from("tasks").insert({
        title: taskForm.title.trim(),
        description: taskForm.description.trim() || null,
        priority: taskForm.priority as never,
        due_at: dueAt.toISOString(),
        owner_id: user?.id ?? null,
        created_by: user?.id ?? null,
        status: "todo" as never,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Task added to calendar");
      setTaskForm({ title: "", description: "", priority: "medium", due_time: "09:00" });
      setAddOpen(false);
      qc.invalidateQueries({ queryKey: ["calendar-tasks"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Toggle task status
  const toggleTask = useMutation({
    mutationFn: async ({ id, done }: { id: string; done: boolean }) => {
      const { error } = await supabase.from("tasks").update({ status: (done ? "done" : "todo") as never }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar-tasks"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <CalendarDays className="h-7 w-7 text-primary" /> Calendar
          </h1>
          <p className="text-sm text-muted-foreground">Your tasks, follow-ups, and payment dues at a glance.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" onClick={() => setCursor(subMonths(cursor, 1))}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="font-semibold min-w-36 text-center text-lg">{format(cursor, "MMMM yyyy")}</div>
          <Button size="icon" variant="outline" onClick={() => setCursor(addMonths(cursor, 1))}><ChevronRight className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={() => { setCursor(new Date()); setSelected(new Date()); }}>Today</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
        {/* Calendar Grid */}
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {/* Day headers */}
            <div className="grid grid-cols-7 bg-muted/40 border-b">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="p-2.5 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">{d}</div>
              ))}
            </div>
            {/* Day cells */}
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const inMonth = isSameMonth(d, cursor);
                const today = isToday(d);
                const sel = selected && isSameDay(d, selected);
                const k = format(d, "yyyy-MM-dd");
                const ev = eventsByDay.get(k)!;
                const taskCount = ev.tasks.filter((t) => t.status !== "done").length;
                const fuCount = ev.followups.length;
                const payCount = ev.payments.length;
                const total = taskCount + fuCount + payCount;
                return (
                  <button
                    key={k}
                    onClick={() => setSelected(d)}
                    className={`min-h-[88px] p-1.5 border-b border-r text-left transition-all relative group ${
                      !inMonth ? "bg-muted/10 text-muted-foreground/50" : "hover:bg-accent/40"
                    } ${sel ? "bg-primary/5 ring-2 ring-primary ring-inset" : ""}`}
                  >
                    <div className={`text-xs font-medium inline-flex items-center justify-center rounded-full w-6 h-6 ${
                      today ? "bg-primary text-primary-foreground" : ""
                    }`}>
                      {format(d, "d")}
                    </div>
                    <div className="space-y-0.5 mt-0.5">
                      {taskCount > 0 && (
                        <div className="text-[10px] bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300 rounded px-1 truncate flex items-center gap-0.5">
                          <Flag className="h-2.5 w-2.5" />{taskCount} task{taskCount > 1 ? "s" : ""}
                        </div>
                      )}
                      {fuCount > 0 && (
                        <div className="text-[10px] bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 rounded px-1 truncate">
                          {fuCount} follow-up{fuCount > 1 ? "s" : ""}
                        </div>
                      )}
                      {payCount > 0 && (
                        <div className="text-[10px] bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 rounded px-1 truncate">
                          {payCount} due
                        </div>
                      )}
                    </div>
                    {/* Quick add button on hover */}
                    {inMonth && (
                      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelected(d); setAddOpen(true); }}
                          className="h-5 w-5 rounded-full bg-primary text-primary-foreground grid place-items-center text-xs hover:scale-110 transition-transform"
                          title="Add task"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Right panel: selected day details */}
        <div className="space-y-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="font-semibold">
                  {selected ? format(selected, "EEE, MMM d") : "Select a day"}
                </div>
                {selected && (
                  <Button size="sm" onClick={() => setAddOpen(true)}>
                    <Plus className="h-4 w-4 mr-1" /> Add Task
                  </Button>
                )}
              </div>

              {selected && selectedEvents && (
                <div className="space-y-2">
                  {/* Tasks */}
                  {selectedEvents.tasks.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tasks</div>
                      {selectedEvents.tasks.map((t) => (
                        <div key={t.id} className={`flex items-start gap-2 p-2 rounded-lg border ${t.status === "done" ? "opacity-50" : ""}`}>
                          <Checkbox
                            checked={t.status === "done"}
                            onCheckedChange={(checked) => toggleTask.mutate({ id: t.id, done: !!checked })}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm font-medium ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>{t.title}</div>
                            {t.description && <div className="text-xs text-muted-foreground truncate">{t.description}</div>}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <div className={`h-2 w-2 rounded-full ${PRIORITY_COLORS[t.priority] ?? PRIORITY_COLORS.medium}`} title={t.priority} />
                            {t.due_at && <span className="text-[10px] text-muted-foreground">{format(new Date(t.due_at), "h:mm a")}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Follow-ups */}
                  {selectedEvents.followups.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Follow-ups</div>
                      {selectedEvents.followups.map((f: any) => (
                        <Link key={f.id} to="/leads/$id" params={{ id: f.lead_id }} className="flex items-center gap-2 p-2 rounded-lg border hover:bg-muted/40 transition-colors">
                          <Bell className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                          <span className="text-sm flex-1 truncate">{f.action}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">{format(new Date(f.due_at), "h:mm a")}</span>
                        </Link>
                      ))}
                    </div>
                  )}

                  {/* Payments */}
                  {selectedEvents.payments.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Payments Due</div>
                      {selectedEvents.payments.map((b: any) => (
                        <div key={b.id} className="flex items-center gap-2 p-2 rounded-lg border">
                          <IndianRupee className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                          <span className="text-sm flex-1 truncate">{b.client_name}</span>
                          <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 text-[10px]">
                            {Number(b.balance_amount || 0).toLocaleString("en-IN")}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Empty state */}
                  {selectedEvents.tasks.length === 0 && selectedEvents.followups.length === 0 && selectedEvents.payments.length === 0 && (
                    <div className="text-center py-6">
                      <Circle className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No events on this day</p>
                      <Button size="sm" variant="link" onClick={() => setAddOpen(true)} className="mt-1">
                        <Plus className="h-3.5 w-3.5 mr-1" /> Add a task
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Legend */}
          <Card>
            <CardContent className="p-3">
              <div className="flex flex-wrap gap-3 text-[11px]">
                <span className="flex items-center gap-1"><Flag className="h-3 w-3 text-violet-600" /> Tasks</span>
                <span className="flex items-center gap-1"><Bell className="h-3 w-3 text-blue-600" /> Follow-ups</span>
                <span className="flex items-center gap-1"><IndianRupee className="h-3 w-3 text-amber-600" /> Payments</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add Task Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Task — {selected ? format(selected, "EEE, MMM d, yyyy") : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Task title *</Label>
              <Input
                autoFocus
                value={taskForm.title}
                onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                placeholder="e.g. Call Sudip regarding proposal"
              />
            </div>
            <div>
              <Label className="text-xs">Description (optional)</Label>
              <Textarea
                rows={2}
                value={taskForm.description}
                onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                placeholder="Add details…"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Priority</Label>
                <Select value={taskForm.priority} onValueChange={(v) => setTaskForm({ ...taskForm, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Time</Label>
                <Input
                  type="time"
                  value={taskForm.due_time}
                  onChange={(e) => setTaskForm({ ...taskForm, due_time: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button disabled={addTask.isPending || !taskForm.title.trim()} onClick={() => addTask.mutate()}>
              {addTask.isPending ? "Saving…" : "Add Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
