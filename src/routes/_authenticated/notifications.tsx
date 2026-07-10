import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, Clock, AlertCircle, IndianRupee, Check, MessageSquare, Mail } from "lucide-react";
import { useMemo, useState } from "react";
import { formatDistanceToNow, isPast } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({ meta: [{ title: "Notifications — EaseMyOffice CRM" }] }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "overdue" | "due" | "payments">("all");
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

  const items = useMemo(() => {
    const list: Array<{
      id: string; key: string; type: "overdue" | "due" | "payment";
      title: string; sub: string; ts: number;
      channels: Array<"whatsapp" | "email">;
      onDone: () => void;
      href?: any; params?: any;
    }> = [];

    followups.forEach((f: any) => {
      const due = new Date(f.due_at);
      const overdue = isPast(due);
      const id = `fu-${f.id}`;
      list.push({
        id, key: f.id, type: overdue ? "overdue" : "due",
        title: f.action,
        sub: `${overdue ? "Overdue" : "Due"} ${formatDistanceToNow(due, { addSuffix: true })}${f.note ? ` · ${f.note}` : ""}`,
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
        title: `Balance ₹${Number(p.balance_amount).toLocaleString("en-IN")} from ${p.client_name}`,
        sub: `${isPast(due) ? "Overdue" : "Due"} ${formatDistanceToNow(due, { addSuffix: true })} · ${p.booking_code}${p.last_reminder_sent_at ? ` · last sent ${formatDistanceToNow(new Date(p.last_reminder_sent_at), { addSuffix: true })}` : ""}`,
        ts: due.getTime(),
        channels,
        onDone: () => markPaid.mutate(p.id),
      });
    });

    return list.filter((i) => !doneIds.has(i.key)).sort((a, b) => a.ts - b.ts);
  }, [followups, payments, doneIds, markDone, markPaid]);

  const filtered = items.filter((i) => filter === "all" || (filter === "payments" ? i.type === "payment" : i.type === filter));
  const counts = {
    all: items.length,
    overdue: items.filter((i) => i.type === "overdue").length,
    due: items.filter((i) => i.type === "due").length,
    payments: items.filter((i) => i.type === "payment").length,
  };

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Notifications</h1>
        <p className="text-sm text-muted-foreground">In-app inbox of WhatsApp & email reminders. Mark done as you action them.</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(["all", "overdue", "due", "payments"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f[0].toUpperCase() + f.slice(1)} <Badge variant="secondary" className="ml-2">{counts[f]}</Badge>
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0 divide-y">
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">All caught up! 🎉</div>
          ) : filtered.map((i) => {
            const Icon = i.type === "overdue" ? AlertCircle : i.type === "payment" ? IndianRupee : Clock;
            const tone = i.type === "overdue" ? "text-rose-600 bg-rose-100 dark:bg-rose-950"
              : i.type === "payment" ? "text-amber-600 bg-amber-100 dark:bg-amber-950"
              : "text-blue-600 bg-blue-100 dark:bg-blue-950";

            const inner = (
              <div className="flex gap-3 p-4 hover:bg-muted/30">
                <div className={`size-9 rounded-full grid place-items-center shrink-0 ${tone}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{i.title}</div>
                  <div className="text-xs text-muted-foreground">{i.sub}</div>
                  <div className="flex gap-1 mt-1">
                    {i.channels.includes("whatsapp") && (
                      <Badge variant="outline" className="text-[10px] gap-1"><MessageSquare className="h-2.5 w-2.5" /> WhatsApp</Badge>
                    )}
                    {i.channels.includes("email") && (
                      <Badge variant="outline" className="text-[10px] gap-1"><Mail className="h-2.5 w-2.5" /> Email</Badge>
                    )}
                  </div>
                </div>
                <Button
                  size="sm" variant="ghost" className="self-center"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); i.onDone(); }}
                >
                  <Check className="h-4 w-4 mr-1" /> Done
                </Button>
              </div>
            );
            return i.href ? (
              <Link key={i.id} to={i.href} params={i.params}>{inner}</Link>
            ) : (
              <div key={i.id}>{inner}</div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
