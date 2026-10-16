-- Sales visibility of documentation files.
--
-- Before this, a documentation_tasks row was readable only by an admin or the
-- documentation person it is assigned to, so the salesperson who assigned the
-- booking could not see who has it or which stage it is in. Now the person who
-- assigned it, and the booking's owner (bookings.assigned_to / created_by), can
-- READ it too. Writes are unchanged (only admin / assignee update stages).
--
-- Stage history follows the task: anyone who can read the task can read its
-- history (the subquery runs under documentation_tasks RLS).
-- Safe to re-run.

DROP POLICY IF EXISTS documentation_tasks_select_booking_owner ON public.documentation_tasks;
CREATE POLICY documentation_tasks_select_booking_owner ON public.documentation_tasks
  FOR SELECT TO authenticated
  USING (
    assigned_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = documentation_tasks.booking_id
        AND (b.assigned_to = auth.uid() OR b.created_by = auth.uid())
    )
  );

DROP POLICY IF EXISTS doc_stage_events_select ON public.documentation_stage_events;
CREATE POLICY doc_stage_events_select ON public.documentation_stage_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.documentation_tasks t
      WHERE t.id = documentation_stage_events.task_id
    )
  );
