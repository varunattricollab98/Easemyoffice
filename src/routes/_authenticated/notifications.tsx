import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Bell, Clock, AlertCircle, IndianRupee, Check, MessageSquare, Mail,
  User, AlarmClock, ListTodo, Target, Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { formatDistanceToNow, isPast } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({ meta: [{ title: "Notifications — EaseMyOffice CRM" }] }),
  component: NotificationsPage,
});

// Dummy/sample notifications for when there's no data
const DUMMY_NOTIFICATIONS = [
  {
    id: "demo-1",
    type: "assigned" as const,
    title: "New lead assigned: Rajat Tiwari - Virtual Office Bangalore",
    sub: "2 minutes ago",
    ts: Date.now() - 2 * 60_000,
    icon: User,
  },
  {
    id: "demo-2",
    type: "overdue" as const,
    title: "\u26a0\ufe0f Overdue: Follow up with Varun is 3 days overdue",
    sub: "1 hour ago",
    ts: Date.now() - 60 * 60_000,
    icon: AlarmClock,
  },
  {
    id: "demo-3",
    type: "payment" as const,
    title: "\ud83d\udcb0 Payment due: \u20b942,480 from Client ABC (INV-001922)",
    sub: "3 hours ago",
    ts: Date.now() - 3 * 60 * 60_000,
    icon: IndianRupee,
  },
  {
    id: "demo-4",
    type: "task" as const,
    title: "\ud83d\udccb New task: Call Devesh regarding proposal",
    sub: "5 hours ago",
    ts: Date.now() - 5 * 60 * 60_000,
    icon: ListTodo,
  },
  {
    id: "demo-5",
    type: "lead_moved" as const,
    title: "\ud83c\udfaf Lead moved: Sameer moved to Interested stage",
    sub: "yesterday",
    ts: Date.now() - 24 * 60 * 60_000,
    icon: Target,
  },
];

const TYPE_STYLES: Record<string, { border: string; bg: string; text: string }> = {
  assigned: { border: "border-l-blue-500", bg: "bg-blue-100 dark:bg-blue-950", text: "text-blue-600 dark:text-blue-400" },
  overdue: { border: "border-l-red-500", bg: "bg-red-100 dark:bg-red-950", text: "text-red-600 dark:text-red-400" },
  payment: { border: "border-l-amber-500", bg: "bg-amber-100 dark:bg-amber-950", text: "text-amber-600 dark:text-amber-400" },
  due: { border: "border-l-sky-500", bg: "bg-sky-100 dark:bg-sky-950", text: "text-sky-600 dark:text-sky-400" },
  task: { border: "border-l-violet-500", bg: "bg-violet-100 dark:bg-violet-950", text: "text-violet-600 dark:text-violet-400" },
  lead_moved: { border: "border-l-emerald-500", bg: "bg-emerald-100 dark:bg-emerald-950", text: "text-emerald-600 dark:text-emerald-400" },
};

const FILTER_STYLES: Record<string, string> = {
  all: "bg-gradient-to-r from-primary to-violet-600 text-white shadow-lg shadow-primary/25",
  assigned: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  overdue: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800",
  due: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800",
  payments: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
};

function NotificationsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "assigned" | "overdue" | "due" | "payments">("all");
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());

  const { data: followups = [] } = useQuery({
    queryKey: ["notif-followups", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("follow_ups").select("id, action, due_at, status, lead_id, owner_id, note")
        .eq("status", "pending" as never).order("due_at", { ascending: true }).limit(200);
      return data ?? [];
    },
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["notif-payments"],
    queryFn: async () => {
      const { data } = await supabase.from("bookings").select("id, client_name, contact_no, email_id, balance_amount, balance_due_date, booking_code, last_reminder_sent_at")
        .gt("balance_amount", 0).not("balance_due_date", "is", null)
        .order("balance_due_date", { ascending: true }).limit(100);
      return data ?? [];
    },
  });

  const { data: assigned = [] } = useQuery({
    queryKey: ["notif-assigned", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("notifications")
        .select("id, title, body, lead_id, task_id, read, created_at")
        .eq("read", false as never).order("created_at", { ascending: false }).limit(100);
      return data ?? [];
    },
  });

  const markDone = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("follow_ups").update({
        status: "done" as never, completed_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, id) => {
      setDoneIds((prev) => new Set(prev).add(id));
      qc.invalidateQueries({ queryKey: ["notif-followups"] });
      toast.success("Marked done");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const markPaid = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("bookings").update({
        balance_paid_at: new Date().toISOString(), balance_amount: 0,
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, id) => {
      setDoneIds((prev) => new Set(prev).add(id));
      qc.invalidateQueries({ queryKey: ["notif-payments"] });
      toast.success("Marked paid");
    },
  });

  const markNotifRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notifications").update({ read: true as never }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, id) => {
      setDoneIds((prev) => new Set(prev).add(`nt-${id}`));
      qc.invalidateQueries({ queryKey: ["notif-assigned"] });
      qc.invalidateQueries({ queryKey: ["notif-unread-count"] });
      toast.success("Marked read");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const items = useMemo(() => {
    const list: Array<{
      id: string; key: string; type: "overdue" | "due" | "payment" | "assigned";
      title: string; sub: string; ts: number;
      channels: Array<"whatsapp" | "email">;
      onDone: () => void;
      href?: any; params?: any;
    }> = [];

    assigned.forEach((n: any) => {
      list.push({
        id: `nt-${n.id}`, key: `nt-${n.id}`, type: "assigned",
        title: n.title,
        sub: formatDistanceToNow(new Date(n.created_at), { addSuffix: true }),
        ts: new Date(n.created_at).getTime(),
        channels: [],
        onDone: () => markNotifRead.mutate(n.id),
        href: n.lead_id ? "/leads/$id" : n.task_id ? "/tasks" : undefined,
        params: n.lead_id ? { id: n.lead_id } : undefined,
      });
    });

    followups.forEach((f: any) => {
      const due = new Date(f.due_at);
      const overdue = isPast(due);
      const id = `fu-${f.id}`;
      list.push({
        id, key: f.id, type: overdue ? "overdue" : "due",
        title: f.action,
        sub: `${overdue ? "Overdue" : "Due"} ${formatDistanceToNow(due, { addSuffix: true })}${f.note ? ` - ${f.note}` : ""}`,
        ts: due.getTime(),
        channels: ["whatsapp"],
        onDone: () => markDone.mutate(f.id),
        href: "/leads/$id", params: { id: f.lead_id },
      });
    });

    payments.forEach((p: any) => {
      const due = new Date(p.balance_due_date);
      const id = `pay-${p.id}`;
      const channels: Array<"whatsapp" | "email"> = [];
      if (p.contact_no) channels.push("whatsapp");
      if (p.email_id) channels.push("email");
      list.push({
        id, key: p.id, type: "payment",
        title: `Balance \u20b9${Number(p.balance_amount).toLocaleString("en-IN")} from ${p.client_name}`,
        sub: `${isPast(due) ? "Overdue" : "Due"} ${formatDistanceToNow(due, { addSuffix: true })} - ${p.booking_code}${p.last_reminder_sent_at ? ` - last sent ${formatDistanceToNow(new Date(p.last_reminder_sent_at), { addSuffix: true })}` : ""}`,
        ts: due.getTime(),
        channels,
        onDone: () => markPaid.mutate(p.id),
      });
    });

    return list.filter((i) => !doneIds.has(i.key)).sort((a, b) => {
      if (a.type === "assigned" && b.type === "assigned") return b.ts - a.ts;
      if (a.type === "assigned") return -1;
      if (b.type === "assigned") return 1;
      return a.ts - b.ts;
    });
  }, [followups, payments, assigned, doneIds, markDone, markPaid, markNotifRead]);

  const filtered = items.filter((i) => filter === "all" || (filter === "payments" ? i.type === "payment" : i.type === filter));
  const counts = {
    all: items.length,
    assigned: items.filter((i) => i.type === "assigned").length,
    overdue: items.filter((i) => i.type === "overdue").length,
    due: items.filter((i) => i.type === "due").length,
    payments: items.filter((i) => i.type === "payment").length,
  };

  // Show dummy notifications when there are no real ones
  const showDummy = items.length === 0;

  return (
    <div className="p-5 md:p-10 max-w-3xl mx-auto space-y-6">
      {/* Premium Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight bg-gradient-to-r from-primary via-primary/80 to-violet-600 bg-clip-text text-transparent flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-primary to-violet-600 grid place-items-center shadow-lg shadow-primary/20">
              <Bell className="h-5 w-5 text-white" />
            </div>
            Notifications
          </h1>
          <p className="text-sm text-muted-foreground/70 ml-[52px]">
            Your action centre - follow-ups, payments & lead alerts
          </p>
        </div>
        {!showDummy && (
          <Badge variant="secondary" className="text-xs rounded-full px-3 py-1 bg-primary/10 text-primary font-medium">
            {items.length} pending
          </Badge>
        )}
      </div>

      {/* Filter Pills */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "assigned", "overdue", "due", "payments"] as const).map((f) => {
          const isActive = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`
                inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium
                border transition-all duration-300 ease-out
                hover:scale-[1.03] active:scale-[0.97]
                ${isActive ? FILTER_STYLES[f] + " border-transparent" : "border-border/50 hover:border-border hover:bg-muted/50 text-muted-foreground"}
              `}
            >
              {f[0].toUpperCase() + f.slice(1)}
              <span className={`
                inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold
                ${isActive ? "bg-white/25 text-inherit" : "bg-muted text-muted-foreground"}
              `}>
                {counts[f]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Notification Cards */}
      {showDummy ? (
        <div className="space-y-3">
          {/* Demo badge */}
          <div className="flex items-center gap-2 mb-2">
            <Badge className="rounded-full bg-gradient-to-r from-violet-500 to-pink-500 text-white border-0 text-[10px] px-2.5 py-0.5 uppercase tracking-wider font-semibold">
              <Sparkles className="h-3 w-3 mr-1" /> Sample
            </Badge>
            <span className="text-xs text-muted-foreground">These are sample notifications for preview</span>
          </div>

          {DUMMY_NOTIFICATIONS.map((n) => {
            const style = TYPE_STYLES[n.type] || TYPE_STYLES.assigned;
            const Icon = n.icon;
            return (
              <div
                key={n.id}
                className={`
                  relative rounded-xl border border-border/40 border-l-4 ${style.border}
                  bg-card/80 backdrop-blur-sm p-4 transition-all duration-300 ease-out
                  hover:shadow-md hover:scale-[1.01] group
                `}
              >
                <div className="flex gap-3 items-start">
                  <div className={`size-9 rounded-full grid place-items-center shrink-0 ${style.bg} ${style.text} shadow-sm`}>
                    <Icon className={`h-4 w-4 ${n.type === "overdue" ? "animate-pulse" : ""}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm leading-snug">{n.title}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-[9px] rounded-full px-1.5 py-0 border-violet-300 text-violet-600 dark:border-violet-700 dark:text-violet-400">
                        SAMPLE
                      </Badge>
                    </div>
                  </div>
                  <span className="text-[11px] text-muted-foreground/60 shrink-0 whitespace-nowrap">{n.sub}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : filtered.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-16 w-16 rounded-3xl bg-gradient-to-br from-emerald-400 to-teal-600 grid place-items-center shadow-xl shadow-emerald-500/20 mb-4">
            <Check className="h-8 w-8 text-white" />
          </div>
          <h3 className="text-lg font-semibold mt-2">All caught up!</h3>
          <p className="text-sm text-muted-foreground/70 max-w-xs mt-1">
            No pending {filter !== "all" ? filter : ""} notifications. Keep up the great work! 🎉
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((i) => {
            const style = TYPE_STYLES[i.type] || TYPE_STYLES.assigned;
            const Icon = i.type === "overdue" ? AlarmClock : i.type === "payment" ? IndianRupee : i.type === "assigned" ? User : Clock;

            const inner = (
              <div
                className={`
                  relative rounded-xl border border-border/40 border-l-4 ${style.border}
                  bg-card/80 backdrop-blur-sm p-4 transition-all duration-300 ease-out
                  hover:shadow-md hover:scale-[1.01] group
                `}
              >
                <div className="flex gap-3 items-start">
                  <div className={`size-9 rounded-full grid place-items-center shrink-0 ${style.bg} ${style.text} shadow-sm`}>
                    <Icon className={`h-4 w-4 ${i.type === "overdue" ? "animate-pulse" : ""}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm leading-snug">{i.title}</div>
                    <div className="text-[11px] text-muted-foreground/60 mt-0.5">{i.sub}</div>
                    {i.channels.length > 0 && (
                      <div className="flex gap-1.5 mt-1.5">
                        {i.channels.includes("whatsapp") && (
                          <Badge variant="outline" className="text-[10px] gap-1 rounded-full px-2 py-0 border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400">
                            <MessageSquare className="h-2.5 w-2.5" /> WhatsApp
                          </Badge>
                        )}
                        {i.channels.includes("email") && (
                          <Badge variant="outline" className="text-[10px] gap-1 rounded-full px-2 py-0 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400">
                            <Mail className="h-2.5 w-2.5" /> Email
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-muted-foreground/50 hidden sm:block">
                      {formatDistanceToNow(new Date(i.ts), { addSuffix: true })}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-emerald-100 hover:text-emerald-700 dark:hover:bg-emerald-950 dark:hover:text-emerald-400"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); i.onDone(); }}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            );

            return i.href ? (
              <Link key={i.id} to={i.href} params={i.params}>{inner}</Link>
            ) : (
              <div key={i.id}>{inner}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
