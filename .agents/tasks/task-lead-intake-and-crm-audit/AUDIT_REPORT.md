# EaseMyOffice CRM — Verification + Gap-Analysis Audit

## Summary (Hinglish)

Poora system check kiya: repo clean build ho raha hai (typecheck 0 errors, `bun run build` exit 0), live site bhi healthy hai (307 login redirect). Do edge functions (`notify-stale-followups` + `send-scheduled-reports`) live Supabase pe deploy nahi hain (404), aur public route `balance-reminders` abhi 500 de raha hai — dono issues flag kiye gaye hain. Ek perfect "0-to-hero" sales CRM ke liye sabse bada gap hai: koi public web-form lead intake nahi hai (sirf Gmail inbox path hai) — wo FEAT-002 me add hoga.

---

## Baseline (captured before any change)

| Check | Command | Result |
|---|---|---|
| Install | `bun install` | OK — 541 packages installed, exit 0 |
| Typecheck | `npx tsc --noEmit` | **0 errors** (clean baseline; any future error is NEW) |
| Build | `bun run build` | **exit 0**, `✓ built in ~10s` |
| Build artifact | `ls dist/server/index.js` | present (104 bytes entry + `dist/server/assets/*`, `dist/client/*`) |
| Lint | `bun run lint` | ~4000 PRE-EXISTING prettier errors — known baseline, out of scope, NOT fixed here |

Repo state: branch `main` at commit `b6dc097`. Working tree clean apart from the `.agents/` task dir.

---

## (A) VERIFICATION

Each item is labelled by evidence type:
- **[code]** — verified by reading source in this sandbox.
- **[live]** — verified via a live HTTP probe.
- **[needs-user-check]** — cannot be verified from this sandbox (no live-DB / Supabase dashboard access); requires the user to confirm in their Supabase project / dashboard.

### What works

| Area | Status | Evidence |
|---|---|---|
| Live site reachable | Healthy | **[live]** `GET https://easemyoffice.emo-crm.workers.dev/` → `307` (login redirect, expected for unauthenticated). |
| Repo builds + typechecks | Green | **[code]** `npx tsc --noEmit` 0 errors; `bun run build` exit 0 emitting `dist/server/index.js`. |
| Lead schema + enums | Present | **[code]** `setup/COMBINED_DATABASE_SETUP.sql` — `public.leads` with `source lead_source DEFAULT 'website'`, `stage`, `score`, `intent_flags`, `assigned_to` nullable. `lead_source` enum includes `website`. |
| Lead scoring (manual) | Present | **[code]** `src/lib/crm.ts` — `calcScore(flags)` + `deriveInterest(score)` (hot ≥60 / warm ≥30 / cold). Intent-flag driven, computed in the New Lead dialog. |
| Duplicate detection | Present | **[code]** `setup/ADD_DUPLICATE_LEAD_CHECK.sql` (`find_duplicate_lead` RPC), consumed in `src/components/new-lead-dialog.tsx`. |
| Gmail lead inbox + claim-to-assign | Present | **[code]** `src/routes/_authenticated/inbox.tsx` (claim / markMine mutations), `src/lib/gmail.ts` (`parseWeb3FormLead`, `claimEmailInGmail`). |
| Email / notification automation | Present | **[code]** `src/lib/stage-reminders.ts` (pipeline→reminder triggers), `reminders` table, `process-reminders` edge function + pg_cron every minute. Documented in `CRM_DOCUMENTATION.md`. |
| Reporting / dashboards | Present | **[code]** Dashboard widgets under `src/components/dashboard/`, Sales Performance page, Hero of the Month, target panels. |
| Bookings + client DB + payments | Present | **[code]** bookings/clients routes, `booking_payments` history, CSV bulk upload dialog. |
| Data import / export | Present | **[code]** CSV bulk import (`src/components/bookings/bulk-upload-dialog.tsx`) + CSV export on leads bulk actions. |
| Audit trail | Present | **[code]** `lead_activities` table + `activity_type` enum (includes `created`); stage-change trigger. |

### What's broken / misconfigured

| Item | Status | Evidence |
|---|---|---|
| Public route `POST /api/public/hooks/balance-reminders` | **BROKEN (500)** | **[live]** `POST https://easemyoffice.emo-crm.workers.dev/api/public/hooks/balance-reminders` → `500` with the generic "This page didn't load" error page. This is an **unauthenticated public endpoint** that currently errors — likely because required integrations/secrets are not configured and/or it lacks a shared-secret guard. **Concern:** an unauthenticated endpoint that 500s is both a reliability and a security-surface issue (no auth token gate visible on the request). Flag for hardening: add a shared-secret / `CRON_SECRET`-style guard and graceful failure. |

