# EaseMyOffice CRM — Security & Architecture Audit
**Audit date:** 2026-11-18  
**Scope:** Read-only review of the connected `main` branch and Supabase SQL outputs supplied during the audit.  
**Status:** Initial audit completed. Remediation commits have been added to `main`; migrations are not yet applied to production and application tests/build have not been run.

## Executive summary

The CRM has a substantial existing foundation (React 19, TanStack Start/Router, TypeScript, Supabase/Postgres, Cloudflare Workers, Vitest/Playwright, and tracked Supabase migrations). A rewrite is not justified by this audit. The priority is to reconcile live Supabase policies with migrations, close authorization gaps, then strengthen sales activity evidence and reporting.

**Overall:** High-priority authorization and data-integrity risks exist. This review does not establish that anyone exploited them.

## Confirmed findings

### Critical / high priority

1. **Bookings UPDATE policy was effectively unrestricted for authenticated users.**  
   Live policy `bookings_update_team` had both `USING (auth.uid() IS NOT NULL)` and `WITH CHECK (auth.uid() IS NOT NULL)`. A committed migration now drops this policy, leaving the narrower booking update and renewal policies in place. Apply and test against staging before production.

2. **Dashboard aggregate RPCs were callable by anon and accepted arbitrary user IDs or NULL.**  
   A committed migration revokes EXECUTE from PUBLIC, anon, and authenticated for both SECURITY DEFINER dashboard aggregate functions. The dashboard query has an RLS-scoped client-side fallback. This disables the fast RPC path until caller-identity checks are implemented and tested.

3. **Booking server functions use the service-role client.**  
   A committed application change adds admin/sales/BD role validation to `appendBooking`, validates received plus outstanding amounts against the booking total, and rejects zero/negative or over-balance payments in `markBalancePaid`. `listBookings` scope remains to be reviewed against accounts/renewals/documentation workflows.

### Medium priority

4. **Follow-up policies allow weak ownership and row mutation.**  
   Live policies show any authenticated user can insert follow-ups (`WITH CHECK (auth.uid() IS NOT NULL)`) and `followups_update` has `WITH CHECK (true)`. The latter can permit changing the lead link/owner after the original row passed USING. Restrict inserts and updates to the parent lead's authorized team and preserve ownership invariants.

5. **Unassigned leads can be deleted by any authenticated user.**  
   Live `leads_delete_own_or_admin` allows `assigned_to IS NULL`, so any authenticated user can delete any unassigned lead. The tracked migration instead defines admin-only deletion. Reconcile live policy with intended shared-inbox claim workflow; claiming must not imply delete permission.

6. **TeleCMI call data was readable by every authenticated user.**  
   A committed migration replaces the blanket SELECT policy with admin, matched-agent, or linked-lead ownership access. It also adds an authenticated aggregate RPC returning only answered/missed counts and updates the dashboard to use it instead of reading call-event rows directly.

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


## Remediation commits (2026-11-18)

- `500efb2` — revoke browser-role execution of the exposed dashboard aggregate RPCs.
- `683d110` — add booking creation role validation and payment amount guards.
- `f740ba5` — drop broad booking UPDATE policy; scope TeleCMI row access; add safe call-count aggregate RPC.
- `8e008e0` — update dashboard call metrics to use the aggregate RPC.

**Not yet done:** migrations have not been run against Supabase; no production deployment, build, lint, unit tests, or end-to-end role tests have been performed. Follow-up policies, lead deletion, audit/KPI trust, role mismatch, and least-privilege grants remain open.