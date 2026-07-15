# EaseMyOffice CRM — Complete Documentation

## Overview
- **Stack:** TanStack Start + React 19 + Supabase + Cloudflare Workers
- **Repo:** `github.com/varunattricollab98/Easemyoffice`
- **Live URL:** `https://easemyoffice.emo-crm.workers.dev`
- **Planned domain:** `https://crm.easemyoffice.in` (Cloudflare CNAME setup pending)
- **Gmail inbox:** `contact@easemyoffice.in`
- **Email sending:** Resend (domain `easemyoffice.in` verified)

---

## All Features Built

### Leads & Pipeline
- Add, edit, delete, assign leads
- Bulk import leads from CSV
- Bulk actions (stage change, delete, CSV export)
- Pipeline drag-and-drop with all stages: New Lead → Contacted → Interested → Follow-up → Followups → Proposal → Negotiation → Agreement Signed → Completed → Renewal Due → Not Interested → Lost
- Mandatory reason for Lost / Not Interested (styled dialog)
- Duplicate lead detection (company-wide)

### Lead Inbox (Gmail Integration)
- Shared inbox connected to `contact@easemyoffice.in`
- Claim-to-assign (labels in Gmail)
- Read full HTML email thread inside CRM
- Pagination (25/page) with Newer/Older + jump-to-page
- Skeleton loader + batched fetch for speed
- Prefetch next page + thread on hover

### Bookings
- Add new booking (with auto Booking ID, plan autofill via Mastercodes datalist)
- Google Sheet sync (new bookings → sheet automatically)
- Booking detail dialog
- Balance/payment tracking
- Quoted Price + auto discount calculation
- Alternative contact numbers (2 fields)
- **Bulk CSV Upload** (admin) — import 2024/2025 data into Supabase only (no sheet sync)

### Client Database
- Deduplicated from bookings (by phone → email → name)
- Full timeline popup (first enquiry → each payment)
- Category tags: Premium / Semi-premium / Normal (by amount OR booking count)
- Payment style: Full payment / Part payments / Has dues
- Discount indicator per client
- Search across name, company, phone, email, booking ID, category

### Reminders (Email Automation)
- Schedule one-time or recurring reminders
- Rich HTML editor (paste-preserves formatting, toolbar: bold/italic/underline/lists/colour/clear)
- Email snippets (CRUD + insert into compose)
- File attachments (invoices, PDFs — up to 15MB)
- Multiple comma-separated recipients
- Repeat: every N days + stop after N days OR stop on specific date
- Tabs: Scheduled / Succeeded / Paused / All
- Live countdown ("in 2 minutes", "sending now…")
- Pause / Resume / Cancel / Send now / Delete (admin)
- Admin bulk delete with checkboxes + confirmation
- BCC to shared inbox (for Gmail threading + sent record)
- Modern date-time picker (calendar + hour/min/AM-PM)
- Auto-scheduler via pg_cron (every minute)

### Auto Email Triggers (Pipeline → Reminders)
- Lead → **Follow-up:** daily reminder for 7 days
- Lead → **Not Interested:** weekly revival email for 8 weeks
- Lead → **Lost:** one goodwill email, next day
- Fires from: pipeline drag, lead detail dropdown, bulk stage change
- Auto-cancels old reminder if lead moves again (no duplicates)
- Uses admin-assigned snippet (or built-in default template)
- Supports `{{name}}` placeholder for personalization

### Admin Email Automation Settings
- Admin → Email Automation page
- Per stage: enable/disable, pick a snippet template, custom interval + stop days
- Settings persist in `crm_settings` table

### Sales Performance
- Hero of the Month (by bookings OR profit — filter dropdown)
- Team + individual target panels (admin-editable, color bars)
- Monthly trend chart

### Other
- Admin: delete lead, remove user, device-only logout
- Leads pagination
- EaseMyOffice favicon (building grid icon)
- Global caching (60s stale, preload on hover, 5min GC)

---

## Architecture Notes

### Critical constraint
Cloudflare Git-build does **NOT** deliver server env/secrets to TanStack `createServerFn` runtime. All operations are either:
- **Client-side** (browser Supabase + RLS), OR
- **Supabase Edge Functions** (which DO get secrets, incl. auto `SUPABASE_SERVICE_ROLE_KEY`)

### File naming
**`.client.ts` filename suffix breaks TanStack Start build** — never name files `*.client.ts`.