### What's built-but-not-deployed

| Item | Status | Evidence |
|---|---|---|
| Edge function `notify-stale-followups` | **NOT deployed (404)** | **[live]** `POST https://cfzwdlibvxksrxcrsvpp.supabase.co/functions/v1/notify-stale-followups` → `404`. Exists in repo but not live. This is the SLA / stale-lead escalation path — currently non-functional in production. **User action:** deploy the function + confirm its pg_cron schedule (`setup/ADD_STALE_FOLLOWUP_CRON.sql`). |
| Edge function `send-scheduled-reports` | **NOT deployed (404)** | **[live]** `POST https://cfzwdlibvxksrxcrsvpp.supabase.co/functions/v1/send-scheduled-reports` → `404`. Daily sales report automation is not live. **User action:** deploy + confirm cron (`setup/ADD_DAILY_SALES_REPORT_CRON.sql`). |

> All other edge functions (`gmail-bridge`, `send-client-email`, `process-reminders`, `manage-users`, `sync-booking-to-sheet`, `get-sheet-config`) were previously probed and return 401/200/302 = deployed.

### What's built-but-maybe-not-wired (claim RLS)

**The lead-claim flow** — **[code]** + **[needs-user-check]**:

- In `src/routes/_authenticated/inbox.tsx`, the `claim` and `markMine` mutations take over an existing lead with:
  ```ts
  const { data: moved, error } = await supabase
    .from("leads").update({ assigned_to: user.id })
    .eq("id", existing.id).select("id");
  if (!moved || moved.length === 0)
    throw new Error("Couldn't claim this lead — it's already assigned to another rep. Ask an admin to reassign it to you.");
  ```
- The `.select("id")` acts as a guard: if the UPDATE matches **0 rows** (a silent RLS denial, no error), the mutation THROWS the "Couldn't claim… ask an admin" message even though the lead is actually unassigned.
- The base `leads_update` RLS policy in `setup/COMBINED_DATABASE_SETUP.sql` only allows update when the lead is already yours / you are admin / you hold a cross-team role. It does **not** allow claiming an `assigned_to IS NULL` lead.
- `setup/FIX_LEADS_CLAIM_RLS.sql` adds `OR assigned_to IS NULL` to the `leads_update` USING clause (WITH CHECK still forces the new owner = the claimer). **Without this SQL applied on prod, claiming an unassigned lead silently updates 0 rows and the guard throws the error** — a rep cannot claim leads.
- **[needs-user-check]** Whether `FIX_LEADS_CLAIM_RLS.sql` has been applied to the LIVE Supabase DB (`cfzwdlibvxksrxcrsvpp`) is **UNVERIFIABLE from this sandbox** (no DB credentials / dashboard access). The user must confirm in Supabase → SQL Editor (or re-run the file; it is idempotent — `DROP POLICY IF EXISTS` + `CREATE POLICY`).

---

## (B) GAP ANALYSIS — for a 0-to-hero sales CRM

Prioritized. "Present?" = present / partial / missing. Evidence labelled as above.

