import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { showBrowserNotification } from "@/lib/browser-notify";

// Repeating reminder cadence per task priority (minutes).
const REMINDER_MINUTES: Record<string, number> = {
  high: 30, // "urgent" - every 30 min
  medium: 60, // normal - hourly
  low: 1440, // daily
};

const TYPE_EMOJI: Record<string, string> = {
  lead_assigned: "\ud83d\udc64",
  follow_up: "\u23f0",
  payment: "\ud83d\udcb0",
  task: "\ud83d\udccb",
  lead_moved: "\ud83c\udfaf",
  general: "\ud83d\udd14",
};

/**
 * App-wide watcher (mounted once for logged-in users). It:
 *  - shows an instant popup toast when a new notification arrives (Supabase Realtime),
 *  - keeps the sidebar unread badge fresh,
 *  - shows repeating reminder toasts for the user's open tasks by priority,
 *  - fires a periodic poll to catch any missed realtime events.
 */
export function NotificationsWatcher() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const lastNotifTs = useRef<number>(Date.now());

  // Real-time notifications -> toast + refresh badge/list.
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`notif-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const n = payload.new as {
            title?: string;
            body?: string;
            type?: string;
            id?: string;
            lead_id?: string | null;
          };
          const emoji = TYPE_EMOJI[n.type || "general"] || "\ud83d\udd14";
          toast(`${emoji} ${n.title ?? "New notification"}`, {
            description: n.body ?? undefined,
            duration: 6000,
            position: "top-right",
          });
          // Same event as an OS notification, for when the CRM is in a background
          // tab. showBrowserNotification suppresses itself while the tab is
          // visible, so this never doubles up with the toast above.
          showBrowserNotification({
            title: `${emoji} ${n.title ?? "New notification"}`,
            body: n.body ?? undefined,
            tag: n.id ? `notif-${n.id}` : undefined,
            url: n.lead_id ? `/leads/${n.lead_id}` : "/notifications",
          });
          lastNotifTs.current = Date.now();
          qc.invalidateQueries({ queryKey: ["notif-unread-count"] });
          qc.invalidateQueries({ queryKey: ["notif-assigned"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, qc]);

  // Follow-up realtime channel - show popup when a follow-up becomes overdue
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`followup-watch-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "follow_ups", filter: `owner_id=eq.${user.id}` },
        (payload) => {
          const f = payload.new as { action?: string; id?: string; lead_id?: string | null };
          toast(`\u23f0 New follow-up: ${f.action ?? "Follow up"}`, {
            duration: 5000,
            position: "top-right",
          });
          showBrowserNotification({
            title: `\u23f0 New follow-up: ${f.action ?? "Follow up"}`,
            tag: f.id ? `followup-${f.id}` : undefined,
            url: f.lead_id ? `/leads/${f.lead_id}` : "/follow-ups",
          });
          qc.invalidateQueries({ queryKey: ["notif-followups"] });
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
          const emoji = t.priority === "high" || t.priority === "urgent" ? "\ud83d\udea8" : "\ud83d\udccb";
          const detail =
            `Priority: ${t.priority}` +
            (t.due_at ? ` \u00b7 due ${new Date(t.due_at).toLocaleString()}` : "");
          toast(`${emoji} Task reminder: ${t.title}`, {
            description: detail,
            duration: 5000,
            position: "top-right",
          });
          // The pending-task nag is the main reason a rep wants desktop alerts,
          // so it is tagged per task: the OS replaces the previous reminder for
          // that task instead of stacking one every cadence.
          showBrowserNotification({
            title: `${emoji} Task pending: ${t.title}`,
            body: detail,
            tag: `task-${t.id}`,
            url: "/tasks",
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

  // Periodic poll to catch missed realtime events (every 30 seconds)
  useEffect(() => {
    if (!user?.id) return;
    const iv = setInterval(async () => {
      const since = new Date(lastNotifTs.current).toISOString();
      const { data } = await supabase
        .from("notifications")
        .select("id, title, body, type")
        .eq("user_id", user.id)
        .eq("read", false as never)
        .gt("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5);
      if (data && data.length > 0) {
        lastNotifTs.current = Date.now();
        for (const n of data as any[]) {
          const emoji = TYPE_EMOJI[n.type || "general"] || "\ud83d\udd14";
          toast(`${emoji} ${n.title ?? "New notification"}`, {
            description: n.body ?? undefined,
            duration: 5000,
            position: "top-right",
          });
          // Tagged by row id so a notification the realtime channel already
          // popped is not popped again by this catch-up poll.
          showBrowserNotification({
            title: `${emoji} ${n.title ?? "New notification"}`,
            body: n.body ?? undefined,
            tag: `notif-${n.id}`,
            url: "/notifications",
          });
        }
        qc.invalidateQueries({ queryKey: ["notif-unread-count"] });
        qc.invalidateQueries({ queryKey: ["notif-assigned"] });
      }
    }, 30_000);
    return () => clearInterval(iv);
  }, [user?.id, qc]);

  return null;
}
