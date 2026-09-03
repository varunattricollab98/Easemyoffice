# Automatic Gmail tag → lead sync (server-side, full mailbox)

Every Gmail thread labelled **"<Name> lead"** in the shared mailbox
(`contact@easemyoffice.in`) is turned into a CRM lead **assigned to that
salesperson** — automatically, on a schedule, for the **whole mailbox**. No one
has to be logged in, no tab has to be open, and it is **not** admin-only.

This replaces the old client-side auto-sync, which ran only in an admin's
browser and only scanned the first inbox page (~25 emails), so most tagged
emails never became leads.

**How it works:** a Supabase edge function (`gmail-tag-sync`) is fired every
10 minutes by `pg_cron`. It asks the Gmail Apps Script for **all** threads
carrying a label matching `/\blead$/i` (paginated across the full mailbox),
parses the real customer fields out of each email body, matches the label owner
("Hardik lead" → the profile named Hardik) to a salesperson, de-duplicates
against existing email leads, and inserts a lead assigned to that person.

**Full coverage / backlog:** each lead label is walked completely on the Apps
Script side with `getThreads(offset, 500)` in a loop (Apps Script caps a single
`getThreads` call at 500, so labels larger than 500 are no longer truncated),
and the function sweeps up to `MAX_PAGES × PAGE_SIZE` (200 × 100 = 20,000)
threads per run — enough to drain a large already-tagged backlog in one pass.
Because the pagination window restarts at 0 each run and already-created leads
are skipped by dedup (not excluded by Gmail, since they keep their label), a
single run must be large enough to reach the tail; if a mailbox ever exceeds the
per-run cap the run returns `cap_hit: true` (and logs a row to `email_log`)
rather than looking like a clean finish — raise `MAX_PAGES` if you ever see it.

---

## Required secrets (Supabase → Edge Functions → Secrets)

| Secret | What it is |
| --- | --- |
| `GMAIL_WEBHOOK_URL` | The Gmail Apps Script Web App `/exec` URL (same one `gmail-bridge` uses). |
| `GMAIL_TOKEN` | The shared secret; must equal `TOKEN` in the Apps Script. |
| `CRON_SECRET` | A secret word; the cron job sends the same word in its body. |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — the
function uses the service role to insert leads (bypassing RLS), exactly like
`process-reminders` and `notify-stale-followups`.

---

## Deploy steps

### 1. Update + REDEPLOY the Apps Script (out of repo)
The live Apps Script runs on the `contact@easemyoffice.in` Google account and is
deployed **externally** — editing this repo changes nothing until you redeploy.

1. Log into **contact@easemyoffice.in** → **script.google.com** → open the CRM
   project.
2. Paste the latest `setup/gmail-apps-script.gs` over the existing code (it adds
   the new `action=tagged` endpoint; `inbox`/`thread`/`claim` are unchanged).
3. **Deploy → Manage deployments → (edit the active Web app) → New version →
   Deploy** (or create a New deployment). This is required for the `tagged`
   action to go live on the `/exec` URL.

### 2. Run the SQL FIRST (required before deploy)
> **Order matters.** Run `setup/ADD_GMAIL_TAG_SYNC_CRON.sql` **before** deploying
> the function. The SQL widens the `email_log` status CHECK to allow
> `'unmatched'`; if the function runs before that, every unmatched-tag audit
> insert is rejected. The function no longer swallows that failure silently — it
> surfaces `email_log_error` in its JSON response — but you avoid the error
> entirely by widening the constraint first.

Open the Supabase **SQL Editor**, paste `setup/ADD_GMAIL_TAG_SYNC_CRON.sql`,
replace `<PROJECT_REF>`, `<ANON_KEY>`, and `<CRON_SECRET>` with your real
values, and run it. It schedules the job every 10 minutes and (idempotently)
widens the `email_log` status check to allow `'unmatched'`. Safe to re-run.

### 3. Deploy the edge function
```
supabase functions deploy gmail-tag-sync
```
`supabase/config.toml` already declares `[functions.gmail-tag-sync] verify_jwt =
false` (the cron authenticates with `CRON_SECRET`, not a user JWT).

Verify:
```
SELECT * FROM cron.job WHERE jobname = 'gmail-tag-sync';
```

---

## What happens to unmatched owner tags

If a label owner cannot be matched to any profile (e.g. the label says
"Xyz lead" but there is no salesperson named Xyz), the thread is **not** silently
dropped. Instead:

- it is listed in the function's JSON response under `unmatched`
  (`{ owner, threadId, subject }`), and
- a best-effort row is written to `email_log` with
  `source = 'gmail-tag-sync'`, `status = 'unmatched'`, and the owner tag +
  subject in the `subject` column. If that write fails (e.g. the status CHECK
  was never widened — see step 2), the function returns `email_log_error` in its
  JSON response instead of hiding the failure.

Admins can review them any time:
```
SELECT * FROM public.email_log WHERE source = 'gmail-tag-sync' ORDER BY sent_at DESC;
```
Fix by renaming the Gmail label to match the salesperson's profile name (or
correcting the profile's full name); the next run will pick it up.

---

## De-duplication

A tagged thread is deduped by **[real customer email, relay sender address]**,
both lowercased/trimmed — the exact same rule the "Claim as my lead" button uses
in the Lead Inbox. If either key already belongs to an email-sourced lead, no
duplicate is created. (See the canonical dedup note in `src/lib/gmail.ts`.)

---

## Done
Tag an email in Gmail with a "<Name> lead" label and, within ~10 minutes, it
appears in that salesperson's **Leads / Pipeline** in the CRM — with the
customer's parsed name, email, phone, city and company where available.