| Priority | Capability | Present? | Evidence / Notes |
|---|---|---|---|
| **HIGH** | Public web-form lead intake (website contact form → CRM lead) | **MISSING** | **[code]** Only `balance-reminders.ts` exists under `src/routes/api/public/hooks/`. No public endpoint accepts inbound leads. Today the only inbound path is the Gmail inbox (manual claim). `src/lib/gmail.ts` already has `parseWeb3FormLead`, so the parsing shape exists but there is no HTTP intake route. **→ FEAT-002.** |
| **HIGH** | SLA / stale-lead escalation | **PARTIAL** | **[live]** `notify-stale-followups` exists in repo but returns 404 (not deployed). Escalation is non-functional in prod until deployed + cron scheduled. |
| **HIGH** | Public-endpoint hardening / auth | **PARTIAL/BROKEN** | **[live]** `balance-reminders` returns 500 and appears to have no shared-secret gate. Any new public intake route (FEAT-002) must include a secret/anti-abuse guard. |
| **HIGH** | Claim RLS applied on prod | **NEEDS-CHECK** | **[needs-user-check]** See section (A). If unapplied, core rep workflow (claiming leads) is broken. |
| **MED** | Lead scoring | **PARTIAL** | **[code]** `calcScore` / `deriveInterest` exist but are driven by manual intent flags in the New Lead dialog, not automated on inbound leads. Should auto-score inbound web-form leads. |
| **MED** | Lead routing / auto-assignment | **MISSING** | **[code]** New leads default `assigned_to` nullable and are claimed manually. No round-robin / rule-based auto-assign. |
| **MED** | Activity timeline completeness | **PARTIAL** | **[code]** `lead_activities` + stage-change trigger exist. Coverage of all touchpoints (emails sent, calls, form submissions) should be audited for completeness. |
| **MED** | Daily/scheduled reporting automation | **PARTIAL** | **[live]** `send-scheduled-reports` in repo but 404 (not deployed). In-app dashboards work; automated report emails do not. |
| **MED** | RBAC correctness | **PRESENT (verify)** | **[code]** `user_roles` + `is_admin` / `has_role` used across RLS policies. Correctness on prod depends on policies actually applied — **[needs-user-check]** same class of risk as the claim RLS. |
| **LOW** | Duplicate handling | **PRESENT** | **[code]** `find_duplicate_lead` RPC. Client merge is a known roadmap item (not built). |
| **LOW** | Email / notification automation | **PRESENT** | **[code]** stage-reminders + `process-reminders` cron. |
| **LOW** | Reporting / dashboards (in-app) | **PRESENT** | **[code]** dashboard widgets, Sales Performance, Hero of the Month. |
| **LOW** | Audit trail | **PRESENT** | **[code]** `lead_activities`. |
| **LOW** | Data import / export | **PRESENT** | **[code]** CSV import (bulk-upload) + CSV export (leads bulk actions). |
| **LOW** | Bulk operations | **PRESENT** | **[code]** bulk stage change / delete / export in leads list. |
| **LOW** | Global search | **PARTIAL** | **[code]** Per-page search exists (clients search across name/company/phone/email/booking-id). No single global omnibox across all entities. |
| **LOW** | Mobile responsiveness | **PRESENT (verify)** | **[code]** Tailwind responsive utilities used throughout; full mobile QA recommended but not blocking. |

---

## (C) PRIORITIZED BACKLOG — recommended next actions

### Engineering (this task)
1. **[TOP — FEAT-002] Public contact-form lead intake.** Add an unauthenticated `POST` route under `src/routes/api/public/hooks/` (e.g. `lead-intake`) that accepts website/Web3Forms submissions, parses via the existing `parseWeb3FormLead` shape, inserts into `public.leads` (source `website`, `assigned_to` NULL for claiming) using `supabaseAdmin` (service role) from `client.server`, auto-scores via `calcScore`, and dedupes via `find_duplicate_lead`. **Must** include a shared-secret guard (do not repeat the balance-reminders unauth 500 pattern) and add any new secret key to `SERVER_ENV_KEYS` in `src/server.ts`.
2. **Harden `balance-reminders`.** Add a shared-secret gate + graceful error handling so it no longer 500s unauthenticated.
3. **Auto-assignment / routing** (MED) for inbound leads once intake exists.
4. **Global search omnibox** (LOW) across leads/bookings/clients.

### User actions (cannot be done from this sandbox)
1. **Apply `setup/FIX_LEADS_CLAIM_RLS.sql`** in Supabase → SQL Editor and confirm the `leads_update` policy includes `OR assigned_to IS NULL`. (Idempotent — safe to re-run.) — resolves the claim-0-rows risk.
2. **Deploy edge function `notify-stale-followups`** and schedule its cron (`setup/ADD_STALE_FOLLOWUP_CRON.sql`). Currently 404.
3. **Deploy edge function `send-scheduled-reports`** and schedule its cron (`setup/ADD_DAILY_SALES_REPORT_CRON.sql`). Currently 404.
4. **Configure secrets** for any new public intake route (shared secret) and confirm existing secrets (`RESEND_API_KEY`, `CRM_FROM_EMAIL`, `CRM_BCC_EMAIL`, `CRON_SECRET`, `GMAIL_WEBHOOK_URL`, `GMAIL_TOKEN`) are set in the live Supabase project.
5. **Verify RLS policies** for `leads`/`bookings`/roles are the intended set on prod (dashboard check).

---

*Report generated as FEAT-001 of task `task-lead-intake-and-crm-audit`. Baseline: `main` @ `b6dc097`. Live Supabase project `cfzwdlibvxksrxcrsvpp`. This feature changed no application code.*
