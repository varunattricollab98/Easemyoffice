import { supabase } from "@/integrations/supabase/client";

// Team-accountability audit logger. Records WHO did WHAT across leads/bookings
// into the audit_log table (see setup/ADD_AUDIT_LOG.sql). This is deliberately
// BEST-EFFORT and NON-BLOCKING: it never throws and is not awaited by callers,
// so a logging failure (RLS, offline, table missing) can never break or slow
// the actual create/edit/delete the user performed.

export type AuditAction = "create" | "edit" | "delete" | "stage_change" | "assign";
export type AuditEntity = "lead" | "booking";

export function logAudit(input: {
  actorId: string | null | undefined;
  action: AuditAction;
  entity: AuditEntity;
  entityId?: string | null;
  entityLabel?: string | null;
  detail?: string | null;
  meta?: Record<string, unknown>;
}): void {
  // Fire-and-forget. We intentionally do not return the promise.
  void (async () => {
    try {
      if (!input.actorId) return; // RLS requires actor_id = auth.uid()
      await supabase.from("audit_log").insert({
        actor_id: input.actorId,
        action: input.action,
        entity_type: input.entity,
        entity_id: input.entityId ?? null,
        entity_label: input.entityLabel ?? null,
        detail: input.detail ?? null,
        meta: (input.meta ?? {}) as never,
      });
    } catch {
      /* best-effort: never surface audit failures to the user */
    }
  })();
}
