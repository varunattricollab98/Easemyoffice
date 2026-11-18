# EaseMyOffice CRM — Security & Architecture Audit
**Audit date:** 2026-11-18  
**Scope:** Read-only review of the connected `main` branch and Supabase SQL outputs supplied during the audit.  
**Status:** Findings documented; no application code or production database changes made.

## Executive summary

The CRM has a substantial existing foundation (React 19, TanStack Start/Router, TypeScript, Supabase/Postgres, Cloudflare Workers, Vitest/Playwright, and tracked Supabase migrations). A rewrite is not justified by this audit. The priority is to reconcile live Supabase policies with migrations, close authorization gaps, then strengthen sales activity evidence and reporting.

**Overall:** High-priority authorization and data-integrity risks exist. This review does not establish that anyone exploited them.

## Confirmed findings

### Critical / high priority

1. **Bookings UPDATE policy is effectively unrestricted for authenticated users.**  
   Live policy `bookings_update_team` has both `USING (auth.uid() IS NOT NULL)` and `WITH CHECK (auth.uid() IS NOT NULL)`. PostgreSQL permissive policies are OR-combined, so this broad policy defeats the narrower booking update policies. Remove/replace only after testing each role's required booking workflow.

2. **Dashboard aggregate RPCs are callable by anon and accept arbitrary user IDs or NULL.**  
   Live function inspection showed `dashboard_stats_agg(uuid)` and `dashboard_trend_30d(uuid)` are SECURITY DEFINER and executable by anon. Their filters use the supplied `p_user_id`, not `auth.uid()`; NULL produces organization-wide aggregate results. The dashboard frontend scopes users, but frontend scoping is not a security boundary. Revoke anon execution and enforce caller identity/authorized manager scope inside the functions.

3. **Booking server functions use the service-role client without sufficient role checks.**  
   In `src/lib/bookings.functions.ts`:
   - `appendBooking` requires authentication but has no admin/sales/BD role check before inserting via `supabaseAdmin`.
   - `markBalancePaid` checks admin or booking ownership, but accepts an amount larger than the outstanding balance and increments `amount_received` by that amount. It can therefore record overpayment/inconsistent ledger values.
   - `listBookings` only gives admins all bookings; every other authenticated user is scoped to their own assigned/created rows, which may conflict with accounts/renewals/documentation workflows.
   Server functions bypass normal user RLS when using service role, so every handler must authorize explicitly.

### Medium priority

4. **Follow-up policies allow weak ownership and row mutation.**  
   Live policies show any authenticated user can insert follow-ups (`WITH CHECK (auth.uid() IS NOT NULL)`) and `followups_update` has `WITH CHECK (true)`. The latter can permit changing the lead link/owner after the original row passed USING. Restrict inserts and updates to the parent lead's authorized team and preserve ownership invariants.

5. **Unassigned leads can be deleted by any authenticated user.**  
   Live `leads_delete_own_or_admin` allows `assigned_to IS NULL`, so any authenticated user can delete any unassigned lead. The tracked migration instead defines admin-only deletion. Reconcile live policy with intended shared-inbox claim workflow; claiming must not imply delete permission.

6. **TeleCMI call data is readable by every authenticated user.**  
   `20260516000002_add_telecmi_calls.sql` creates `telecmi_call_events` and policy `telecmi_calls_select_auth` with `USING (true)`. Rows include caller/agent numbers and raw webhook `payload`. Limit access to authorized sales managers/admins and consider column minimization so staff only see calls they need.

7. **Audit and KPI event rows are user-submitted, not independently verified evidence.**  
   `src/lib/audit.ts` writes audit rows directly from the browser; live policy allows a user to insert when `actor_id = auth.uid()`. The user can still fabricate the action/entity/detail/meta for themselves. `kpi_events_insert_own` similarly validates only `user_id = auth.uid()`. These tables are useful telemetry but should not be treated as tamper-proof performance evidence. Important actions should be logged server-side from trusted handlers/triggers.

8. **Broad table grants exist for anon and authenticated roles.**  
   Effective privilege checks returned true for SELECT/INSERT/UPDATE/DELETE/TRUNCATE on sensitive tables including leads, bookings, employee_salary, employees, follow_ups, audit_log, and KPI events. RLS still filters ordinary row operations where enabled and no matching policy means default deny; this output alone does not prove anonymous users can read or modify rows through PostgREST. However, TRUNCATE is not protected by RLS and grants should be reduced to least privilege after checking app and migration dependencies.

