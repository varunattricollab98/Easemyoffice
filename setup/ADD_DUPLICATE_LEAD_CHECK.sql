-- =============================================================================
-- Company-wide duplicate-lead check.
-- A SECURITY DEFINER function that scans ALL leads (bypassing row-level security)
-- so a salesperson is warned even when the matching lead belongs to a teammate.
-- It returns only minimal info (code, name, owner, and whether it's theirs).
--
-- Run ONCE in Supabase -> SQL Editor. Safe to re-run.
-- =============================================================================
create or replace function public.find_duplicate_lead(p_mobile text, p_email text)
returns table (id uuid, lead_code text, client_name text, owner_name text, mine boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id,
    l.lead_code,
    l.client_name,
    coalesce(p.full_name, p.email) as owner_name,
    (l.assigned_to = auth.uid() or l.created_by = auth.uid()) as mine
  from public.leads l
  left join public.profiles p on p.id = l.assigned_to
  where (nullif(trim(coalesce(p_mobile, '')), '') is not null and l.mobile = trim(p_mobile))
     or (nullif(trim(coalesce(p_email, '')), '') is not null and lower(l.email) = lower(trim(p_email)))
  order by (nullif(trim(coalesce(p_mobile, '')), '') is not null and l.mobile = trim(p_mobile)) desc,
           l.created_at desc
  limit 1;
$$;

revoke all on function public.find_duplicate_lead(text, text) from public, anon;
grant execute on function public.find_duplicate_lead(text, text) to authenticated;
