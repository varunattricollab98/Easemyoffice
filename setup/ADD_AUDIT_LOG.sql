-- =============================================================================
-- ADD_AUDIT_LOG.sql
-- Team-accountability activity log. A single, entity-agnostic audit trail that
-- records WHO did WHAT and WHEN across leads and bookings — stage changes,
-- assignment changes, record create/edit/delete.
--
-- Unlike lead_activities (a per-lead customer timeline that CASCADE-deletes with
-- the lead), this table has NO foreign key to the entity, so a "deleted" event
-- survives after the lead/booking is gone. It is admin-read-only.
-- Run ONCE in Supabase -> SQL Editor. Safe to re-run (IF NOT EXISTS).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- who did it
  action       TEXT NOT NULL,        -- e.g. 'stage_change' | 'assign' | 'delete' | 'create' | 'edit'
  entity_type  TEXT NOT NULL,        -- 'lead' | 'booking'
  entity_id    UUID,                 -- id of the affected record (may be gone now)
  entity_label TEXT,                 -- human label captured at the time (client name / code)
  detail       TEXT,                 -- short human description ("New Lead -> Contacted")
  meta         JSONB NOT NULL DEFAULT '{}'::jsonb, -- before/after or extra context
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_created_idx ON public.audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx   ON public.audit_log(actor_id);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx  ON public.audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_action_idx  ON public.audit_log(action);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Any authenticated user may INSERT their own action (actor_id must be them).
DROP POLICY IF EXISTS "audit_log_insert_self" ON public.audit_log;
CREATE POLICY "audit_log_insert_self" ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid());

-- Only admins can READ the global log (accountability view).
DROP POLICY IF EXISTS "audit_log_select_admin" ON public.audit_log;
CREATE POLICY "audit_log_select_admin" ON public.audit_log
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- No UPDATE/DELETE policies => the log is append-only (tamper-resistant).
