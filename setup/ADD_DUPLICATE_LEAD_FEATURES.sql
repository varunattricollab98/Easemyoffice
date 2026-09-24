-- =============================================================================
-- ADD_DUPLICATE_LEAD_FEATURES.sql
-- Two SECURITY DEFINER RPCs for the duplicate-lead workflow:
--
--   1. find_duplicate_lead(p_mobile, p_email, p_name)
--        Company-wide add-time check. Now ALSO matches on client name (in
--        addition to exact mobile/email), and tolerates phone formatting by
--        comparing the last 10 digits. Still returns a single best match.
--
--   2. merge_leads(p_keep_id, p_delete_ids)
--        Merges duplicate leads WITHOUT losing history: it re-points the losing
--        leads' lead_activities and follow_ups onto the kept lead, then deletes
--        the losing leads. Permission is enforced per-lead (a caller may only
--        merge/delete a lead that is theirs, unassigned, or if they're admin) —
--        matching the leads_delete_own_or_admin policy.
--
-- Run ONCE in Supabase -> SQL Editor. Safe to re-run.
-- =============================================================================

-- 1) Enhanced duplicate finder (mobile OR email OR name) ----------------------
create or replace function public.find_duplicate_lead(
  p_mobile text,
  p_email text,
  p_name text default null
)
returns table (id uuid, lead_code text, client_name text, owner_name text, mine boolean)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      nullif(regexp_replace(coalesce(p_mobile, ''), '\D', '', 'g'), '') as digits,
      nullif(lower(trim(coalesce(p_email, ''))), '')                    as email,
      nullif(lower(trim(coalesce(p_name, ''))), '')                     as name
  )
  select
    l.id,
    l.lead_code,
    l.client_name,
    coalesce(p.full_name, p.email) as owner_name,
    (l.assigned_to = auth.uid() or l.created_by = auth.uid()) as mine
  from public.leads l
  left join public.profiles p on p.id = l.assigned_to
  cross join params
  where
    -- phone: compare last 10 digits so +91/spaces/dashes don't matter
    (params.digits is not null and length(params.digits) >= 10
       and right(regexp_replace(coalesce(l.mobile, ''), '\D', '', 'g'), 10) = right(params.digits, 10))
    or (params.email is not null and lower(l.email) = params.email)
    -- name: only counts when reasonably specific (avoids matching "test"/blank)
    or (params.name is not null and length(params.name) > 3 and lower(trim(l.client_name)) = params.name)
  order by
    -- prefer phone match, then email, then name
    (params.digits is not null and length(params.digits) >= 10
       and right(regexp_replace(coalesce(l.mobile, ''), '\D', '', 'g'), 10) = right(params.digits, 10)) desc,
    (params.email is not null and lower(l.email) = params.email) desc,
    l.created_at desc
  limit 1;
$$;

revoke all on function public.find_duplicate_lead(text, text, text) from public, anon;
grant execute on function public.find_duplicate_lead(text, text, text) to authenticated;


-- 2) Merge leads, preserving activities + follow-ups --------------------------
create or replace function public.merge_leads(p_keep_id uuid, p_delete_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean := public.is_admin(v_uid);
  v_del uuid;
begin
  if p_keep_id is null then
    raise exception 'keep id required';
  end if;

  foreach v_del in array coalesce(p_delete_ids, array[]::uuid[]) loop
    if v_del = p_keep_id then
      continue; -- never delete the lead we're keeping
    end if;

    -- Permission: caller may only merge a lead that is theirs, unassigned, or admin.
    if not exists (
      select 1 from public.leads l
      where l.id = v_del
        and (v_admin or l.assigned_to = v_uid or l.assigned_to is null)
    ) then
      raise exception 'not allowed to merge lead %', v_del;
    end if;

    -- Re-point history onto the kept lead BEFORE deleting (else ON DELETE
    -- CASCADE would destroy it).
    update public.lead_activities set lead_id = p_keep_id where lead_id = v_del;
    update public.follow_ups        set lead_id = p_keep_id where lead_id = v_del;

    delete from public.leads where id = v_del;
  end loop;
end;
$$;

revoke all on function public.merge_leads(uuid, uuid[]) from public, anon;
grant execute on function public.merge_leads(uuid, uuid[]) to authenticated;

-- Verify:
--   select proname from pg_proc where proname in ('find_duplicate_lead','merge_leads');
