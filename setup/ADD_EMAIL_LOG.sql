-- ─────────────────────────────────────────────────────────────────────────
-- ADD_EMAIL_LOG.sql
-- Creates public.email_log: an append-only record of every client-facing email
-- the CRM sends via Resend. This replaces the old "BCC a copy to the shared
-- inbox" approach (which flooded contact@easemyoffice.in — e.g. 1000 followups
-- at once) with a proper in-CRM sent-mail record.
--
-- Rows are written from INSIDE the edge functions (send-client-email and
-- process-reminders) using a service-role client, which bypasses RLS. The RLS
-- policies below govern what authenticated browser users may read/insert.
--
-- IDEMPOTENT: safe to re-run (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT
-- EXISTS / DROP POLICY IF EXISTS before CREATE POLICY).
-- Run this in the Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The recipient(s) for this send. One row = one invocation of the edge
  -- function, so for multi-recipient sends this holds the comma-joined list.
  to_email TEXT NOT NULL,
  subject TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  -- Resend's message id, when the provider accepted the send.
  resend_message_id TEXT,
  -- Optional context links. bookings + leads both exist in this schema
  -- (see COMBINED_DATABASE_SETUP.sql), so both get real FKs.
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  -- Which edge function / call site produced this row
  -- (e.g. 'send-client-email', 'process-reminders').
  source TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_log_lead_idx ON public.email_log(lead_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS email_log_booking_idx ON public.email_log(booking_id, sent_at DESC);

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

-- Read: admin sees all; a user sees rows they created, plus rows linked to a
-- lead they can already see (mirrors the leads / lead_activities read pattern).
DROP POLICY IF EXISTS email_log_select ON public.email_log;
CREATE POLICY email_log_select ON public.email_log
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR created_by = auth.uid()
    OR (lead_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.leads l WHERE l.id = lead_id AND (
        l.assigned_to = auth.uid()
        OR l.created_by = auth.uid()
        OR public.has_role(auth.uid(),'documentation')
        OR public.has_role(auth.uid(),'accounts')
        OR public.has_role(auth.uid(),'renewals')
        OR public.has_role(auth.uid(),'bd')
      )
    ))
  );

-- Insert: any authenticated user (the edge functions use the service role and
-- bypass RLS anyway; this simply allows a browser client to log if ever needed).
DROP POLICY IF EXISTS email_log_insert ON public.email_log;
CREATE POLICY email_log_insert ON public.email_log
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- Append-only: no UPDATE / DELETE policies. Admins can manage rows via the
-- service role if ever required.
