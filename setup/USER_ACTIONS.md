# USER_ACTIONS — steps only YOU can do

> These changes are committed in the repo, but a few things need YOUR hands on the
> Supabase dashboard / Cloudflare dashboard / GitHub secrets. The code alone cannot
> apply database policies, deploy edge functions, or set runtime secrets.

---

## Hinglish summary (Roman) — seedha-saadha kya karna hai

Bhai, code side ka kaam ho gaya hai. Ab bas ye 4 cheezein tumhe khud karni hai:

1. **SQL chalao** — Supabase → SQL Editor kholo aur naya migration
   `supabase/migrations/20260515000001_fix_leads_claim_rls.sql` ka pura content paste karke run kar do.
   Yeh fix karta hai ki reps *unassigned* lead ko "Claim / Mark as mine" kar sakein.
   (Purana `setup/FIX_LEADS_CLAIM_RLS.sql` bilkul same hai — dono safe hain, dubara chalao toh bhi kuch nahi bigadta.)

2. **Do edge functions deploy karo** — `notify-stale-followups` aur `send-scheduled-reports`.
   Ya toh Supabase dashboard me function ka code paste karo, ya PR #16 wali CI chalao
   (uske liye GitHub repo me `SUPABASE_ACCESS_TOKEN` secret daalna padega). Deploy ke baad
   inke pg_cron schedule wali SQL bhi chala dena (neeche di hai).

3. **(Optional) Secrets set karo** Cloudflare Worker me — `LEAD_INTAKE_TOKEN` aur
   `BALANCE_REMINDERS_TOKEN`. Yeh sirf tab chahiye jab tum public endpoints ko anonymous
   log se protect karna chaho. `VITE_` prefix MAT lagana — yeh browser me leak ho jayega.

4. **Claim flow test karo** — RLS migration lagane ke baad ek unassigned lead ko rep se
   claim karwa ke dekho ki wo uski Pipeline / Leads me aa raha hai (neeche steps hain).

Bas itna. Baaki sab code me ho chuka hai.

---

## A) SQL to run in Supabase → SQL Editor

Run these in the Supabase **SQL Editor** (they are NOT auto-applied by the Cloudflare build).
All of them are idempotent / safe to re-run.

| Order | File | What it does |
| ----- | ---- | ------------ |
| 1 | `supabase/migrations/20260515000001_fix_leads_claim_rls.sql` | **NEW tracked migration.** Replaces the `leads_update` RLS policy so a rep can claim an *unassigned* lead (`assigned_to IS NULL`). This is the version-controlled promotion of the one-off setup script below. |

Notes:

- `setup/FIX_LEADS_CLAIM_RLS.sql` contains the **same** policy body and is kept for manual
  use. It is **safe to re-run** — running either the migration or the setup file (or both,
  in any order) leaves the same final `leads_update` policy in place, because both do
  `DROP POLICY IF EXISTS "leads_update"` before `CREATE POLICY`.
- If you use the Supabase CLI with migrations, the new file will apply automatically on
  `supabase db push`; if you are managing the DB by hand, just paste-and-run the migration
  file's contents once.

## B) Deploy the two MISSING edge functions

These edge functions exist in the repo under `supabase/functions/<name>/index.ts` but are
**NOT** deployed by the Cloudflare Workers build (that build only ships the web app). They
must be deployed to Supabase separately:

- `supabase/functions/notify-stale-followups/index.ts`
- `supabase/functions/send-scheduled-reports/index.ts`

Deploy either way:

1. **Supabase dashboard:** Edge Functions → create/select the function → paste the
   `index.ts` contents → Deploy. Set any edge secrets the function reads (e.g. `CRON_SECRET`).
2. **CI in PR #16:** the deploy workflow (`.github/workflows/deploy-supabase-functions.yml`)
   deploys functions on merge, but it needs a GitHub **repo secret** `SUPABASE_ACCESS_TOKEN`
   (a Supabase personal access token). Add it under GitHub → Settings → Secrets and
   variables → Actions, then run/merge PR #16.

### pg_cron scheduling for the deployed functions

After the functions are deployed, schedule them with pg_cron (run in Supabase SQL Editor,
replacing the `<PROJECT_REF>`, `<ANON_KEY>`, `<CRON_SECRET>` placeholders):

- `setup/ADD_STALE_FOLLOWUP_CRON.sql` — schedules **`notify-stale-followups`** daily at
  3:30 AM UTC (9:00 AM IST). Calls `.../functions/v1/notify-stale-followups`.
- `setup/ADD_DAILY_SALES_REPORT_CRON.sql` — schedules the daily sales report at 3:45 AM UTC
  (9:15 AM IST). Note: this file targets `.../functions/v1/daily-sales-report`; if you want
  the **`send-scheduled-reports`** function on a cron instead, copy this file's
  `cron.schedule(...)` pattern and change the `url` to
  `.../functions/v1/send-scheduled-reports` and pick a jobname/time. Both cron files are
  safe to run multiple times.

## C) Optional Cloudflare Worker secrets (endpoint protection)

Both public endpoints work without any token (anonymous), but you can lock them down by
setting a shared secret. These are **runtime Worker secrets**, set in the Cloudflare
dashboard (Workers & Pages → your Worker → Settings → Variables and Secrets) or via
`wrangler secret put`:

| Secret | Protects | Behavior |
| ------ | -------- | -------- |
| `LEAD_INTAKE_TOKEN` | `POST /api/public/hooks/lead-intake` | If set, requests must send a matching `x-intake-token` header or `token` body field, else `401`. If unset, endpoint stays open (current behavior). |
| `BALANCE_REMINDERS_TOKEN` | `POST /api/public/hooks/balance-reminders` | If set, requests must send a matching `x-intake-token` header or `token` body field, else `401`. If unset, endpoint stays open (current behavior). |

Important:

- **Do NOT** prefix these with `VITE_` — `VITE_*` values are inlined into the browser bundle
  and would leak the secret. These are server-only.
- Both keys are already in `SERVER_ENV_KEYS` in `src/server.ts`, so once set on the Worker
  they are bridged onto `process.env` at runtime automatically. No code change needed.

## D) Verify the claim flow end-to-end (after the RLS migration)

Once `20260515000001_fix_leads_claim_rls.sql` is applied:

1. Ensure at least one **unassigned** lead exists (`assigned_to IS NULL`). Submitting the
   public contact form (`POST /api/public/hooks/lead-intake`) creates one, or set an
   existing lead's `assigned_to` to `NULL` in the SQL editor.
2. Log in to the CRM as a **non-admin sales rep**.
3. Go to **Inbox** and click **Claim / Mark as mine** on that lead.
4. Confirm the lead now appears in that rep's **Pipeline** and **Leads** views (its
   `assigned_to` should now be the rep's user id — verify in SQL:
   `SELECT id, client_name, assigned_to FROM public.leads WHERE id = '<lead_id>';`).
5. As a different rep, confirm you **cannot** reassign a lead already owned by someone else
   (the `WITH CHECK` clause still forces the new owner to be yourself; reassigning
   already-owned leads stays admin-only, by design).

If step 4 shows the row still unassigned after claiming, the migration was not applied —
re-run the migration SQL and retry.
