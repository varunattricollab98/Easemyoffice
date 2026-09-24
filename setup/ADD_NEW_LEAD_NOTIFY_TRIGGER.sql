-- ─────────────────────────────────────────────────────────────────────────
-- ADD_NEW_LEAD_NOTIFY_TRIGGER.sql
-- INSTANT in-CRM notification the moment an UNASSIGNED lead is created
-- (no cron / no wait) so someone can claim it.
--
-- IMPORTANT — division of labour with the EXISTING trigger:
--   • Assigned leads are ALREADY handled by the pre-existing
--     public.notify_lead_assignment() trigger (fires on INSERT-with-owner and
--     on reassignment) which notifies the owner "New lead assigned: ...".
--     We deliberately DO NOT touch that, to avoid double notifications.
--   • THIS trigger only handles brand-new UNASSIGNED leads -> broadcast to
--     EVERY user ("New lead arrived — claim as yours"). That case was the gap.
--
-- The notification carries lead_id so clicking it opens the lead.
-- SECURITY DEFINER + EXCEPTION guard so a notify failure can NEVER block the
-- lead insert.
--
-- This REPLACES the every-15-min notify-new-leads cron. After running this:
--   SELECT cron.unschedule('notify-new-leads');
--
-- Safe to run multiple times (CREATE OR REPLACE + DROP TRIGGER IF EXISTS).
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_on_new_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  label text;
BEGIN
  -- Only brand-new UNASSIGNED leads. Assigned leads are covered by the
  -- existing notify_lead_assignment trigger (don't duplicate it).
  IF NEW.assigned_to IS NULL THEN
    label := COALESCE(
      NULLIF(btrim(NEW.client_name), ''),
      NULLIF(btrim(NEW.company_name), ''),
      NEW.mobile,
      'New enquiry'
    );

    INSERT INTO public.notifications (user_id, type, title, body, lead_id)
    SELECT
      p.id,
      'new_lead_unclaimed',
      'New lead arrived — claim as yours',
      label || ' is unassigned. Open the Lead Inbox to claim it.',
      NEW.id
    FROM public.profiles p;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification problem block lead creation.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_new_lead ON public.leads;

CREATE TRIGGER trg_notify_on_new_lead
AFTER INSERT ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.notify_on_new_lead();

-- Verify:
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.leads'::regclass AND NOT tgisinternal;
