-- ─────────────────────────────────────────────────────────────────────────
-- ADD_NEW_LEAD_NOTIFY_TRIGGER.sql
-- INSTANT in-CRM notifications the moment a lead is created (no cron / no wait).
--
-- On INSERT into public.leads:
--   • assigned lead   -> one notification to the owner ("New lead assigned to you")
--   • unassigned lead -> a notification to EVERY user
--                        ("New lead arrived — claim as yours")
-- The notification carries lead_id so clicking it opens the lead.
--
-- Runs inside the same transaction as the insert (SECURITY DEFINER so it can
-- write notifications regardless of the inserter's RLS). Wrapped so a notify
-- failure can NEVER block the lead from being created.
--
-- This REPLACES the every-15-min notify-new-leads cron. After running this,
-- unschedule the cron so you don't get both:
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
  -- Short human label for the notification body.
  label := COALESCE(
    NULLIF(btrim(NEW.client_name), ''),
    NULLIF(btrim(NEW.company_name), ''),
    NEW.mobile,
    'New enquiry'
  );

  IF NEW.assigned_to IS NOT NULL THEN
    -- Notify only the owner.
    INSERT INTO public.notifications (user_id, type, title, body, lead_id)
    VALUES (
      NEW.assigned_to,
      'new_lead_assigned',
      'New lead assigned to you',
      label || ' — reach out soon.',
      NEW.id
    );
  ELSE
    -- Unassigned: notify every user so someone claims it.
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
