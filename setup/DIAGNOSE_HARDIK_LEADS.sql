-- =============================================================================
-- Diagnose + repair: leads that show in a rep's Inbox "My leads" but NOT in
-- their Pipeline / Leads. Cause = the lead row's assigned_to is NULL or points
-- to a different user, so RLS hides it. Run these one block at a time in
-- Supabase -> SQL Editor. Replace 'Hardik' with the rep's name if different.
-- =============================================================================

-- 1) Find the rep's profile id (watch for duplicate profiles with the same name).
select id, full_name, email
from public.profiles
where full_name ilike '%hardik%' or email ilike '%hardik%';

-- 2) Confirm their roles (they should at least have 'sales' or 'bd').
select p.full_name, p.email, ur.role
from public.user_roles ur
join public.profiles p on p.id = ur.user_id
where p.full_name ilike '%hardik%';

-- 3) See every email-sourced lead and who actually owns it in the DB.
--    Rows where assigned_to_name is NULL or is NOT Hardik are the stuck ones.
select
  l.id,
  l.client_name,
  l.email,
  l.stage,
  l.assigned_to,
  a.full_name as assigned_to_name,
  l.created_by,
  c.full_name as created_by_name,
  l.created_at
from public.leads l
left join public.profiles a on a.id = l.assigned_to
left join public.profiles c on c.id = l.created_by
where l.source = 'email'
order by l.created_at desc;

-- =============================================================================
-- REPAIR OPTIONS (run ONE, after reviewing query #3). Replace HARDIK_UID with
-- the id from query #1.
-- =============================================================================

-- Option A — hand Hardik every currently-UNASSIGNED email lead:
-- update public.leads
--   set assigned_to = 'HARDIK_UID'
--   where source = 'email' and assigned_to is null;

-- Option B — move specific leads you identified in query #3 (safest, explicit):
-- update public.leads
--   set assigned_to = 'HARDIK_UID'
--   where id in ('lead-id-1', 'lead-id-2', 'lead-id-3');

-- Option C — move leads by client email address:
-- update public.leads
--   set assigned_to = 'HARDIK_UID'
--   where email in ('client1@example.com', 'client2@example.com');

-- After the repair, re-run query #3 to confirm assigned_to_name now shows Hardik.
