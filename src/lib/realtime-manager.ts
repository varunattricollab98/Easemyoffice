/**
 * Shared realtime channel manager.
 *
 * Instead of each page opening its own Supabase realtime channel for the same
 * tables, this module maintains a single "crm-shared" channel that listens to
 * all frequently-watched tables (leads, follow_ups, lead_activities, tasks).
 *
 * Pages register/unregister listeners via subscribe/unsubscribe. The channel
 * is created on first subscriber and torn down when no subscribers remain.
 * This reduces WebSocket connections from 3-5 down to 1 for a typical session.
 */
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type TableName = "leads" | "follow_ups" | "lead_activities" | "tasks";

export type RealtimeEvent = {
  table: TableName;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
};

type Listener = (event: RealtimeEvent) => void;

const listeners = new Map<string, { tables: TableName[]; fn: Listener }>();
let channel: RealtimeChannel | null = null;
let refCount = 0;

const ALL_TABLES: TableName[] = ["leads", "follow_ups", "lead_activities", "tasks"];

function ensureChannel() {
  if (channel) return;
  const ch = supabase.channel("crm-shared");
  ALL_TABLES.forEach((table) => {
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      (payload) => {
        const event: RealtimeEvent = {
          table,
          eventType: payload.eventType as RealtimeEvent["eventType"],
          new: (payload.new as Record<string, unknown>) ?? null,
          old: (payload.old as Record<string, unknown>) ?? null,
        };
        // Dispatch to all listeners interested in this table
        listeners.forEach(({ tables, fn }) => {
          if (tables.includes(table)) {
            try { fn(event); } catch { /* listener errors don't crash the channel */ }
          }
        });
      },
    );
  });
  ch.subscribe();
  channel = ch;
}

function teardownChannel() {
  if (!channel) return;
  supabase.removeChannel(channel);
  channel = null;
}

/**
 * Subscribe to realtime events for the given tables.
 * Returns an unsubscribe function — call it in useEffect cleanup.
 *
 * @param id - Unique subscriber ID (e.g. "dashboard", "pipeline")
 * @param tables - Which tables this subscriber cares about
 * @param fn - Callback for each event
 */
export function subscribeRealtime(
  id: string,
  tables: TableName[],
  fn: Listener,
): () => void {
  listeners.set(id, { tables, fn });
  refCount++;
  ensureChannel();

  return () => {
    listeners.delete(id);
    refCount--;
    if (refCount <= 0) {
      refCount = 0;
      // Tear down after a short delay — if the user navigates back quickly,
      // we avoid the reconnect cost.
      setTimeout(() => {
        if (refCount === 0) teardownChannel();
      }, 5_000);
    }
  };
}
