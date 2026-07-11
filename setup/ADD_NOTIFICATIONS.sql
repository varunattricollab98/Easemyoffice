-- =============================================================================
-- In-app notifications + auto-alert when a lead is assigned to a salesperson.
-- Run ONCE in Supabase -> SQL Editor. Safe to re-run.
-- =============================================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default 'lead_assigned',
  title text not null,
  body text,
  lead_id uuid references public.leads(id) on delete cascade,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

create index if not exists notifications_user_created_idx
  on public.notifications(user_id, read, created_at desc);

-- Each user sees & manages only their own notifications.
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own" on public.notifications
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "notifications_insert_auth" on public.notifications;
create policy "notifications_insert_auth" on public.notifications
  for insert to authenticated with check (auth.uid() is not null);

-- Auto-create a notification for the assignee when a lead is assigned/reassigned.
-- Skips the case where you assign a lead to yourself.
create or replace function public.notify_lead_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.assigned_to is not null
     and NEW.assigned_to is distinct from auth.uid()
     and (TG_OP = 'INSERT' or NEW.assigned_to is distinct from OLD.assigned_to) then
    insert into public.notifications (user_id, type, title, body, lead_id)
    values (
      NEW.assigned_to,
      'lead_assigned',
      'New lead assigned: ' || coalesce(NEW.client_name, 'Lead'),
      coalesce(NEW.company_name, '')
        || case when coalesce(NEW.mobile, '') <> '' then ' · ' || NEW.mobile else '' end,
      NEW.id
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists leads_notify_assignment on public.leads;
create trigger leads_notify_assignment
  after insert or update of assigned_to on public.leads
  for each row execute function public.notify_lead_assignment();