### Deploy process
- Commit via git, push to `main` → Cloudflare auto-builds
- Edge functions: paste code in Supabase dashboard → Deploy
- Apps Script: paste code → Deploy → Manage deployments → New version

---

## Database Schema (key tables)

### `public.leads`
Client name, mobile, alt_mobile, email, company, city, state, service, budget, source, assigned_to, interest, score, intent_flags, stage, notes, next_follow_up_at, lost_reason

### `public.bookings`
booking_code (auto EMO-BK-####), external_booking_id, booking_date, sales_agent_name, booking_source, plan_name, vo_plan, sp_name, area, city, state, vo_amount, vo_gst, addon_services, addon_amount, addon_gst, total_amount, tds_pct, tds_amount, amount_after_tds, payment_mode_ref, payment_id_utr, invoice_number, sp_payable, addon_payable, profit, sp_payment_status, vo_status, business_name, client_name, email_id, contact_no, alt_contact_no, alt_contact_no_2, remarks, sales_month, amount_received, balance_amount, balance_due_date, quoted_amount, discount_amount

### `public.reminders`
to_email, client_name, subject, message, is_html, attachments (jsonb), send_at, status (scheduled/sent/cancelled/failed/paused), sent_at, error, repeat_interval_days, repeat_until, occurrences_sent, lead_id, booking_id, created_by, assigned_to

### `public.email_snippets`
name, subject, body_html, created_by

### `public.crm_settings`
key (PK), value (jsonb)

### `public.booking_payments`
booking_id (FK), amount, mode, reference, payment_link, note, paid_at

### Other tables
lead_activities, follow_ups, tasks, profiles, user_roles, user_targets, sales_targets, notifications

---

## Supabase Edge Functions

| Function | Purpose |
|---|---|
| `gmail-bridge` | Proxy between CRM and Gmail Apps Script (inbox, thread, claim) |
| `send-client-email` | Send emails via Resend (supports multiple recipients, BCC, attachments) |
| `process-reminders` | Background: sends due reminders, handles recurrence, BCC, attachments |
| `manage-users` | Admin user management |
| `sync-booking-to-sheet` | Sync new bookings to Google Sheet |
| `get-sheet-config` | Get sheet configuration (cached 5min) |

---

## Supabase Secrets Required

| Secret | Value | Purpose |
|---|---|---|
| `RESEND_API_KEY` | `re_...` (from Resend dashboard) | Send emails |
| `CRM_FROM_EMAIL` | `EaseMyOffice <contact@easemyoffice.in>` | From address on emails |
| `CRM_BCC_EMAIL` | `contact@easemyoffice.in` | BCC copy for Gmail threading |
| `CRON_SECRET` | your chosen word | Authenticates the cron job |
| `GMAIL_WEBHOOK_URL` | Apps Script `/exec` URL | Gmail inbox bridge |
| `GMAIL_TOKEN` | your chosen word | Authenticates Gmail requests |

---

## SQL Migrations (run in order)

All files are in `setup/` directory:

1. `COMBINED_DATABASE_SETUP.sql` — base schema (already run)
2. `ADD_LEAD_STAGES.sql` — Followups + Not interested enum values
3. `ADD_SALES_TARGETS.sql` — team targets
4. `ADD_USER_TARGETS.sql` — individual targets
5. `ADD_BOOKING_PAYMENTS_HISTORY.sql` — payment installments + audit
6. `ADD_DUPLICATE_LEAD_CHECK.sql` — duplicate detection
7. `ADD_BOOKING_ALT_CONTACTS.sql` — alt_contact_no + alt_contact_no_2
8. `ADD_BOOKING_DISCOUNT.sql` — quoted_amount + discount_amount
9. `ADD_REMINDERS.sql` — reminders table + RLS
10. `ADD_REMINDER_RECURRENCE.sql` — repeat_interval_days, repeat_until, occurrences_sent
11. `ADD_REMINDER_RICH_AND_SNIPPETS.sql` — is_html, attachments, email_snippets table, storage bucket
12. `ADD_CRM_SETTINGS.sql` — crm_settings key-value table
13. `SCHEDULE_REMINDERS_CRON.sql` — pg_cron job (every minute)

---

## Apps Script (Gmail)

File: `setup/gmail-apps-script.gs`

- Deployed on `contact@easemyoffice.in` Google account
- Web app → Execute as: Me, Access: Anyone
- Actions: inbox (batched, cached 5min), thread (full HTML), claim (label + mark read)
- TOKEN must match `GMAIL_TOKEN` secret in Supabase
- After code changes: Deploy → Manage deployments → Edit → New version → Deploy

---

## pg_cron Schedule

```sql
SELECT cron.schedule(
  'process-reminders',
  '* * * * *',  -- every minute
  $$ SELECT net.http_post(...) $$
);
```

Calls `process-reminders` edge function every minute with the `CRON_SECRET`.

---

## Google Sheet Sync (Bookings)

- New bookings from CRM form → synced to Google Sheet via Apps Script
- Sheet columns: Remarks, Date, Sales POC, Booking ID, Booking Source, VO Status, Vo Plan, Location, State, SP Name, VO Amount, VO GST, Add on Services, Add on Amount, Add on GST, Total amount, TDS %, TDS Amount, Amount After TDS, Payment Mode, Payment ID/UTR, Invoice number, SP Payable, Add on Payable, Profit, SP Payment Status, Business Name, Client Name, Email Id, Cont. No., Remarks, Sales Month
- Bulk upload (2024/2025 data) → Supabase ONLY (not the 2026 sheet)

---

## Client Tier Thresholds

| Tier | By Amount | By Bookings |
|---|---|---|
| Premium | above ₹90,000 | more than 8 |
| Semi-premium | ₹30,000 – ₹90,000 | 8 bookings |
| Normal | below ₹30,000 | fewer than 8 |

---

## Default Auto-Email Templates

### Follow-up (daily, 7 days)
**Subject:** Following up on your enquiry — EaseMyOffice
**Body:** Professional follow-up asking if they have questions, offering a call.

### Not Interested (weekly, 8 weeks)
**Subject:** We'd love another chance — EaseMyOffice
**Body:** Soft re-engagement mentioning new plans/offers.

### Lost (once, next day)
**Subject:** Thank you for considering EaseMyOffice
**Body:** Goodwill thank-you, door always open.

All support `{{name}}` placeholder. Can be overridden with custom snippets via Admin → Email Automation.

---

## Future Roadmap

- [ ] WhatsApp Business API reminders
- [ ] Custom domain `crm.easemyoffice.in`
- [ ] In-CRM reply to client emails
- [ ] In-CRM attachment/PDF viewer
- [ ] Booking edit dialog (full edit, not just detail view)
- [ ] Client merge (fix duplicates)
- [ ] Pipeline auto-stop (cancel reminders when lead leaves a stage)
- [ ] Quoted Price on booking edit (backfill old discounts)

---

## Key Files Reference

| File | Purpose |
|---|---|
| `src/routes/_authenticated/inbox.tsx` | Lead Inbox page |
| `src/routes/_authenticated/pipeline.tsx` | Pipeline drag-and-drop |
| `src/routes/_authenticated/leads/index.tsx` | Leads list + bulk actions |
| `src/routes/_authenticated/leads/$id.tsx` | Lead detail page |
| `src/routes/_authenticated/bookings.tsx` | Bookings list |
| `src/routes/_authenticated/clients.tsx` | Client Database |
| `src/routes/_authenticated/reminders.tsx` | Reminders page |
| `src/routes/_authenticated/admin/email-automation.tsx` | Email Automation settings |
| `src/routes/_authenticated/admin/sales-performance.tsx` | Sales Performance |
| `src/components/dashboard/new-booking-dialog.tsx` | Add New Booking form |
| `src/components/bookings/bulk-upload-dialog.tsx` | Bulk CSV upload |
| `src/components/clients/client-detail-dialog.tsx` | Client timeline popup |
| `src/components/ui/rich-text-editor.tsx` | Rich HTML editor |
| `src/components/ui/date-time-picker.tsx` | Calendar date-time picker |
| `src/components/app-shell.tsx` | Navigation (NAV + ADMIN_NAV) |
| `src/lib/stage-reminders.ts` | Auto-trigger logic for pipeline emails |
| `src/lib/gmail.ts` | Gmail fetch/claim helpers |
| `src/lib/crm.ts` | STAGES, INTERESTS, SERVICES, SOURCES, labelFor |
| `src/lib/auth.tsx` | Auth provider + useAuth hook |
| `supabase/functions/gmail-bridge/index.ts` | Gmail proxy edge function |
| `supabase/functions/send-client-email/index.ts` | Email sender edge function |
| `supabase/functions/process-reminders/index.ts` | Background reminder processor |
| `setup/gmail-apps-script.gs` | Gmail Apps Script (inbox/thread/claim) |

---

*Last updated: July 2026*
