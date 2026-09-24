-- =============================================================================
-- ADD_LEAD_DUPLICATES_FUNCTION.sql
-- Server-side duplicate-lead detection.
--
-- Previously the Leads page fetched up to 5000 leads and ran an O(n^2) all-
-- pairs match in the browser on every visit. This function does the same
-- "2-of-3 (name / phone / email) match" set-based in Postgres and returns ONLY
-- the leads that are part of a duplicate group, tagged with a stable group key
-- + human match label. The client just groups the small result — no big fetch,
-- no quadratic loop.
--
-- Matching rules (mirror the old client logic):
--   name  = lower(trim(client_name)),   counts only if length > 2
--   phone = last 10 digits of mobile,   counts only if length >= 10
--   email = lower(trim(email))
--   Two leads are duplicates if they share >= 2 of {name, phone, email}.
--
-- SECURITY INVOKER (default) so RLS still applies — a rep sees duplicates only
-- among the leads they can see, exactly like before.
--
-- Run ONCE in Supabase -> SQL Editor. Safe to re-run.
-- =============================================================================

create or replace function public.find_lead_duplicates()
returns table (
  id uuid,
  lead_code text,
  client_name text,
  mobile text,
  email text,
  created_at timestamptz,
  assigned_to uuid,
  stage text,
  match_key text,
  match_type text
)
language sql
stable
as $$
  with norm as (
    select
      l.id, l.lead_code, l.client_name, l.mobile, l.email,
      l.created_at, l.assigned_to, l.stage::text as stage,
      nullif(lower(btrim(l.client_name)), '')                              as n_name,
      right(regexp_replace(coalesce(l.mobile, ''), '\D', '', 'g'), 10)     as n_phone,
      nullif(lower(btrim(l.email)), '')                                    as n_email
    from public.leads l
  ),
  -- All unordered lead pairs that share >= 2 of the three keys.
  pairs as (
    select
      a.id as a_id, b.id as b_id,
      (a.n_name is not null and length(a.n_name) > 2 and a.n_name = b.n_name) as name_m,
      (length(a.n_phone) >= 10 and a.n_phone = b.n_phone)                     as phone_m,
      (a.n_email is not null and a.n_email = b.n_email)                       as email_m,
      a.n_name, a.n_phone, a.n_email
    from norm a
    join norm b
      on a.id < b.id
     and (
          (a.n_name is not null and length(a.n_name) > 2 and a.n_name = b.n_name)
       or (length(a.n_phone) >= 10 and a.n_phone = b.n_phone)
       or (a.n_email is not null and a.n_email = b.n_email)
     )
  ),
  qualified as (
    select *,
      (case when name_m then 1 else 0 end
       + case when phone_m then 1 else 0 end
       + case when email_m then 1 else 0 end) as match_count
    from pairs
  ),
  matched as (
    select * from qualified where match_count >= 2
  ),
  -- Build the stable group key + label from the fields that actually matched,
  -- sorted alphabetically (email|name|phone) so it matches the old client key.
  keyed as (
    select
      m.a_id, m.b_id,
      array_to_string(
        array_remove(array[
          case when m.email_m then 'email:' || m.n_email else null end,
          case when m.name_m  then 'name:'  || m.n_name  else null end,
          case when m.phone_m then 'phone:' || m.n_phone else null end
        ], null),
      '|') as match_key,
      array_to_string(
        array_remove(array[
          case when m.email_m then 'Email: ' || m.n_email else null end,
          case when m.name_m  then 'Name: '  || m.n_name  else null end,
          case when m.phone_m then 'Phone: ' || m.n_phone else null end
        ], null),
      ' + ') as match_type
    from matched m
  ),
  -- Expand each pair to both member ids, keeping the group key.
  members as (
    select a_id as lead_id, match_key, match_type from keyed
    union
    select b_id as lead_id, match_key, match_type from keyed
  )
  select
    n.id, n.lead_code, n.client_name, n.mobile, n.email,
    n.created_at, n.assigned_to, n.stage,
    mm.match_key, mm.match_type
  from members mm
  join norm n on n.id = mm.lead_id
  order by mm.match_key, n.created_at;
$$;

revoke all on function public.find_lead_duplicates() from public, anon;
grant execute on function public.find_lead_duplicates() to authenticated;

-- Indexes to keep the self-join fast as the table grows.
create index if not exists leads_dupe_name_idx  on public.leads (lower(btrim(client_name)));
create index if not exists leads_dupe_email_idx on public.leads (lower(btrim(email)));

-- Verify:
--   select count(*) from public.find_lead_duplicates();
