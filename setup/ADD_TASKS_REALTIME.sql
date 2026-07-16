-- Enable Supabase Realtime on the tasks table so task updates (status changes,
-- assignments) are broadcast to all connected CRM clients instantly.
-- Run ONCE in Supabase -> SQL Editor.

ALTER TABLE public.tasks REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