9. **B2B role mismatch in some live policies.**  
   The app role type and frontend include both `bd` and `b2b`; role counts show B2B assignments. Some live leads/bookings policies grant access to `bd` but not `b2b`. This may block B2B staff from workflows intended for them. Do not globally alias roles; map each module's intended permissions explicitly.

### Lower priority / hardening

10. **SECURITY DEFINER functions need a complete execution and search-path review.**  
    `has_role` and `is_admin` accept arbitrary user IDs and are executable by anon in the inspected live state, enabling role/admin-status probing. Trigger functions are also SECURITY DEFINER; their direct RPC exposure and trigger attachment should be reviewed separately. Dashboard functions lack a fixed function search_path in the inspected metadata. Harden with explicit caller checks, least-privilege EXECUTE grants, schema-qualified references and a safe fixed search_path.

11. **New-user trigger contains a first-user-admin bootstrap path.**  
    `handle_new_user()` assigns admin when `user_roles` is empty and sales otherwise. Current live role counts show existing admin assignments, so the first-user condition is not currently true. Still, public signup should be disabled unless intentionally required, and privileged role provisioning should be admin-controlled rather than dependent on an empty table.

## Trigger inventory review

The supplied public-schema trigger list shows expected updated-at triggers, follow-up-to-lead synchronization, documentation stage logging, and assignment notifications. No destructive trigger was evident in that list. The `on_auth_user_created` trigger is attached to `auth.users`, so it is not included by a query filtering only `trigger_schema = 'public'`.

## Architecture / delivery recommendations

- Keep this repository as the single source of truth; do not create a second repo.
- Keep the existing stack and data. Avoid a rewrite.
- Store the audit, role matrix, migration notes, test evidence, and deployment checklist in this repository.
- Make fixes as small, reversible Supabase migrations and application commits.
- Add authorization tests for every role against leads, follow-ups, bookings, calls, documentation, B2B, payroll, and audit/KPI data.
- Add server-side trusted activity events for calls, quotations sent, WhatsApp/email touchpoints, follow-up completion, assignment changes, and booking conversion. Do not count a manually entered note as proof of a call.
- Build sales dashboards from trusted events and verified outcomes: leads assigned, first response time, verified call attempts/connections, quotations sent, follow-ups due/completed/overdue, conversion, revenue and gross profit.

## Remediation order

1. Snapshot/backup production and capture the complete live schema/policies/grants/functions.
2. Fix the broad booking UPDATE policy and anonymous dashboard RPC exposure.
3. Add explicit authorization and amount validation to booking server functions.
4. Fix follow-up ownership and unassigned-lead deletion.
5. Restrict TeleCMI call visibility and protect audit/KPI evidence.
6. Reconcile `bd` / `b2b` permissions using a documented role matrix.
7. Reduce table/function grants after dependency checks.
8. Add automated role tests; run lint, unit tests, production build, and a staging smoke test.
9. Deploy only after the user-facing booking, renewal, documentation, B2B and payroll flows pass.

## Evidence / files reviewed

- `src/lib/dashboard-queries.ts`
- `src/lib/auth.tsx`
- `src/lib/bookings.functions.ts`
- `src/lib/audit.ts`
- `src/lib/command-center-queries.ts`
- `src/lib/documentation-queries.ts`
- `src/lib/b2b-queries.ts`
- `supabase/migrations/20260512095324_*.sql`
- `supabase/migrations/20260513065703_*.sql`
- `supabase/migrations/20260515000001_fix_leads_claim_rls.sql`
- `supabase/migrations/20260516000002_add_telecmi_calls.sql`
- `supabase/migrations/20260517000001_b2b_role.sql`
- `supabase/migrations/20260517000002_b2b_core.sql`
- User-supplied live Supabase outputs: table/RLS inventory, policies, grants, SECURITY DEFINER functions, function definitions, role counts, and public-schema trigger inventory.

## Limitations

This is a static source review plus the SQL outputs supplied in chat. I did not execute the app, run the test suite, authenticate to the live CRM, inspect Supabase Auth signup settings, inspect every live table/policy/function, or deploy any changes. The GitHub connector provided file reads but no local checkout/runtime for running `bun test`, lint, or build. Live schema may have changes not represented in migrations.
