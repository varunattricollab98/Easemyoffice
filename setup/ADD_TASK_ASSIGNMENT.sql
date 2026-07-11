-- =============================================================================
-- Task assignment + reminders + real-time notifications.
-- Run ONCE in Supabase -> SQL Editor (after ADD_NOTIFICATIONS.sql). Safe to re-run.
-- =============================================================================

-- Track when a task reminder was last shown (for repeating reminders by priority).
alter table public.tasks add column if not exists last_reminded_at timestamptz;

-- Let a notification link to a task (in addition to a lead).
alter table public.notifications add column if not exists task_id uuid references public.tasks(id) on delete cascade;

-- Notify the assignee when a task is assigned/reassigned to them.
create or replace function public.notify_task_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.owner_id is not null
     and NEW.owner_id is distinct from auth.uid()
     and (TG_OP = 'INSERT' or NEW.owner_id is distinct from OLD.owner_id) then
    insert into public.notifications (user_id, type, title, body, task_id)
    values (
      NEW.owner_id,
      'task_assigned',
      'New task assigned: ' || coalesce(NEW.title, 'Task'),
      'Priority: ' || coalesce(NEW.priority::text, 'medium')
        || case when NEW.due_at is not null then ' · due ' || to_char(NEW.due_at, 'DD Mon, HH12:MI AM') else '' end,
      NEW.id
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists tasks_notify_assignment on public.tasks;
create trigger tasks_notify_assignment
  after insert or update of owner_id on public.tasks
  for each row execute function public.notify_task_assignment();

-- Enable Realtime so assignees get an instant popup (safe if already enabled).
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when others then null;
end $$;
