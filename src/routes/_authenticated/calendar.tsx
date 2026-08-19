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
  Flag, CheckCircle2, Circle, Clock, Video, Users, Sparkles,
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
  const [addType, setAddType] = useState<"task" | "meeting">("task");
  const [taskForm, setTaskForm] = useState({ title: "", description: "", priority: "medium", due_time: "09:00" });
  const [meetingForm, setMeetingForm] = useState({ title: "", description: "", time: "10:00", duration: "30" });

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

  // Add meeting mutation (creates a task with type info in description)
  const addMeeting = useMutation({
    mutationFn: async () => {
      if (!meetingForm.title.trim()) throw new Error("Meeting title is required");
      if (!selected) throw new Error("Select a date first");
      const dueAt = new Date(`${format(selected, "yyyy-MM-dd")}T${meetingForm.time || "10:00"}:00`);
      const desc = `[Meeting] Duration: ${meetingForm.duration} min${meetingForm.description ? `\n${meetingForm.description}` : ""}`;
      const { error } = await supabase.from("tasks").insert({
        title: `Meeting: ${meetingForm.title.trim()}`,
        description: desc,
        priority: "high" as never,
        due_at: dueAt.toISOString(),
        owner_id: user?.id ?? null,
        created_by: user?.id ?? null,
        status: "todo" as never,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Meeting scheduled");
      setMeetingForm({ title: "", description: "", time: "10:00", duration: "30" });
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

  // Check if a task is a meeting (by title prefix or description marker)
  const isMeeting = (t: Task) => t.title.startsWith("Meeting:") || (t.description?.startsWith("[Meeting]") ?? false);

  return (
    <div className="p-5 md:p-10 max-w-7xl mx-auto space-y-6">
      {/* Premium Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight bg-gradient-to-r from-primary via-primary/80 to-violet-600 bg-clip-text text-transparent flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-primary to-violet-600 grid place-items-center shadow-lg shadow-primary/20">
              <CalendarDays className="h-5 w-5 text-white" />
            </div>
            {format(cursor, "MMMM yyyy")}
          </h1>
          <p className="text-sm text-muted-foreground/80 ml-[52px]">Tasks, follow-ups, meetings, and payment dues at a glance</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setCursor(subMonths(cursor, 1))}
            className="h-9 w-9 rounded-xl hover:bg-accent/60 transition-all duration-300 ease-out hover:scale-105"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setCursor(new Date()); setSelected(new Date()); }}
            className="rounded-xl px-4 font-medium transition-all duration-300 ease-out hover:scale-105 hover:shadow-md border-primary/20 hover:border-primary/40"
          >
            Today
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setCursor(addMonths(cursor, 1))}
            className="h-9 w-9 rounded-xl hover:bg-accent/60 transition-all duration-300 ease-out hover:scale-105"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        {/* Calendar Grid */}
        <Card className="overflow-hidden shadow-lg rounded-2xl border-0 bg-card/80 backdrop-blur-sm">
          <CardContent className="p-0">
            {/* Day headers */}
            <div className="grid grid-cols-7 bg-gradient-to-r from-muted/60 via-muted/40 to-muted/60 border-b">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="py-3 text-center text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-widest">{d}</div>
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
                const hasMeetings = ev.tasks.some((t) => isMeeting(t) && t.status !== "done");
                return (
                  <button
                    key={k}
                    onClick={() => setSelected(d)}
                    className={`relative min-h-[92px] p-2 border-b border-r border-border/40 text-left transition-all duration-300 ease-out group ${
                      !inMonth ? "bg-muted/5 text-muted-foreground/30" : "hover:bg-accent/30"
                    } ${sel ? "bg-primary/8 scale-[1.02] z-10 shadow-md rounded-lg" : ""}`}
                  >
                    {/* Date number */}
                    <div className={`text-sm font-medium inline-flex items-center justify-center rounded-full w-7 h-7 transition-all duration-300 ${
                      today && sel ? "bg-gradient-to-br from-primary to-violet-600 text-white shadow-lg shadow-primary/30 scale-110" :
                      today ? "bg-gradient-to-br from-primary to-violet-600 text-white shadow-md shadow-primary/20" :
                      sel ? "bg-primary/15 text-primary font-bold" : ""
                    }`}>
                      {format(d, "d")}
                    </div>

                    {/* Event dots - modern colored indicators */}
                    <div className="flex items-center gap-1 mt-2 flex-wrap">
                      {taskCount > 0 && (
                        <div className="flex items-center gap-0.5">
                          {Array.from({ length: Math.min(taskCount, 3) }).map((_, i) => (
                            <div key={`t${i}`} className="h-1.5 w-1.5 rounded-full bg-violet-500 dark:bg-violet-400 transition-all duration-300 group-hover:scale-125" />
                          ))}
                          {taskCount > 3 && <span className="text-[9px] text-violet-500 font-medium ml-0.5">+{taskCount - 3}</span>}
                        </div>
                      )}
                      {fuCount > 0 && (
                        <div className="flex items-center gap-0.5">
                          {Array.from({ length: Math.min(fuCount, 3) }).map((_, i) => (
                            <div key={`f${i}`} className="h-1.5 w-1.5 rounded-full bg-blue-500 dark:bg-blue-400 transition-all duration-300 group-hover:scale-125" />
                          ))}
                          {fuCount > 3 && <span className="text-[9px] text-blue-500 font-medium ml-0.5">+{fuCount - 3}</span>}
                        </div>
                      )}
                      {payCount > 0 && (
                        <div className="flex items-center gap-0.5">
                          {Array.from({ length: Math.min(payCount, 2) }).map((_, i) => (
                            <div key={`p${i}`} className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-400 transition-all duration-300 group-hover:scale-125" />
                          ))}
                          {payCount > 2 && <span className="text-[9px] text-amber-500 font-medium ml-0.5">+{payCount - 2}</span>}
                        </div>
                      )}
                      {hasMeetings && (
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 ring-2 ring-emerald-500/20 transition-all duration-300 group-hover:scale-125" />
                      )}
                    </div>

                    {/* Quick add button on hover */}
                    {inMonth && (
                      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-all duration-300 transform group-hover:scale-100 scale-75">
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelected(d); setAddType("task"); setAddOpen(true); }}
                          className="h-6 w-6 rounded-full bg-gradient-to-br from-primary to-violet-600 text-white grid place-items-center shadow-lg shadow-primary/30 hover:scale-110 transition-all duration-200"
                          title="Add event"
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
        <div className="space-y-4">
          <Card className="shadow-lg rounded-2xl border-0 bg-card/80 backdrop-blur-sm overflow-hidden">
            <CardContent className="p-0">
              {/* Day header */}
              <div className="px-5 pt-5 pb-4 bg-gradient-to-r from-primary/5 via-violet-500/5 to-transparent border-b border-border/30">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-lg font-bold tracking-tight">
                      {selected ? format(selected, "EEEE") : "Select a day"}
                    </div>
                    {selected && (
                      <div className="text-sm text-muted-foreground/70 font-medium">{format(selected, "MMMM d, yyyy")}</div>
                    )}
                  </div>
                  {selected && (
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setAddType("meeting"); setAddOpen(true); }}
                        className="rounded-xl text-xs h-8 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950 transition-all duration-300 hover:scale-105 hover:shadow-md"
                      >
                        <Video className="h-3 w-3 mr-1" /> Meeting
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => { setAddType("task"); setAddOpen(true); }}
                        className="rounded-xl text-xs h-8 bg-gradient-to-r from-primary to-violet-600 hover:from-primary/90 hover:to-violet-600/90 text-white shadow-md shadow-primary/20 transition-all duration-300 hover:scale-105 hover:shadow-lg"
                      >
                        <Plus className="h-3 w-3 mr-1" /> Task
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Events list */}
              <div className="p-4 space-y-4 max-h-[520px] overflow-y-auto">
                {selected && selectedEvents && (
                  <>
                    {/* Meetings */}
                    {selectedEvents.tasks.filter((t) => isMeeting(t)).length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                          <Users className="h-3 w-3" /> Meetings
                        </div>
                        {selectedEvents.tasks.filter((t) => isMeeting(t)).map((t) => (
                          <div key={t.id} className={`flex items-start gap-3 p-3 rounded-xl border-l-[3px] border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20 hover:shadow-md transition-all duration-300 ease-out hover:translate-x-0.5 ${t.status === "done" ? "opacity-50" : ""}`}>
                            <Checkbox
                              checked={t.status === "done"}
                              onCheckedChange={(checked) => toggleTask.mutate({ id: t.id, done: !!checked })}
                              className="mt-0.5"
                            />
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm font-semibold ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                                {t.title.replace("Meeting: ", "")}
                              </div>
                              {t.description && (
                                <div className="text-xs text-muted-foreground/70 mt-0.5 truncate">
                                  {t.description.replace("[Meeting] ", "").split("\n")[0]}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <Video className="h-3 w-3 text-emerald-500" />
                              {t.due_at && <span className="text-[10px] text-muted-foreground font-medium">{format(new Date(t.due_at), "h:mm a")}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Tasks (non-meetings) */}
                    {selectedEvents.tasks.filter((t) => !isMeeting(t)).length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[11px] font-bold uppercase tracking-widest text-violet-600 dark:text-violet-400 flex items-center gap-1.5">
                          <Flag className="h-3 w-3" /> Tasks
                        </div>
                        {selectedEvents.tasks.filter((t) => !isMeeting(t)).map((t) => (
                          <div key={t.id} className={`flex items-start gap-3 p-3 rounded-xl border-l-[3px] border-l-violet-500 bg-violet-50/30 dark:bg-violet-950/20 hover:shadow-md transition-all duration-300 ease-out hover:translate-x-0.5 ${t.status === "done" ? "opacity-50" : ""}`}>
                            <Checkbox
                              checked={t.status === "done"}
                              onCheckedChange={(checked) => toggleTask.mutate({ id: t.id, done: !!checked })}
                              className="mt-0.5"
                            />
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm font-semibold ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>{t.title}</div>
                              {t.description && <div className="text-xs text-muted-foreground/70 mt-0.5 truncate">{t.description}</div>}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <div className={`h-2.5 w-2.5 rounded-full ${PRIORITY_COLORS[t.priority] ?? PRIORITY_COLORS.medium} ring-2 ring-offset-1 ring-offset-background ${t.priority === "urgent" ? "ring-rose-300 dark:ring-rose-700" : t.priority === "high" ? "ring-amber-300 dark:ring-amber-700" : "ring-transparent"}`} title={t.priority} />
                              {t.due_at && <span className="text-[10px] text-muted-foreground font-medium">{format(new Date(t.due_at), "h:mm a")}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Follow-ups */}
                    {selectedEvents.followups.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[11px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                          <Bell className="h-3 w-3" /> Follow-ups
                        </div>
                        {selectedEvents.followups.map((f: any) => (
                          <Link
                            key={f.id}
                            to="/leads/$id"
                            params={{ id: f.lead_id }}
                            className="flex items-center gap-3 p-3 rounded-xl border-l-[3px] border-l-blue-500 bg-blue-50/30 dark:bg-blue-950/20 hover:shadow-md hover:translate-x-0.5 transition-all duration-300 ease-out"
                          >
                            <Bell className="h-4 w-4 text-blue-500 shrink-0" />
                            <span className="text-sm flex-1 truncate font-medium">{f.action}</span>
                            <span className="text-[10px] text-muted-foreground font-medium shrink-0">{format(new Date(f.due_at), "h:mm a")}</span>
                          </Link>
                        ))}
                      </div>
                    )}

                    {/* Payments */}
                    {selectedEvents.payments.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                          <IndianRupee className="h-3 w-3" /> Payments Due
                        </div>
                        {selectedEvents.payments.map((b: any) => (
                          <div key={b.id} className="flex items-center gap-3 p-3 rounded-xl border-l-[3px] border-l-amber-500 bg-amber-50/30 dark:bg-amber-950/20 hover:shadow-md hover:translate-x-0.5 transition-all duration-300 ease-out">
                            <IndianRupee className="h-4 w-4 text-amber-500 shrink-0" />
                            <span className="text-sm flex-1 truncate font-medium">{b.client_name}</span>
                            <Badge className="rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200 text-[10px] font-bold px-2.5 shadow-sm">
                              {Number(b.balance_amount || 0).toLocaleString("en-IN")}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Empty state */}
                    {selectedEvents.tasks.length === 0 && selectedEvents.followups.length === 0 && selectedEvents.payments.length === 0 && (
                      <div className="text-center py-10">
                        <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-muted/50 to-muted/30 grid place-items-center mx-auto mb-4">
                          <Sparkles className="h-7 w-7 text-muted-foreground/40" />
                        </div>
                        <p className="text-sm font-medium text-muted-foreground/60">Nothing scheduled</p>
                        <p className="text-xs text-muted-foreground/40 mt-1">Add a task or meeting to get started</p>
                        <div className="flex items-center justify-center gap-2 mt-4">
                          <Button size="sm" variant="outline" onClick={() => { setAddType("meeting"); setAddOpen(true); }} className="rounded-xl text-xs transition-all duration-300 hover:scale-105">
                            <Video className="h-3 w-3 mr-1" /> Meeting
                          </Button>
                          <Button size="sm" onClick={() => { setAddType("task"); setAddOpen(true); }} className="rounded-xl text-xs bg-gradient-to-r from-primary to-violet-600 text-white transition-all duration-300 hover:scale-105">
                            <Plus className="h-3 w-3 mr-1" /> Task
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Legend */}
          <Card className="shadow-md rounded-2xl border-0 bg-card/80 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <span className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-violet-500 ring-2 ring-violet-500/20" /> Tasks
                </span>
                <span className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-blue-500 ring-2 ring-blue-500/20" /> Follow-ups
                </span>
                <span className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-amber-500/20" /> Payments
                </span>
                <span className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20" /> Meetings
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add Task / Meeting Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {addType === "meeting" ? (
                <>
                  <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 grid place-items-center shadow-md">
                    <Video className="h-4 w-4 text-white" />
                  </div>
                  <span>Schedule Meeting</span>
                </>
              ) : (
                <>
                  <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-primary to-violet-600 grid place-items-center shadow-md">
                    <Flag className="h-4 w-4 text-white" />
                  </div>
                  <span>Add Task</span>
                </>
              )}
              <span className="ml-auto text-sm font-normal text-muted-foreground">
                {selected ? format(selected, "MMM d, yyyy") : ""}
              </span>
            </DialogTitle>
          </DialogHeader>

          {/* Type toggle */}
          <div className="flex p-1 bg-muted/50 rounded-xl gap-1">
            <button
              onClick={() => setAddType("task")}
              className={`flex-1 text-sm font-medium py-2 rounded-lg transition-all duration-300 ${addType === "task" ? "bg-white dark:bg-card shadow-md text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Flag className="h-3.5 w-3.5 inline mr-1.5" />Task
            </button>
            <button
              onClick={() => setAddType("meeting")}
              className={`flex-1 text-sm font-medium py-2 rounded-lg transition-all duration-300 ${addType === "meeting" ? "bg-white dark:bg-card shadow-md text-emerald-600" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Video className="h-3.5 w-3.5 inline mr-1.5" />Meeting
            </button>
          </div>

          {addType === "task" ? (
            <div className="space-y-3">
              <div>
                <Label className="text-xs font-medium">Task title *</Label>
                <Input
                  autoFocus
                  value={taskForm.title}
                  onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                  placeholder="e.g. Call Sudip regarding proposal"
                  className="mt-1.5 rounded-xl focus:ring-2 ring-primary/20 transition-all duration-200"
                />
              </div>
              <div>
                <Label className="text-xs font-medium">Description (optional)</Label>
                <Textarea
                  rows={2}
                  value={taskForm.description}
                  onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                  placeholder="Add details..."
                  className="mt-1.5 rounded-xl focus:ring-2 ring-primary/20 transition-all duration-200"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-medium">Priority</Label>
                  <Select value={taskForm.priority} onValueChange={(v) => setTaskForm({ ...taskForm, priority: v })}>
                    <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-medium">Time</Label>
                  <Input
                    type="time"
                    value={taskForm.due_time}
                    onChange={(e) => setTaskForm({ ...taskForm, due_time: e.target.value })}
                    className="mt-1.5 rounded-xl"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label className="text-xs font-medium">Meeting title *</Label>
                <Input
                  autoFocus
                  value={meetingForm.title}
                  onChange={(e) => setMeetingForm({ ...meetingForm, title: e.target.value })}
                  placeholder="e.g. Client demo with Acme Corp"
                  className="mt-1.5 rounded-xl focus:ring-2 ring-emerald-500/20 transition-all duration-200"
                />
              </div>
              <div>
                <Label className="text-xs font-medium">Notes (optional)</Label>
                <Textarea
                  rows={2}
                  value={meetingForm.description}
                  onChange={(e) => setMeetingForm({ ...meetingForm, description: e.target.value })}
                  placeholder="Agenda, attendees, meeting link..."
                  className="mt-1.5 rounded-xl focus:ring-2 ring-emerald-500/20 transition-all duration-200"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-medium">Time</Label>
                  <Input
                    type="time"
                    value={meetingForm.time}
                    onChange={(e) => setMeetingForm({ ...meetingForm, time: e.target.value })}
                    className="mt-1.5 rounded-xl"
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium">Duration</Label>
                  <Select value={meetingForm.duration} onValueChange={(v) => setMeetingForm({ ...meetingForm, duration: v })}>
                    <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 min</SelectItem>
                      <SelectItem value="30">30 min</SelectItem>
                      <SelectItem value="45">45 min</SelectItem>
                      <SelectItem value="60">1 hour</SelectItem>
                      <SelectItem value="90">1.5 hours</SelectItem>
                      <SelectItem value="120">2 hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setAddOpen(false)} className="rounded-xl">Cancel</Button>
            {addType === "task" ? (
              <Button
                disabled={addTask.isPending || !taskForm.title.trim()}
                onClick={() => addTask.mutate()}
                className="rounded-xl bg-gradient-to-r from-primary to-violet-600 text-white shadow-md hover:shadow-lg transition-all duration-300"
              >
                {addTask.isPending ? "Saving..." : "Add Task"}
              </Button>
            ) : (
              <Button
                disabled={addMeeting.isPending || !meetingForm.title.trim()}
                onClick={() => addMeeting.mutate()}
                className="rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-md hover:shadow-lg transition-all duration-300"
              >
                {addMeeting.isPending ? "Saving..." : "Schedule Meeting"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
