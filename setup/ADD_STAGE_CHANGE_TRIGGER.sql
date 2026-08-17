-- ─────────────────────────────────────────────────────────────────────────
-- ADD_STAGE_CHANGE_TRIGGER.sql
--
-- Database-level safety net: whenever a lead's stage changes AWAY from
-- 'followups', automatically stop its pending follow-ups and cancel its
-- scheduled email reminders.
--
-- This guarantees the behaviour even if the stage is changed outside the UI
-- (bulk CSV import, direct SQL, another client, etc.) — the frontend logic
-- handles the happy path, this trigger handles everything else.
--
-- Safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.auto_stop_followups_on_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Only act when the stage actually changed
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN

    -- Was in followups, now isn't → stop follow-ups + reminders
    IF OLD.stage IN ('followups', 'follow_up')
       AND NEW.stage NOT IN ('followups', 'follow_up') THEN

      -- Mark pending follow-ups as missed (frees their time slot for reuse)
      UPDATE public.follow_ups
      SET status = 'missed'
      WHERE lead_id = NEW.id
        AND status = 'pending';

      -- Cancel scheduled email reminders, but NOT if moving to lost /
      -- not_interested (those stages have their own reminder sequences that
      -- the app creates right after this trigger runs).
      IF NEW.stage NOT IN ('lost', 'not_interested') THEN
        UPDATE public.reminders
        SET status = 'cancelled'
        WHERE lead_id = NEW.id
          AND status = 'scheduled';
      END IF;

    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_stop_followups ON public.leads;
CREATE TRIGGER trg_auto_stop_followups
  AFTER UPDATE OF stage ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_stop_followups_on_stage_change();

-- Verify:
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_auto_stop_followups';
