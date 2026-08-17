-- ─────────────────────────────────────────────────────────────────────────
-- FIX_ORPHANED_FOLLOWUPS.sql
--
-- One-time cleanup + backfill for the follow-up system.
-- Run this ONCE in the Supabase SQL Editor.
--
-- Does three things:
--   1. Stops orphaned follow-ups (lead is no longer in followups stage)
--   2. Cancels orphaned email reminders (same reason)
--   3. Backfills missing follow-ups + reminders for leads currently in followups
--
-- Safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────

-- ─── 1. Stop follow-ups for leads that have MOVED OUT of followups ──────────
UPDATE public.follow_ups f
SET status = 'missed'
WHERE f.status = 'pending'
  AND EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = f.lead_id
      AND l.stage NOT IN ('followups', 'follow_up')
  );

-- ─── 2. Cancel email reminders for leads no longer in followups ─────────────
-- (keeps reminders for lost/not_interested since those have their own sequences)
UPDATE public.reminders r
SET status = 'cancelled'
WHERE r.status = 'scheduled'
  AND r.lead_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = r.lead_id
      AND l.stage NOT IN ('followups', 'follow_up', 'lost', 'not_interested')
  );

-- ─── 3. Backfill follow-up TASKS for leads in followups without one ─────────
-- Staggered 1 minute apart starting tomorrow at 10:00 AM.
-- The starting offset skips past any follow-ups that already occupy slots in
-- the 10:00-12:00 window, so this never collides with existing entries.
WITH base AS (
  SELECT (date_trunc('day', now()) + interval '1 day' + interval '10 hours') AS t0
),
occupied AS (
  SELECT count(*) AS n
  FROM public.follow_ups f, base
  WHERE f.status = 'pending'
    AND f.due_at >= base.t0
    AND f.due_at <  base.t0 + interval '2 hours'
)
INSERT INTO public.follow_ups (lead_id, owner_id, action, due_at, created_by)
SELECT
  l.id,
  l.assigned_to,
  'Follow up with ' || l.client_name,
  base.t0 + ((occupied.n + row_number() OVER (ORDER BY l.created_at) - 1) * interval '1 minute'),
  l.assigned_to
FROM public.leads l
CROSS JOIN base
CROSS JOIN occupied
WHERE l.stage IN ('followups', 'follow_up')
  AND NOT EXISTS (
    SELECT 1 FROM public.follow_ups f
    WHERE f.lead_id = l.id AND f.status = 'pending'
  );

-- ─── 4. Backfill email REMINDERS for leads in followups (that have email) ───
INSERT INTO public.reminders (
  to_email, client_name, subject, message, is_html, attachments,
  send_at, status, repeat_interval_days, repeat_until,
  lead_id, created_by, assigned_to
)
SELECT
  l.email,
  l.client_name,
  'Following up on your enquiry — EaseMyOffice',
  'Hi ' || COALESCE(l.client_name, 'there') || E',\n\n'
    || E'Just checking in regarding your recent enquiry with us. We''d love to help you find the perfect virtual office solution.\n\n'
    || E'If you have any questions or would like to schedule a quick call, feel free to reply to this email.\n\n'
    || E'Looking forward to hearing from you!\n\n'
    || E'Best regards,\nTeam EaseMyOffice',
  false,
  '[]'::jsonb,
  now() + interval '1 hour',
  'scheduled',
  1,                                -- daily
  now() + interval '7 days',        -- stop after 7 days
  l.id,
  l.assigned_to,
  l.assigned_to
FROM public.leads l
WHERE l.stage IN ('followups', 'follow_up')
  AND l.email IS NOT NULL
  AND l.email <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.reminders r
    WHERE r.lead_id = l.id AND r.status = 'scheduled'
  );

-- ─── Verify results ─────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM public.follow_ups WHERE status = 'pending')   AS pending_followups,
  (SELECT count(*) FROM public.reminders  WHERE status = 'scheduled') AS scheduled_reminders,
  (SELECT count(*) FROM public.leads      WHERE stage IN ('followups','follow_up')) AS leads_in_followups;
