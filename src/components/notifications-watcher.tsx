import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

// Repeating reminder cadence per task priority (minutes).
const REMINDER_MINUTES: Record<string, number> = {
  high: 30, // "urgent" — every 30 min
  medium: 60, // normal — hourly
  low: 1440, // daily
};

/**
 * App-wide watcher (mounted once for logged-in users). It:
 *  - shows an instant toast when a new notification arrives (Supabase Realtime),
 *  - keeps the sidebar unread badge fresh,
 *  - shows repeating reminder toasts for the user's open tasks by priority.
 */
export function NotificationsWatcher() {
  const { user } = useAuth();
  const qc = useQueryClient();

  // Real-time notifications -> toast + refresh badge/list.
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`notif-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const n = payload.new as { title?: string; body?: string };
          toast(n.title ?? "New notification", { description: n.body ?? undefined });
          qc.invalidateQueries({ queryKey: ["notif-unread-count"] });
          qc.invalidateQueries({ queryKey: ["notif-assigned"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, qc]);

  // Repeating task reminders based on priority.
  useEffect(() => {
    if (!user?.id) return;
    let stopped = false;

    const check = async () => {
      const { data } = await supabase
        .from("tasks")
        .select("id, title, priority, due_at, status, last_reminded_at, owner_id")
        .eq("owner_id", user.id)
        .neq("status", "done" as never);
      if (stopped || !data) return;
      const now = Date.now();
      for (const t of data as any[]) {
        const intervalMs = (REMINDER_MINUTES[t.priority] ?? 60) * 60_000;
        const last = t.last_reminded_at ? new Date(t.last_reminded_at).getTime() : 0;
        if (now - last >= intervalMs) {
          toast(`Task reminder: ${t.title}`, {
            description:
              `Priority: ${t.priority}` +
              (t.due_at ? ` · due ${new Date(t.due_at).toLocaleString()}` : ""),
          });
          await supabase
            .from("tasks")
            .update({ last_reminded_at: new Date().toISOString() as never })
            .eq("id", t.id);
        }
      }
    };

    check();
    const iv = setInterval(check, 60_000); // re-check every minute
    return () => {
      stopped = true;
      clearInterval(iv);
    };
  }, [user?.id]);

  return null;
}
