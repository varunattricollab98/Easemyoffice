# Agent Context — EaseMyOffice CRM

> Persistent memory/handoff for the AI agent working on this repo.
> **New session? Read this whole file first**, then `.kiro/steering/emo-crm.md`.
> Last updated: HRMS Phase 2 PR (attendance), session of 30 Sep 2026.

---

## 0. Start-of-session checklist
1. Work ONLY in **`varunattricollab98/Easemyoffice`**. Sessions are often attached to
   `varunattricollab98/easemyofficecollab98` — that repo is **EMPTY, never use it**. Clone:
   `git clone https://github.com/varunattricollab98/Easemyoffice.git` into `/projects/sandbox/`.
2. `.kiro/steering/emo-crm.md` is **not auto-loaded** in Kiro Web: only the workspace-root
   `.kiro/steering/` is loaded, and this repo sits in a subfolder. Read it manually.
3. Set up the toolchain (§4). Check §10 for decisions still waiting on the owner and §11 for
   where HRMS stands (Phase 2 is next).
4. Reply to the owner in **short Hinglish** (§5).

## 1. What this project is
**EaseMyOffice CRM** — a sales CRM for virtual office / GST / business registration services.
Sales team manages leads → follow-ups → bookings → clients, and sends quotation emails.
HRMS (attendance / leave / payroll) is being added inside the same app (§11).

- **Correct repo:** `varunattricollab98/Easemyoffice` (this one).
- **Live:** https://easemyoffice.emo-crm.workers.dev (planned: crm.easemyoffice.in)
- **Owner / admin:** Varun Attri. Sales team (Sep 2026): Kishan, Sarthak, Hardik, Neha.

## 2. Tech stack
- TanStack Start + React 19 + TanStack Router
- Supabase (Postgres + Deno edge functions) — project ref `cfzwdlibvxksrxcrsvpp`
- Cloudflare Workers (hosting)
- UI: Radix + Tailwind v4 + shadcn-style components in `src/components/ui`
- Package manager: **bun**
- Tests: **Vitest** unit tests (`src/lib/*.test.ts`) + Playwright e2e (`e2e/`)

## 3. Deployment — ALL AUTOMATIC (don't deploy manually)
- **Frontend:** Cloudflare is connected to GitHub → every merge to `main` auto-builds + deploys (~3 min). No manual `bun run deploy`.
- **Edge functions:** `.github/workflows/deploy-supabase-functions.yml` auto-deploys `supabase/functions/**` on push to main (needs `SUPABASE_ACCESS_TOKEN` repo secret).
- **CI:** `.github/workflows/ci.yml` runs `npx tsc --noEmit` + `bun run test` + `bun run build` on every PR.
- Two check-runs must be green: **`Typecheck and build`** (GitHub Actions) and
  **`Workers Builds: easemyoffice`** (Cloudflare). They take ~2–3 min.

## 4. Sandbox: validate locally BEFORE pushing
The npm registry is reachable, so the whole CI pipeline runs in-sandbox:

| Step | Command | Result (as of #172) |
|---|---|---|
| Install | `bun install --frozen-lockfile` | 562 packages, ~8s |
| Typecheck | `npx tsc --noEmit` | clean |
| Unit tests | `bun run test` | 98 passed / 6 files |
| Build | `bun run build` | ~11s, emits `dist/server/index.js` + `wrangler.json` |

**Always run typecheck + tests + build before pushing.** `node`/`npx` are often missing from a
fresh shell's PATH — export first, otherwise `npx tsc` dies and a shell chain can still look green:

```sh
export PATH="/root/.nvm/versions/node/v22.23.3/bin:$PATH"   # check `ls /root/.nvm/versions/node` — the patch version drifts
```

- **Edge functions can be type-checked in-sandbox:** `npx -y deno check supabase/functions/<fn>/index.ts`
  (downloads Deno via npm; delete the `deno.lock` it leaves behind). CI does not check them.

Sandbox quirks (all learned the hard way — several fail SILENTLY with empty output):
- **`/tmp` is not writable.** Put scratch files under `/projects/sandbox/<name>` (outside the
  repo) and delete them afterwards.
- **`diff` is not installed**, and ESLint's `unix` formatter was removed from core. Use
  `--format json` and a small `node -e` script when comparing lint output.
- **Lint policy.** CI does not lint and the repo carries thousands of pre-existing prettier
  errors, so `bun run lint` fails repo-wide. Rule: new files must be lint-clean
  (`npx prettier --write <new file>`); touched existing files must gain **no** new errors —
  compare `npx eslint <file>` problem counts before/after with `git stash -u` / `git stash pop`.
  Running `prettier --write` on an existing file reformats the whole file (done deliberately for
  `invoices.tsx`, `payments.tsx`, `booking-detail-dialog.tsx`) — say so in the PR.
- Adding/removing a route file changes `src/routeTree.gen.ts`; `bun run build` regenerates it —
  commit it.
- **No Supabase credentials:** cannot run SQL, cannot exercise real data, cannot regenerate
  `src/integrations/supabase/types.ts`. For new tables either hand-edit `types.ts` (done for
  `bookings.lead_id`, #156) or use a narrow cast helper with hand-written row types (`hrmsDb()`
  in `src/lib/hrms.ts`, same idea as `email_log`). Anything needing live DB/Gmail/Zoho must be
  checked by the owner after deploy.

## 5. Workflow the user expects
- Implement on a **feature branch**; **rebase onto latest origin/main** before pushing (a stale base has twice REVERTED already-merged PRs).
- **Push the branch FIRST, then create the PR** via `gh api repos/varunattricollab98/Easemyoffice/pulls -f ...` — creating it before the push returns 422 "head invalid".
- **Squash-merge without asking** (owner: "sab khud hi kara karo", reconfirmed "merge kardiya karo"): wait ~140s, confirm both check-runs green (`gh api .../commits/<sha>/check-runs`) and `mergeable_state: clean` (`gh api .../pulls/<n>`), then
  `gh api -X PUT repos/varunattricollab98/Easemyoffice/pulls/<n>/merge -f merge_method=squash`; `git checkout main && git pull --ff-only`; delete local + remote branch; confirm the post-merge check-runs on the main SHA (that is the live deploy). Never merge around a failing check.
- **Migrations — never merge ahead of them.** Merge = instant deploy, so code needing a new table/column would break live features. Open the PR, paste the **full SQL inline in chat** (the owner copies it from chat — he asked for this explicitly), give a verification query, and merge only after he confirms. Keep migrations idempotent (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`).
- `gh` notes: gateway blocks GraphQL → use `gh api` REST only (not `gh pr *`); pass bodies inline via `-f body='...'`, not `--body-file`.
- **Communication:** reply in **Hinglish**, SHORT — what shipped + PR link, blockers/decisions in one line. No reasoning walkthroughs, recaps or summary tables in chat; detail goes in the PR description + commit message. **No option menus** — give one recommendation with a one-line reason; ask one short question only for a genuine business fork. Code/SQL/comments/commits/PR text in clean English.
- **UI taste:** owner wants "classy", glossy iOS-26 style — frosted glass, soft layered shadows, and hover vs selected states clearly distinguishable. Reference: the Fresh/Renewal tabs in `bookings.tsx` (#170).

## 6. Gmail lead-inbox + tag-sync
- Shared Gmail `contact@easemyoffice.in` fronted by a Google **Apps Script Web App** (`setup/gmail-apps-script.gs`), deployed EXTERNALLY on that Google account. **Editing the repo file does nothing until the owner pastes it into the live Apps Script and redeploys the Web App.**
- Edge function `gmail-bridge` proxies actions: inbox / thread / claim / tagged.
- Manual claim/markMine/assign (`src/routes/_authenticated/inbox.tsx`) add a Gmail label `"<Name> lead"`. **The CRM NEVER creates a "converted" label** — if the user sees "converted" auto-applied, it's a Gmail filter or Apps Script rule, not the CRM.
- Server sync `gmail-tag-sync` edge function (+ `supabase/functions/_shared/gmail-parse.ts`, byte-identical to `src/lib/gmail.ts`) runs every 10 min via pg_cron: enumerates all `"<Name> lead"` threads full-mailbox, matches owner tag → profile, dedups on `[realEmail, senderAddr]`, inserts leads (source='email') assigned to that salesperson via service role.
- **Secrets (Supabase → Edge Functions):** `GMAIL_WEBHOOK_URL`, `GMAIL_TOKEN`, `CRON_SECRET` (= `emo-cron-5034`).
- `setup/ADD_GMAIL_TAG_SYNC_CRON.sql` was run (also created `email_log` table which didn't exist, and widened its status CHECK to allow `'unmatched'`). Needs `pg_cron` + `pg_net` extensions.

## 7. Key files
- `src/components/send-quotation-dialog.tsx` — quotation dialog + `buildQuotationHtml` email. Brand logos are self-hosted at `easemyoffice.in/logos/*.png`. **SVG/WebP DON'T render in email clients** → use PNG, or Clearbit `https://logo.clearbit.com/<domain>`.
- `src/components/dashboard/new-booking-dialog.tsx` — `NewBookingDialog`; optional `open`/`onOpenChange`/`prefill`/`onSaved` props (#154); payment-ack email flow.
- `src/lib/lead-to-booking.ts` — lead → booking prefill mapper (never prefills money).
- `src/components/bookings/booking-detail-dialog.tsx` — shared booking view/edit dialog (Bookings + Invoices), incl. GSTIN + billing address (#163). Non-admins read-only.
- `src/components/bookings/new-renewal-booking-dialog.tsx` — renewal form: no TDS/discount, stamps `renewal_status`, syncs to a separate renewal sheet via edge fn `sync-renewal-to-sheet` (#168).
- `src/components/dashboard/hero-of-month.tsx` — dashboard primary block: Hero of the Month, Our Target (`app_settings` key `sales_targets` + `user_targets` table), Top services, 6-month trend.
- `src/lib/report-period.ts`, `src/lib/report-metrics.ts`, `src/lib/report-queries.ts` (+ tests) — Sales Performance panel maths (#157).
- `src/routes/_authenticated/invoices.tsx` — Zoho "Create Invoice" only for bookings created on/after `ZOHO_INVOICE_CUTOFF` (2026-09-14).
- `src/lib/browser-notify.ts` + `src/components/notifications-watcher.tsx` — desktop + in-app notifications (#171).
- `src/lib/hrms.ts` — HRMS row types, `hrmsDb()`, `formatMinutes`, `lateAfter` (#172).
- `src/lib/email-signature.ts` — "Your Dedicated Manager" block.
- `src/routes/_authenticated/leads/$id.tsx` — lead detail; call/WhatsApp logging; Convert to Booking.
- `src/components/app-shell.tsx` — sidebar (sticky). `src/styles.css` — global CSS + `.scrollbar-modern`.

### Current navigation (after #172)
- **Main:** Dashboard · Pipeline · Lead Inbox · Calls · Leads · Renewal Inbox · Renewal Leads · Renewal Pipeline · Clients · Follow-ups · Reminders · Calendar · Tasks · Notifications · Documentation · Bookings (All/Fresh/Renewal tabs) · Invoices · Payments · Activity · Reports (admin) · Sales Performance (admin/sales/bd).
- **Main** also has **My Attendance** (`/attendance`, every role).
- **Admin:** **Staff & Attendance** (`/hrms` hub → tabs Attendance / Employees / Office & Hours; admin guard on the `hrms.tsx` layout route) · Email Automation · Team (`/admin/users`) · Settings.
- **No separate HR person** — the admin runs all HR. User-facing copy says "admin", never "HR"; keep all HR screens inside the `/hrms` hub rather than adding sidebar items.
- **Removed on purpose** (don't restore without asking): `/admin/analytics`, `/admin/activity-log`, `/documents`, `/team`, `/renewals/bookings`, and the dashboard Pipeline embed.
- Dashboard order: header → KPI strip → Hero of the Month → widget grid.

## 8. Shipped features (merged PRs)

### Up to #77
- #62 password show/hide toggle (reusable `PasswordInput`)
- #63 reliable Gmail tag→lead sync (server cron)
- #64 booking profit = pre-GST base `(vo+addOn)-spPay-addOnPay`; removed "Quoted Price" & "Discount Given" UI fields
- #65 quotation multi-state select + per-row × removal + email logo grid + sticky sidebar
- #66 bulk bookings (queue + "Add another" / "Save all") + localStorage draft (key `emo:new-booking-draft:<userid>`)
- #67 Leads date-range (from–to) filter (`custom_range`)
- #68 quotation Add-on Services (Service Name + Amount, "Add more service")
- #69 add-ons get 18% GST (Base + GST + Total, mirrors pricing table)
- #70 / #73 / #77 quotation email logo & image fixes (SVG/WebP → PNG/Clearbit; footer social icons → emoji+text)
- #71 "+ New Booking" button added to Bookings list page
- #72 manual call & WhatsApp activity logging (outcome/duration/notes in `lead_activities.payload`, no migration)
- #74 payment-ack email icon layout fix (`@media` stacked `.stack` cells lost centering → added `text-align:center`)
- #75 quotation dialog body scroll (Radix ScrollArea → native `overflow-y` div so footer/Send stays reachable)
- #76 reusable `.scrollbar-modern` CSS utility (thin/rounded, always-visible via `overflow-y-scroll`)

### #78–#152 (grouped by area)
- **Quotation** (#79–#87, #90, #91): self-hosted then enlarged/aligned brand logos, CA pricing + mail-handling wording, correct UPI, UPI QR code, removed the 10-row pricing cap, serial number column, selected states float to top, day-pass price settled at **599/day**.
- **Zoho Books invoicing** (#92–#96): manual Create + Send to Client, new-bookings-only cutoff, IGST inter-state vs CGST+SGST intra-state, client-state place of supply, client-only billing address, mark Paid for paid bookings. Docs point at the EaseMyOffice-HR org.
- **Renewals** (#99–#101, #103): renewals-only users see only renewal clients, separate Gmail inbox for `renewals@easemyoffice.in` with reply + snippet/premium quotation, and a renewal pipeline at parity with the sales pipeline.
- **Inbox / Gmail** (#89, #107–#111, #120): retry transient Google HTML interstitials, Reply in CRM on any thread, attachment-list layout fix, instant reopen, rich-text + attachments composer, one "Send Quote" button, no junk leads from our own sent copies.
- **Payment-ack email** (#98, #102, #104): reliable logo/alignment across clients, consistent emoji+label alignment, removed floating decorative emoji.
- **Leads** (#88, #113, #142–#152): WhatsApp opens in a new tab, Send Quotation always visible, delete scoped own/unassigned for users and all for admins, duplicate-lead warning + history-preserving merge + clickable badge, resizable persisted columns, mobile cards, server-side duplicate detection.
- **Bulk upload** (#140, #141, #145): accepts the EMO sales sheet as-is, fuzzy header matching, blank date → null with per-row retry.
- **Bookings** (#97, #105, #146): admin delete, multi-year plan duration, admin Sales Agent filter.
- **Calls** (#112): TeleCMI call auto-logging webhook + Calls section.
- **Dashboard / nav / search** (#115–#118, #122, #123, #135, #150): global search palette, call & booking-revenue KPI cards, Pipeline board on the dashboard (removed again in #161), Pipeline above Lead Inbox, notifications Mark-all-read + Read tab, staggered entrance animation.
- **Automations / notifications** (#134, #136–#139): daily renewal-expiry nudge email, instant new-lead in-CRM notifications via a DB trigger, restricted to UNASSIGNED leads.
- **Audit** (#119): team accountability Activity Log (page removed in #164; `audit_log` still written).
- **Code health** (#124–#133): booking money math in tested `computeBookingMoney`, **Vitest introduced**, error boundary + shared `formatINR`, ~90 `any` removed, renewals inbox HTML in a sandboxed iframe (XSS), a11y + logger util.
- **Misc** (#121): realtime demo simulator permanently disabled.

### #153–#172 (session of 28–29 Sep 2026)
- #153 corrected §4 (sandbox CAN run the full pipeline) and added `.kiro/steering/emo-crm.md` (not auto-loaded in Kiro Web — see §0).
- #154 **Convert to Booking on a lead** — opens `NewBookingDialog` prefilled from the lead (name, company, phone, alt phone, email, city, state, mapped source, remarks with lead code/service/budget). `prefill` disables the queue + localStorage draft for that dialog. Never prefills money (`vo_amount` is pre-GST; `quoted_amount` has no input since #64). On save the lead advances to `payment_received` via `handleStageChange` (forward-only) and stamps `converted_date` if empty.
- #155 merge-without-asking policy recorded.
- #156 `bookings.lead_id` (uuid FK → leads, ON DELETE SET NULL, partial index). Migration `20260516000004_add_booking_lead_id.sql` **applied by owner**. Sent only on conversion; `types.ts` hand-edited.
- #157 **Sales Performance panel** (`/admin/sales-performance`, rebuilt the existing page): Today / This week / This month / custom in URL params; leads assigned, closures, conversion, revenue vs collected, calls, WhatsApp, quotations, avg deal, follow-up discipline, growth vs the preceding **same-length** window, trend chart (first recharts consumer), conversion by source, CSV. **Productivity index** = closures 30 / revenue 25 / conversion 15 / activity 20 / discipline 10, volume parts relative to the period's best rep (no targets exist → leader ≈100, lone rep = 100). Opened to sales/bd; RLS scopes reps to their own data and the page retitles to "My Performance". Quotation sends now log `payload.kind = "quotation"`. +35 tests.
- #158 Reports `/reports`: Month dropdown (last 12) + Today / This week / This month / Last month / All time, all writing into the existing From/To pair.
- #159 Hero of the Month moved under the KPI strip (above the widget grid, outside it so drag-reorder can't bury it); static import.
- #160 Top plans → **Top services** grouped by plan-code prefix (`BR_SPMukherji_kolkata` → `BR`; BR was really 20, not 17); Target panel restyled as progress rows; tabular-nums; dark-mode border.
- #161 removed the embedded Pipeline board from the dashboard + the dead `embedded` prop on `PipelinePage`.
- #162 steering: keep chat replies short.
- #163 Invoices: clicking the id/client opens `BookingDetailDialog`; dialog now edits `gst_number` + `gst_address` (they drive Zoho `gst_treatment` and IGST vs CGST+SGST).
- #164 removed Analytics + Activity Log pages.
- #165 Payments rows: company (fallback client name), tel-link phone, city/state, payment mode ("Mode not recorded" if blank); all searchable.
- #166 removed the Documents page (Documentation stays).
- #167 removed read-only `/team`; `/admin/users` relabelled **Team**.
- #168 Renewal Bookings merged into Bookings. Renewal = `renewal_status in ('renewed','pending_payment')` — **not** `booking_source` (the renewal form lets agents pick Email/Referral/etc.). "New Renewal Booking" button; old route deleted.
- #169 Fresh/Renewal filter as counted segmented tabs above the table (counts ignore the type filter itself).
- #170 glassy iOS-style styling for those tabs.
- #171 **Desktop (OS) notifications** — opt-in "Enable alerts" card on the Notifications page (permission must come from a click); fires for new notification rows, new follow-ups and pending-task reminders; suppressed while the CRM tab is visible; tagged per item; in-app off switch (localStorage `emo:browser-notify`). **No service worker** → works with the tab in background/minimised, NOT with the browser closed.
- #172 **HRMS Phase 1** (§11).

## 9. Data state & schema gotchas
- CRM was cleaned once: dummy leads/bookings/reminders/notifications deleted; users/roles/settings/snippets kept. The Google Sheet still holds old booking data separately.
- **436 bookings** (late Sep 2026), and **none carries `renewal_status`** → the Renewal tab shows 0; existing renewals came in via sheet import / the sales form.
- Several `bookings` columns (alt contacts, `gst_*`, quoted/discount, plan dates, `renewal_*`, `zoho_*`) and the leads import columns exist only in the hosted DB, not in repo migrations — `types.ts` is authoritative.
- `lead_activities` column is **`type`** (enum `activity_type`: note/call/email/whatsapp/stage_change/assignment/followup/created), not `activity_type`. `logActivity` in `leads/$id.tsx` swallows insert errors, so an invalid type (the existing `"reminder"` call) silently drops the row.
- TeleCMI table is **`telecmi_call_events`** (not `telecmi_calls`). The webhook writes BOTH that row and a `lead_activities` `type='call'` row → **never sum both**. Agent attribution matches `profiles.phone` (last 10 digits) — unset phones mean unattributed calls.
- `leads` has **no `assigned_at`**. `lead_stage` also has `irrelevant` (DB only, missing from generated types).
- `bookings.sales_agent_id` is nullable with no FK → fall back to `sales_agent_name` ↔ `profiles.full_name`. Revenue = `amount_after_tds || total_amount`; cash = `amount_received`. `booking_date` is a `date` column — filter with `YYYY-MM-DD`.
- `email_log` is not in generated types (cast to `any`).
- **RLS:** a sales rep only ever gets their own leads/bookings/activities (rows silently filtered, no error); `profiles` readable by all; `user_roles` own rows only. Team-wide views for reps need a `SECURITY DEFINER` RPC.

## 10. Open items — waiting on the owner (my recommendation in brackets)
1. **Reports "Closing %" > 100%** (Kishan 142%, Hardik 176%): numerator = bookings in period, denominator = leads `created_by` the rep in period. [Switch the denominator to `assigned_to`.] Not changed yet.
2. **Renewal identification:** 0/436 bookings have `renewal_status`. Ask how existing renewals are identifiable and point the Bookings filter at it. Also Hero of the Month + Sales Performance exclude renewals via `booking_source != 'Renewal'`, which misses renewals made through the renewal form. [Switch both to `renewal_status`.] Offered, not done.
3. **Plan-code friendly names** (`BR`, `GST`, …) — owner to supply the mapping. Top services also shows only the top 6.
4. **Productivity index** is relative; switch to absolute targets if the owner gives numbers.
5. **`profiles.phone`** unset → Calls show 0 for everyone; TeleCMI matching and the index's activity share depend on it.
6. Hero of the Month placement assumed "second, under the KPI strip" — owner didn't confirm vs very top.
7. Offered, not requested: reps' real team leaderboard (RPC); push to a closed browser (service worker + push backend); merging `/reports` and Sales Performance.
8. **Telephony:** owner was evaluating Exotel / MyOperator / Ozonetel for automatic call tracking and WhatsApp Business API (AiSensy/Wati/Interakt); call first, WhatsApp later. TeleCMI auto-logging (#112) exists; how much of that "phase" it covers is unresolved.

## 11. HRMS — attendance, leave, payroll (in progress)

### Owner's V1 blueprint — principles
- Built admin-only. **Employees never see any salary figure in V1** — no salary, basic, HRA, incentive amount, deductions, net, payslip, or anyone else's salary.
- Employees DO see what can affect pay: working days, present, paid/unpaid leave, leave balance, working hours vs required, late count, overtime, pending corrections, and a month-end **payroll-readiness checklist** — so nothing surprises them at payroll close.
- The sales team marks attendance themselves: **LOGIN / LOGOUT**, with time and working hours recorded.
- Geo-tagged: GPS + accuracy check + **server-side** geofence vs the office radius, registered device, an audit event for every attempt (including rejections + reason), and a security events dashboard.
- Also in scope: leave (types, balances, apply, approve → updates attendance), holidays, weekly offs, working hours, late policy (after start + grace), overtime, attendance corrections (original events retained), admin HR + attendance dashboards, salary structures, payroll engine (Gross + incentives + overtime − LOP − PF − ESI − other = net), sales incentives fed from CRM bookings, payroll run → approve → **lock**; post-lock changes only via adjustment + reason + audit.

### Decisions agreed with the owner
- **V1 roles: admin + employee only.** Manager approvals later, without touching the payroll engine.
- **Told to the owner:** a browser cannot reliably detect spoofed GPS (DevTools can fake coordinates). V1 = server-side geofence + accuracy limit + device registration + audit trail — a strong deterrent, not tamper-proof. Mock-location / Play Integrity needs a native app later.
- RLS is the real boundary; the sidebar hiding pages is cosmetic.
- Owner runs each migration himself (full SQL pasted in chat), then we merge.

### Phases
| Phase | Scope | Status |
|---|---|---|
| 1 | employees, departments, office location, HR settings, holidays + admin pages | ✅ #172 — migration applied, owner verified all 6 tables |
| 2 | attendance login/logout, geofence edge function, `attendance` + `attendance_events`, device registration, employee dashboard, admin attendance dashboard | ✅ #174 (+ #175 CI fix, #176 admin hub) |
| 3 | flexible schedules, WFH approval, leave (2/month, carry 1), CRM idle tracking | ✅ #177 (+ #178 per-function deploy with retries, #179 schedule hide/view) |
| 4 | attendance corrections + payroll readiness | — |
| 5 | salary structures, incentive rules (from bookings), payroll run + lock + adjustments | 🟡 salary structure + slips PR open — waiting on migration `20260516000008`; incentive rules from bookings not yet |

### Phase 1 as built (#172)
- Migration `supabase/migrations/20260516000005_hrms_phase1.sql`:
  - `departments` — seeded: Sales, Operations, Documentation, Accounts, Business Development, Renewals, Compliance, HR/Admin.
  - `office_locations` — lat/lng, `radius_m` (default 100), `max_accuracy_m` (default 50; vaguer GPS readings must be rejected).
  - `employees` — `profile_id` UNIQUE → profiles (the CRM login), code, names, contact, department, designation, reporting manager, joining date, CHECKed `employment_type` / `employment_status`, office, exit date.
  - `employee_private` — PAN / Aadhaar / bank / UAN / ESI. **Admin-only even for reads**; a separate table because RLS can't hide columns.
  - `hr_settings` — **singleton** (boolean PK): `work_start` 09:30, `grace_minutes` 15, `required_minutes` 510, `half_day_minutes` 240, `week_offs` `{0,6}` (0 = Sunday), `require_geofence` true, `require_device_approval` false.
  - `holidays` — company / optional / regional.
- RLS: reference tables readable by any signed-in user, admin-only writes; `employees` readable by admin or self (`profile_id = auth.uid()`); `employee_private` admin only.
- Pages (admin, `beforeLoad` guard): `/hrms/employees` (roster + add/edit + CRM login link), `/hrms/settings` (office geofence with "Use my location" using a fresh `maximumAge: 0` fix, working hours, week-offs, holidays).

### Owner setup TODO before Phase 2 (not yet confirmed done)
1. HR Settings → set the office location (press "Use my location" inside the office), check radius and timings.
2. Employees → add everyone and **link each to their CRM login** — attendance is recorded against the logged-in user via `employees.profile_id`.

### Phase 2 design (agreed direction)
- Punches go through a Supabase **edge function** using the service role. It resolves the employee from `auth.uid()` → `employees.profile_id`; loads the office + `hr_settings`; rejects if `accuracy > max_accuracy_m`; computes the haversine distance **server-side** and rejects if `> radius_m` (when `require_geofence`); checks the registered device when `require_device_approval`; writes an append-only `attendance_events` row for **every** attempt (success or rejection + reason, lat/lng/accuracy/distance/device/IP/UA); on success upserts `attendance` (one row per employee per date: login/logout time + coords, working minutes, status, late flag).
- The client never decides the verdict. Employees get SELECT on their own `attendance` / `attendance_events` only — no INSERT/UPDATE/DELETE; only the edge function writes.
- Late = login after `work_start + grace_minutes` (`lateAfter()` in `src/lib/hrms.ts`); half day below `half_day_minutes`; overtime beyond `required_minutes`; week-offs + holidays excluded from working days.
- Employee screens: today card (status, login time, running working time, LOGIN / LOGOUT button), month stats, calendar (✓ present, PL, UL, A absent, L late, ⚠ action needed, H holiday, – week-off). No salary anywhere.
- Admin screens: HR dashboard (present / on leave / absent / late today, security alerts), monthly attendance table per employee, security events list, device approvals.

### Phase 2 as built (PR "HRMS Phase 2 — geo-tagged attendance")
- Migration `20260516000006_hrms_phase2_attendance.sql`: `attendance_devices` (per employee + random
  browser `device_key`, status pending/approved/revoked), `attendance` (UNIQUE employee+`work_date`;
  `first_login_at`, `last_logout_at`, `open_since` = open session, accumulated `worked_minutes`, status
  in_progress/present/half_day, `is_late`/`late_minutes`, `overtime_minutes`, login/logout coords +
  distance), `attendance_events` (append-only audit of every attempt incl. `reason`, `client_error`,
  IP, UA). RLS: SELECT own/admin only; **no write policies** except admin UPDATE on devices.
- Edge fn `supabase/functions/attendance-punch` (JWT verified, service role) is the only writer.
  Order: linked employee → active → device (auto-registered; auto-approved while
  `require_device_approval` is off) → geofence (accuracy, then distance) → state transition with
  conditional updates (double-tap safe). Logout closes the latest open session (can span midnight),
  refused if older than 16h (`session_too_long` → Phase 4 correction). Re-login after logout reopens
  the day. Always HTTP 200 `{ok,reason,message}` for verdicts.
- Pure rules `src/lib/attendance-rules.ts` — **byte-identical** copy in
  `supabase/functions/_shared/attendance-rules.ts`, enforced by a test. IST via fixed +05:30.
  Late minutes count from `work_start` once past the grace. Half day = worked < `half_day_minutes`.
  Month view: past working day with no row = absent; today never absent; past open session =
  `action_needed`; work on week-off/holiday = all overtime; optional holidays are NOT days off.
- Pages: `/attendance` "My Attendance" (all roles; LOGIN/LOGOUT, month stats + calendar, recent
  punches; no salary anywhere) and admin `/hrms/attendance` (Today / Monthly / Security / Devices
  tabs). HR Settings got a "Require device approval" toggle.
- Not in Phase 2: leave (PL/UL markers arrive with Phase 3), corrections (Phase 4), push/cron
  auto-logout.

### Phase 3 as built (flex schedules, WFH, leave, idle)
- Owner policy (Sep 30 2026): Mon–Fri **flexible** 9h anywhere between 09:00–19:30; Saturday **fixed**
  10:00–17:00 mandatory; Sunday off. **2 leaves/month, max 1 unused carries forward.** WFH login
  must be emailed to the admin for approval. CRM idle ≥ 60 min while logged in is recorded.
- Migration `20260516000007_hrms_flex_leave_idle.sql`: `hr_settings.day_schedules` jsonb (index =
  weekday; `{mode off|flexible|fixed, start, end, required_minutes}`; `work_start` / `required_minutes`
  / `week_offs` are legacy), `idle_threshold_minutes`, `monthly_leave_quota`, `leave_carry_cap`,
  `leave_policy_start` (2026-10-01), `allow_remote_requests`. `attendance` gains schedule snapshot,
  `window_minutes` (only in-window time counts), `work_mode`/`remote_*`, `idle_minutes`,
  `last_activity_at`; status adds `short` (logged out early). New `attendance_idle_periods`,
  `leave_requests`, and SECURITY DEFINER RPC `attendance_heartbeat()`.
- Late: fixed = after start + grace; flexible = after `end − required` (10:30). Overtime only once the
  day is complete, then all logged time beyond required counts.
- WFH: outside-geofence/low-accuracy login → browser offers "Log in & request WFH" (reason required,
  fix required). Accepted immediately, `remote_status=pending`; counts only when approved; rejected =
  absent. WFH sessions log out without geofence. Re-login from home the same day continues WFH.
- Leave: `hr-requests` edge fn (apply/cancel by employee; decide_leave/decide_remote by admin). Paid vs
  unpaid is **derived** (`leaveLedger` + `summarizeMonth`), never stored. Half-day leave halves the day's
  requirement. Backdating limit 7 days.
- Idle: `src/components/activity-heartbeat.tsx` (mounted in `_authenticated.tsx`) pings the RPC at most
  every 2 min on real interaction; gap ≥ threshold → idle period. Idle is **recorded, not deducted**.
- Alerts: `_shared/hr-notify.ts` → in-CRM notification + Resend email (admins = `user_roles.admin`
  profile emails). Link target `/hrms/approvals` (new hub tab with pending count).

### Salary slips as built (Phase 5, part 1)
- Migration `20260516000008_hrms_salary_slips.sql`: `employee_salary` (monthly basic/HRA/conveyance/
  medical/special/other, PF & ESI flags, PT, TDS) and `salary_slips` (per employee per month; monthly
  incentive/bonus/other earnings, advance recovery, other deductions, TDS override, note; `status`
  draft|final; `snapshot` jsonb frozen at finalise). Trigger: final slips are immutable and undeletable
  except an explicit reopen to draft (stamps `reopened_at`). **Both tables admin-only incl. reads.**
- Maths `src/lib/payroll.ts` (+ tests): calendar-day basis, LOP = absent (incl. rejected WFH) + ½ per
  half day + unpaid leave (+ days outside employment); "left early" not deducted. PF 12% of earned basic
  capped at ₹15,000 wage; ESI 0.75% of earned gross if fixed gross ≤ ₹21,000. Amount in words (Indian).
- UI `/hrms/salary` hub tab: Salary slips (all slip columns, open-item warnings, adjustments dialog,
  print/PDF via `src/lib/salary-slip-html.ts`, finalise one/all, reopen) and Salary structure.
  Default month = previous month during the first 10 days. Employees still see no salary.
- Not yet: incentive rules fed from bookings (incentive is entered manually per slip).

### Mobile / installable app (PWA)
- `public/manifest.json` (PNG icons 192/512 + maskable, shortcuts Attendance/Leads/Follow-ups),
  `public/apple-touch-icon.png` (iOS ignores SVG), `public/sw.js` — **caches nothing on purpose**
  (stale-build risk); exists for installability and future push. Registered in `src/lib/pwa.ts`
  (imported for side effects in `__root.tsx`, prod only), which also captures `beforeinstallprompt`.
  Icons were generated from `favicon.svg` with sharp (node_modules).
- iOS status bar style is `default` (not black-translucent): pages don't pad for the notch.
- Phone nav (`MobileTabBar` in app-shell): Home · Attendance · Leads (Renewal Leads for renewals-only)
  · Follow-ups · **More** (bottom sheet with every page the user may open, search, install card,
  theme, sign out). Before this, phones could only reach 5 pages.
- Sandbox cannot run a dev server (tool refuses long-running processes), so mobile layouts are not
  visually verified here.

### Owner answers (30 Sep 2026)
- **Renewals:** a renewal booking's Booking ID (`external_booking_id`) ends in **R<n> = renewal year**
  (R1 first-year renewal, R2 second year, R3 third…); uploaded separately. Bookings list shows a
  "Renewal · Year n" badge (`renewalYear()`). `src/lib/booking-kind.ts#isRenewalBooking` = ID ends R<n>
  OR `booking_source = 'Renewal'` OR (no Booking ID AND `renewal_status in (renewed, pending_payment)`,
  i.e. the renewal form). Used by Bookings tabs, Hero of the Month / trend and Sales Performance.
  Resolves open item 2. The renewal pipeline also sets `renewed` on ORIGINAL bookings — that is why the
  status rule requires a missing Booking ID.
- **Plan codes:** BR = Business Registration, MA = Mailing Address, GST = GST (`PLAN_CODE_LABELS`).
  Resolves open item 3 for these three codes.
- **Salary slips:** stay admin-only. When an employee needs one, the admin **downloads** the finalised
  slip as a PDF and sends it himself (owner preferred download over in-CRM email). The `hr-requests`
  `email_salary_slip` action still exists but has no UI.

### Performance (Oct 2026)
- **Never export a component from a route file** (or import one from another route): TanStack's
  code-splitter then leaves the route unsplit and it lands in the entry chunk. `PipelinePage` and
  `RenewalDashboard` did exactly that (pipeline board + dnd-kit + day-picker in the entry); fixed —
  the renewal dashboard now lives in `src/components/renewals/renewal-dashboard.tsx` and the main
  Dashboard lazy-loads it. Entry chunk 943 KB → 716 KB (284 → 214 KB gzip).
- Route guards use `guardRoles()` (`src/lib/route-guard.ts`): `getSession()` (local) + roles cached in
  react-query for 5 min. The old `auth.getUser()` + `user_roles` ran on every navigation AND on hover
  preload (`defaultPreload: "intent"`).
- One shared unread-notifications query (`useUnreadCount`) for sidebar + phone tab bar.
- To measure bundles: temporarily add `vite: { build: { sourcemap: true } }` to vite.config, build, then
  `npx -y source-map-explorer dist/client/assets/index-*.js --json --no-border-checks`; revert the config.
- Not done yet: `/reports` still downloads whole tables client-side (and PostgREST caps each at 1000 rows).

### Documentation pipeline (Oct 2026)
- Owner's process: sales assigns booking → docs-required email → client KYC → team verifies + sends draft →
  client approves → team asks SP for final → SP final → forwarded for countersign → countersigned →
  Part B (NOC + utility bill) → completed. **TAT = 3 calendar days from assignment** (`app_settings`
  `doc_tat_days`; `doc_escalation_days` is now the "stuck in stage" alert, default 1).
- Migrations `20260520000001` (enum `final_requested`, alone — enum rule) + `20260520000002`:
  `documentation_tasks.due_at` (snapshotted at insert by trigger), `stage_changed_at`, `completed_at`;
  append-only `documentation_stage_events` (trigger-written, back-filled rows flagged `backfilled`);
  `notify_documentation_assignment` trigger → `notifications.type = 'doc_assigned'`; read policy on the
  two doc settings for all signed-in users (app_settings was admin-only).
- Maths: `src/lib/documentation.ts` (stages + waiting-on team/client/SP, TAT state, summaries, stage
  durations, trend). Data + mutations + assignee email: `src/lib/documentation-queries.ts`.
  UI: `src/components/documentation/*` (Overview · Pipeline board · List · Analytics · Settings, task
  sheet, "Assign booking" dialog). Doc-only users' dashboard reuses `DocOverview`.
- Assignment email goes from `team@easemyoffice.in` to the assignee's profile email via
  `send-client-email`, from the new-booking dialog and on re-assign.

---

# RAW SESSION LOG — session of 15–23 Oct 2026 (append-only, nothing above was edited)

Everything below is the full A–Z record of that session: what shipped, every SQL the owner ran,
every mistake I made, and what is still open. Read this with §0–§11 above.

## S1. Session setup facts
- Session was attached to **`varunattricollab98/easemyofficecollab98`** again — still EMPTY. Cloned
  `varunattricollab98/Easemyoffice` into `/projects/sandbox/Easemyoffice` and worked there.
- Baseline on arrival: `8683a6b` (#203). Full pipeline green: `npx tsc --noEmit` clean,
  **299 tests / 19 files**, `bun run build` ~13 s. PATH export needed:
  `export PATH="/root/.nvm/versions/node/v22.23.3/bin:$PATH"`.
- Owner's first message was literally "CRm?" — he was asking whether this repo is the CRM. Answer:
  yes. Do not propose building a new CRM.

## S2. Shipped PRs #204–#221 (all squash-merged, all deployed)

| PR | What |
|---|---|
| #204 | Documentation pipeline: 3-day TAT, stage history, admin analytics |
| #205 | `/documentation` lands on the Pipeline board (not Overview) |
| #206 | Pipeline board embedded on the documentation user's Dashboard |
| #207 | `attendance.remarks` + the 1–16 Oct attendance sheet import script |
| #208 | Bookings list "Documentation" column (owner · stage · TAT) + RLS so sales can read it |
| #209 | Every notification clickable (`src/lib/notification-links.ts`) |
| #210 | Admin can change a user's login email (manage-users `update_email`) |
| #211 | Booking date fix (stale draft) + admin edits update the Google Sheet row |
| #212 | A login left open on an earlier day no longer locks the person out |
| #213 | Forgot-to-logout no longer blocks the next day (UI side) |
| #214 | Location help dialog + faster app open on phones (`public/_headers`, sw caches `/assets/*`) |
| #215 | 3 failed punches per 15 min + Late login / WFH / Half day / Leave dialog |
| #216 | Real edge-function error text + auto session refresh on 401 |
| #217 | Reference-matched premium UI redesign (presentation only) |
| #218 | Design system applied to Hero of the Month, B2B screens, booking emails |
| #219 | Pipeline: show 10 / 20 / 25 / 50 / all leads per stage |
| #220 | Attendance: reliable location, stable devices, fake-GPS detection |
| #221 | Stuck spinner after deploys, `{}` login error, duplicate devices |

## S3. Documentation module (#204 → #208) — the owner's process, verbatim
Sales assigns the booking to a documentation person **and** emails the client the documents-required
list; the booking is also assigned to a space partner (SP). Client sends documents → documentation
team verifies KYC and sends the **draft agreement** → client approves the draft → team asks the
**SP to make the final agreement** → SP sends the final agreement for **countersign** → our team
forwards it to the client → client sends the countersigned copy → then **Part B**: supporting
documents (NOC + utility bill). **TAT = 3 days.**

### Stage enum (unchanged ids, new labels)
`assigned` Assigned · `docs_requested` Docs Requested · `docs_received` **KYC Verification** ·
`draft_shared` **Draft Sent** · `draft_approved` Draft Approved · **`final_requested` "With Space
Partner" (NEW)** · `agreement_shared` **Sent for Countersign** · `countersigned` Countersigned ·
`part_b_shared` Part B Sent · `completed` Completed.
Each stage carries `waitingOn: team | client | sp | done` — that drives the "waiting on" chips and
the "overdue files are waiting on" analytics.

### Code
- `src/lib/documentation.ts` — pure maths: stages, `tatState`, `summarizeDocs`, `attentionQueue`,
  `stageDurations`, `docTrend`, `perAssignee`, `periodFrom`, `DEFAULT_TAT_DAYS = 3`,
  `DEFAULT_STAGE_ALERT_DAYS = 1`.
- `src/lib/documentation-queries.ts` — all data + mutations + `emailDocAssignee()` +
  `useBookingDocTasks()` (used by the Bookings column).
- `src/components/documentation/*` — `doc-workspace` (tabs), `doc-board`, `doc-overview`,
  `doc-list`, `doc-analytics`, `doc-settings`, `doc-task-sheet`, `doc-assign-dialog`, `doc-ui`,
  `doc-format` (non-component helpers, kept separate for fast refresh), `booking-doc-status`.
- Tabs: non-admin sees **Pipeline, List**; admin also sees **Overview, Analytics, Settings**. The
  board is the landing view. Documentation-only users get `DocOverview` on their Dashboard with the
  full board passed into its `board` slot.
- Settings keys in `app_settings`: **`doc_tat_days`** (default 3) and **`doc_escalation_days`**
  (reused as the "stuck in stage" alert, default 1).
- `command-center-queries.ts` now passes `DEFAULT_TAT_DAYS` (was 7).

### Migrations the owner RAN (all confirmed by him)
1. `20260520000001_doc_stage_final_requested.sql` — `ALTER TYPE ... ADD VALUE IF NOT EXISTS
   'final_requested' AFTER 'draft_approved'`. Must be alone in its own statement/transaction.
2. `20260520000002_documentation_pipeline.sql` — `due_at` (TAT snapshot at insert),
   `stage_changed_at`, `completed_at`; `documentation_stage_events` (append-only, trigger-written,
   back-filled rows flagged `backfilled`); `doc_tat_days()`; `documentation_tasks_track_stage`
   (BEFORE trigger, clients cannot rewrite the timestamps); `documentation_tasks_log_stage`;
   `notify_documentation_assignment` → `notifications.type = 'doc_assigned'`; RLS on
   `documentation_stage_events`; `app_settings_read_doc_settings` policy (app_settings was
   admin-only, so documentation users always saw default settings).
3. `20260520000004_doc_tasks_visible_to_booking_owner.sql` — SELECT policy so `assigned_by` and the
   booking's `assigned_to`/`created_by` can READ the documentation task + its history. Writes
   unchanged (admin / assignee only).

**ERROR THE OWNER HIT (remember this):** the back-fill `UNION ALL` failed with
`42804 column "from_stage" is of type doc_task_stage but expression is of type text`. In a UNION the
bare `NULL` / `'assigned'` literals resolve to text. Fix: `NULL::public.doc_task_stage`,
`'assigned'::public.doc_task_stage`, `NULL::uuid`.

**He could not copy one huge SQL block from chat.** Splitting it into **3A (columns + history table
+ back-fill), 3B (functions + triggers), 3C (RLS)** worked. Do that for any long SQL, and also point
at the raw file on GitHub (`Copy raw file`).

## S4. Attendance import for 1–16 Oct 2026 (#207)
- `setup/IMPORT_ATTENDANCE_2026_10_01_16.sql` — one transaction, idempotent, driven by a TEMP table
  of the owner's sheet. Mirrors `writeManualAttendance` exactly (schedule snapshot, `lateMinutes`,
  `windowMinutes`, `closeDay`, `entry_source = 'admin_bulk'`).
  Present → attendance row · Leave → **approved `leave_requests`** · WFH → `work_mode='remote'` +
  `remote_status='approved'` · holiday/Sunday → nothing. Aborts if a first name does not match
  exactly one employee. Existing rows are never overwritten.
- Verified against **PGlite** with the real constraints: **68 attendance rows, 9 leave days, 1
  holiday**; a second run adds nothing; the duplicate-name guard aborts with 0 rows.
- Also added **`attendance.remarks`** (`20260520000003`) and a **Remarks column in the Daily log**
  (`DailyLog` in `attendance-month.tsx`, read through the existing `select("*")`).
- Sheet quirks handled: logout `"06:41"` for Anchal 7 Oct read as **18:41**; `""`/`"Missed"`/
  `"holiday"` logouts → login-only row ("Logout missing"); **2 Oct = Gandhi Jayanti** inserted as a
  company holiday; today's rows left `open_since` set so staff could press LOGOUT normally.
- Follow-up SQL the owner ran:
  - **Hardik 15 Oct** was missing from the sheet → inserted 10:25 → 19:01 (516 min, `short`,
    flexible 09:00–19:30 / 540, remark "Missing in sheet; times confirmed by admin").
  - **"Missed punch out"** remark on the 4 open days: Anchal 1 Oct, Sarthak 1 + 6 Oct, Hardik 9 Oct.
    (Owner's words: "Logout times main missed punch out daaldo".)
  - **Garima** — "she left long ago" → `employment_status='resigned'`, `exit_date='2026-09-30'`.
- Kishan had **7 leaves in October** → 2 paid, 5 unpaid by the policy. Flagged to the owner.

## S5. WhatsApp messages (owner asked for them, then "in english casual")
Individual login messages were sent for Pooja Malik, Anchal, Kishan, Neha Singh, Neha Singh R,
Khushi Goyal, Sahil (Hardik + Sarthak skipped on his instruction). Password pattern
**`Firstname@123`**. Group message covered: sales/renewals log daily activity on their dashboard,
documentation checks pending docs + 3-day TAT, B2B checks leads/pipeline, and **attendance is now
tracked only in the CRM with 1–16 Oct already uploaded**.

## S6. Attendance reliability saga (#212, #213, #214, #215, #216, #220, #221)
The owner reported, in this order:
1. "Your last login is too old to close automatically" on one profile → **#212**: a session left open
   on an earlier IST day and older than `MAX_SESSION_MINUTES` (16 h) is closed server-side as a
   missed punch out (`open_since` cleared, no logout time, remark "Missed punch out"), new reason
   **`stale_session_closed`**.
2. Same error still shown to others → **#213**: `TodayCard` and `QuickPunch` now **ignore** a stale
   open session, so the button shows LOGIN instead of a failing LOGOUT.
3. Chrome denying location on laptops → **#214**: `useLocationGate()`
   (`src/components/hrms/location-gate.tsx`) + `src/lib/location-access.ts`. Takes the fix first;
   on failure shows device-specific steps (Chrome/Edge address bar, Windows/macOS/Android/iOS system
   location, Wi-Fi tip on timeout), retries on "Try again" **and automatically** via the Permissions
   API `change` event. "Continue without location" keeps the old behaviour.
4. 20+ "device not approved" rows from Hardik in one minute → **#215**: `MAX_PUNCH_ATTEMPTS = 3` per
   `PUNCH_ATTEMPT_WINDOW_MINUTES = 15`; every rejection returns `attempts_left`; past the limit the
   punch is refused as **`too_many_attempts` without writing another audit row**. WFH logins exempt.
   Same PR replaced the WFH-only popup with **Late login / Work from home / Half day / Leave**, each
   requiring a reason (`useLoginOptions` in `src/components/hrms/login-options.tsx`). Late login
   stores `remarks = "Late login: <reason>"` via the new `late_reason` punch field; a refused login
   files a `missed_login_regularization` request instead.
5. "Edge Function returned a non-2xx status code" on Sahil's dashboard → **#216**:
   `src/lib/edge-functions.ts` `invokeFunction()` reads the real body from `error.context` and
   refreshes the session once on 401. supabase-js hides the function's message behind that generic
   string.
6. **"Every single employee is facing issue"** → **#220**:
   - `readPosition()` now **watches** for up to 9 s and keeps the most accurate reading (early exit
     at ≤25 m with ≥2 readings); falls back to `enableHighAccuracy:false, maximumAge:30s` when
     high-accuracy mode fails (laptops). Sends `fix_samples`, `fix_spread_m`, `fix_timestamp`.
   - **In-app browser detection** (`isInAppBrowser()`): WhatsApp / Instagram / FBAN / LinkedIn /
     GSA / Snapchat / Twitter / Android `; wv)`. Those browsers cannot share location and lose
     storage — a likely cause of the daily "new device". Dialog tells the user to open in Chrome.
   - Device key mirrored in a **2-year `emo_dk` cookie**; each store restores the other.
   - **`deviceFingerprint()`** — platform + UA-CH model + screen/DPR + timezone + CPU + memory +
     WebGL renderer, SHA-256 truncated to 16 hex. Sent as `device_fp`.
   - **`spoofSignals()`** in both byte-identical rule copies. **Block** (`location_suspicious`):
     `low_precision` (both lat and lng ≤4 decimals = hand-typed) and `impossible_travel`
     (>`MAX_TRAVEL_KMH = 300` over >`MIN_TRAVEL_CHECK_M = 20 km` since the last accepted punch).
     **Warn only:** `exact_repeat` (same lat/lng as an earlier day **and** accuracy ≤30 m, so laptop
     Wi-Fi repeats are ignored), `frozen_fix` (≥3 samples, zero spread, ≤15 m), `too_precise`
     (<1 m), `stale_fix` (>5 min old). Tokens stored on the event as `suspect_*`; admins alerted
     with **`hr_spoof_suspect`** (alert fires on any block, ≥2 warnings, or any warning other than
     `exact_repeat` alone).
   - Migration **`20260521000001_attendance_device_fingerprint.sql`** — `attendance_devices.fingerprint`
     + partial index. **Owner RAN it.** Verified `with_fingerprint = 0` right after, which is
     expected: it fills in on each device's next punch.
7. **Screenshots of real failures** (stuck spinner on the home-screen app, `{}` under Sign in,
   "GPS reading is too imprecise", "Allow location", Khushi with 4 approved devices) → **#221**:
   - **Stale build = the real cause of the spinner.** I merged #214–#220 between **10:55 and 11:39
     IST**, inside the morning punch window. An app already open keeps the old build and its lazy
     page chunks 404 after a deploy (confirmed: old `index-*.js` now returns 404). Fix: listen for
     `vite:preloadError`, dynamic-import `unhandledrejection` and window errors (plus the root
     `DefaultCatchBoundary`) and **reload once**, with a 30 s `sessionStorage` guard against loops
     (`reloadForNewBuild()` / `STALE_CHUNK` exported from `src/lib/pwa.ts`).
   - **`{}` on Sign in** = supabase-js `AuthRetryableFetchError` (`JSON.stringify(Response)`), i.e. a
     network drop or 502/503/504/52x from the auth server (`auth-js/lib/fetch.js` lists those
     codes). `login.tsx` now retries twice (1.5 s, 3.5 s) and otherwise says "Could not reach the
     login server…". **Supabase logs were never checked — no dashboard access from the sandbox.**
   - **Duplicate devices:** an unknown key whose fingerprint matches **any** existing row of the
     same employee now **moves that row to the new key** (same status) instead of inserting another.
   - Steering gained: **never merge 09:00–11:30 IST on working days.**

### Owner's final attendance decisions (23 Oct)
- **Attendance is phone-only.** Do NOT raise `office_locations.max_accuracy_m` (still 50 m); laptop
  Wi-Fi fixes of ±2000 m are expected to fail and that is accepted.
- **Khushi's older duplicate device stays approved** — do not delete it.

## S7. UI redesign (#217, #218) — the design system now in force
Owner's brief: match four reference screenshots (premium dashboard, royal-blue CRM pipeline,
activity timeline, executive analytics), presentation only, nothing else may change.

Tokens in `src/styles.css` (light; a dark set mirrors them):
`--background #F5F6FA` · `--card #FFFFFF` · `--foreground #191B2A` · `--muted-foreground #6B7280` ·
`--border #E6E8EF` · `--primary #315EFB` · `--brand-indigo #3730A3` · `--brand-bright #4385F5` ·
`--accent #EEF0FF` · `--success #16835B` · `--warning #B7791F` · `--destructive #DC4545` ·
`--chart-1..5` now defined · `--shadow-xs/soft/elevated/pop` · `--gradient-brand` ·
`--ease-out`. Motion is 150–180 ms.
- `--gradient-brand` is used **only** for primary buttons, the selected-nav marker, the logo tile and
  the login panel. **Pipeline column headers use a lighter gradient** —
  `.pipeline-col-head { background: linear-gradient(135deg,#4385f5,#5b6cf0) }` — because the owner
  said the brand gradient was "thode jyada dark". He approved the lighter one.
- **New desktop top bar `AppHeader`** in `app-shell.tsx` (mounted in `_authenticated.tsx`): page
  breadcrumb, search (⌘K palette), theme toggle, notifications bell with unread dot, profile. The
  sidebar is white with a "Main menu" label and a soft-indigo active pill with a gradient marker.
- Primitives restyled: table header band + roomier rows, pill badges with `success/warning/info/solid`
  variants, shimmer skeletons (`.skeleton-shimmer`), `rounded-xl` menus/popovers/sheets/toasts with
  `--shadow-pop`, ink tooltips, gradient primary button, `rounded-xl` cards.
- `src/components/activity-timeline.tsx` — `ActivityTimeline` + `LeadActivityTimeline`: one icon tile
  per activity type, connector line, time/date column. Same rows and order as before.
- #218 ran a **codemod** mapping Tailwind palette classes to tokens (amber/orange/yellow→warning,
  emerald/green/lime→success, rose/red/pink→destructive, blue/sky/indigo→primary,
  violet/purple/fuchsia→accent-foreground, teal/cyan→info) across Hero of the Month, dashboard
  widgets, admin-command-center and 16 B2B files, plus a hex map for
  `payment-ack-email.ts` (126), `email-signature.ts` (31), `new-booking-dialog.tsx` (8). Gold accents
  and WhatsApp green kept.

## S8. Other features this session
- **#208 Bookings "Documentation" column** — assignee name, stage badge, TAT chip, links to the file;
  "Not assigned" otherwise. Needed the RLS migration or sales would always see "Not assigned".
- **#209 clickable notifications** — `notificationLink()` routes by `lead_id` → `task_id` → `type`:
  `hr_leave_request`/`hr_remote_request`/`hr_attendance_request` → `/hrms/approvals`,
  `hr_shared_device`/`hr_spoof_suspect` → `/hrms/attendance`, `hr_*_decision` → `/attendance`,
  `doc_assigned` → `/documentation`, calls → `/calls`, `new_lead_unclaimed` → `/inbox`,
  any other `hr_*` → `/attendance`. Opening an unread alert marks it read; the body is shown.
- **#210 change login email** — `manage-users` action `update_email` (admin only, protected owner
  account blocked, `email_confirm: true`, updates `profiles.email` and the linked employee's work
  email only when it was blank or equal to the old login). UI: pencil on the Team page and under
  "CRM Login" in the employee dialog (`src/components/admin/change-login-email.tsx`).
- **#211 booking date + sheet edits** —
  - Cause of a booking saved as 28 Sep: the New Booking form restores a `localStorage` draft
    (`emo:new-booking-draft:<user>`) and reused its **old date**. Drafts now store `savedOn`; a
    stale draft keeps its fields but resets booking + plan start dates to today. `todayISO()` now
    uses the **local (IST)** date, not `toISOString()` (UTC), and `makeInitialForm()` refreshes
    `plan_start_date` too.
  - Admin **Save changes** now overwrites the booking's existing sheet row: `bookingSheetValues()` +
    `updateBookingInSheet()` in `bookings-sheet.ts`, `sync-booking-to-sheet` forwards
    `{action:"update", booking_id}`, and `setup/apps-script-code.gs` gained `updateRow()` (finds the
    "Booking ID" column by header, falls back to column C, rewrites the last match, **never
    appends**). The Bookings button reads "Edit" for admins.
  - **⚠ STILL PENDING: the owner has NOT confirmed pasting the updated Apps Script + deploying a new
    version.** Until he does, an admin edit on the old script would APPEND a duplicate sheet row.
- **#219 pipeline leads-per-stage** — select "Show 10 / 20 / 25 / 50 leads" or "Show all"; default 25,
  stored in `localStorage` as `emo:pipeline-per-stage`; applied per column after search/interest/
  overdue; header count stays the full total; "Show N more · X hidden" button adds another page.
  New Lead had 477 cards.

## S9. MISTAKES I MADE — do not repeat
1. **Merged 7 PRs during the morning punch window (10:55–11:39 IST)** and broke attendance for the
   whole team. Rule now in steering: **no merges 09:00–11:30 IST on working days**; check with
   `TZ=Asia/Kolkata date` before every merge.
2. **Verified only tsc/tests/build and called the attendance work done.** The owner's real devices
   failed on day one. Say plainly what was NOT tested, and prefer the preview URL.
3. **Overwrote `kpi-tile.tsx` with `fs_write` before reading it**, silently dropping its props
   (`icon`, `pulse`, `eventName`) and the `track()` analytics call. Restored with `git checkout --`
   and redid the change as presentation-only edits. **Never write a file you have not read.**
4. **Codemod opacity bug:** `bg-amber-50/60` became `bg-warning/60` (a strong wash). Fixed by routing
   shades ≤200 with an explicit alpha through the tint table instead.
5. **A `node -e` replacement landed in the wrong block** in `notifications.tsx` (the sample-cards
   branch, where `i` does not exist) and broke the build. Anchor replacements on unique text.
6. **Shell quoting:** apostrophes in commit/PR bodies (`owner's`) broke `node -e` heredocs. Write the
   script to a file under `/projects/sandbox/` and run it, or use `'"'"'` in `gh api -f body=`.
7. **Left the first premium-theme attempt too subtle** — the owner could not see a difference and
   asked "Change kyaa kiyaa?". For a visual ask, change the shell (sidebar/header/columns), not just
   tokens.

## S10. Sandbox / tooling notes learned here
- **Cloudflare PR builds publish preview URLs** — read them from the check-run summary:
  `gh api repos/.../commits/<sha>/check-runs --jq '.check_runs[] | select(.name|test("Workers")) |
  .output.summary'` → `Preview URL: https://<hash>-easemyoffice.emo-crm.workers.dev` and
  `https://<branch>-easemyoffice.emo-crm.workers.dev`. **Use these to show the owner UI before
  merging** — that is how #217 was approved.
- **Playwright can screenshot logged-in pages** by injecting a fake Supabase session with
  `ctx.addInitScript` (key `sb-cfzwdlibvxksrxcrsvpp-auth-token`) and mocking
  `**/cfzwdlibvxksrxcrsvpp.supabase.co/**` with `ctx.route` (return `[]` by default, the profile and
  `user_roles` for auth, `vnd.pgrst.object` → single object, abort `/realtime/`). Screenshots land in
  `/projects/sandbox/.kiro/artifacts/screenshots/`.
- `browser_run_code_unsafe` runs in a **Node vm without `Buffer`, `btoa` or dynamic `import`**.
  Precompute JWTs/base64 in a shell step, or pass a `filename` whose script embeds the data.
- `file://` and a local `http.server` are **not reachable** from that browser — render HTML with
  `page.setContent()` from a generated `.js` script file instead (that is how the payment email was
  checked).
- **PGlite** (`npm i @electric-sql/pglite`) is a good way to test migrations and one-off SQL against
  the real constraints before the owner runs anything.
- `/tmp` is not writable; `diff` is missing. Scratch files go under `/projects/sandbox/<name>` and
  get deleted.
- Keep shell commands under ~5 minutes; never chain "open PR → wait for CI → merge → verify deploy"
  into one silent command. Send a one-line chat update between steps.

## S11. OPEN ITEMS after this session
1. **Apps Script (#211) not confirmed deployed.** Owner must paste the new `doPost` + `updateRow()`
   from `setup/apps-script-code.gs` into the Sheet's Apps Script and Deploy → New version. Until
   then admin booking edits append duplicate rows. **Ask him.**
2. **Device fingerprints fill in on each device's next punch.** Some people may need one final
   device approval. Watch the Devices tab for a day.
3. **Sahil Yadav may have no `employees` record** (flagged when his dashboard errored, never
   confirmed). Without one he cannot mark attendance.
4. **Pooja Malik and Neha Singh R log in with personal Gmail addresses**
   (`varunattri980@gmail.com`, `varunattri3245@gmail.com`). The documentation assignment email goes
   to that address. #210 added the UI to change it.
5. **`{}` login failures** — the Supabase side was never inspected. If they recur, check the Supabase
   dashboard for auth errors / rate limits around 09:00–10:30 IST.
6. **Verify the morning after any attendance change** — ask the owner how the 9–10:30 window went.
7. Laptop attendance stays unsupported by decision (phone-only, 50 m accuracy limit unchanged).
8. Earlier open items in §10 above are untouched and still apply (Reports "Closing %", productivity
   index, `profiles.phone`, telephony evaluation).

## S12. How the owner wants to work (reconfirmed repeatedly this session)
- **Short Hinglish replies.** No option menus, no recaps, no tables he can read in the PR.
- He wants work **batched**: "Bhai kar he dete naa ek saath hi?" when I offered a follow-up round.
  Finish the whole ask in one go.
- **He wants to SEE it before merge** for anything visual — give the preview URL and screenshots.
- SQL must be **pasted inline in chat**, split into small runnable blocks, with a verification query.
- Merge my own green PRs without asking — except during the 09:00–11:30 IST window.
- "Save" = commit this memory and **keep working in the same session**; only start a new session when
  he asks (he asked at the end of this one).

---

# RAW SESSION LOG — session of 23 Oct 2026 (append-only, nothing above was edited)

## T1. Session setup
- Session was attached to **`varunattricollab98/easemyofficecollab98`** again — still EMPTY. Cloned
  `varunattricollab98/Easemyoffice` into `/projects/sandbox/Easemyoffice`.
- Baseline on arrival: `f8362e5` (#222). Pipeline green: tsc clean, **299 tests / 19 files**,
  build ~12 s. Node has drifted to **v22.23.4**:
  `export PATH="/root/.nvm/versions/node/v22.23.4/bin:$PATH"`.
- Owner's opening question was again "ye CRM hai?" — yes. Do not propose building a new CRM.

## T2. Shipped PRs #223–#226 (all squash-merged, all deployed)

| PR | What |
|---|---|
| #223 | Tests for every October failure path (299 → 404 tests) |
| #224 | Stable device fingerprint — the same phone stops looking like a new device |
| #225 | No full day after 11:30 + logout reminder at 19:30 |
| #226 | The 11:30 cut-off applies on Saturday too (was 11:15) |

### #223 — the tests that were missing
Every failure that broke attendance in October lived in code with **zero tests**, while tsc, the
unit suite and the build were all green. Added 105 tests:
- `attendance-client.test.ts` — device key localStorage/cookie mirroring, `ephemeral` fallback,
  `readPosition` (watch, early exit, coarse fallback, no retry after denial), punch body.
- `pwa.test.ts` — `STALE_CHUNK` pinned to the real Chrome/Firefox/Safari/Vite wordings and
  asserted NOT to match ordinary errors; reload-once + 30 s loop guard on all three channels.
- `edge-functions.test.ts` — real message out of `error.context`; one session refresh on 401.
- `location-access.test.ts` — in-app browser detection, granted-but-refused vs blocked.
- `attendance-rules.test.ts` — `spoofSignals` + `decimalPlaces` (shipped untested in #220).
- Extracted the sign-in retry out of `login.tsx` into **`src/lib/auth-errors.ts`**
  (`isRetryableAuthError`, `authErrorMessage`, `signInWithRetry`) so the `{}` bug has tests.

### #224 — device fingerprint was unstable (REAL BUG, found by writing the tests)
`deviceFingerprint()` used `screen.width x screen.height @ devicePixelRatio`. All three move on the
same device: **screen.width/height SWAP when an Android phone rotates**, and page zoom raises
`devicePixelRatio` while shrinking the CSS dimensions
([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio)). A landscape or
zoomed punch therefore produced a new fingerprint → unknown hardware → with approval ON it was
refused. #221's dedupe could never work because the key it matched on was unstable.
- Now uses the **physical** size: CSS dimensions × ratio (cancels zoom), sorted (cancels rotation),
  rounded to 10 px (absorbs noise like 412 × 2.625 = 1081.5).
- `deviceFingerprints()` returns `{ fp, legacy }`; the client sends **`device_fp_legacy`** too and
  `attendance-punch` looks a device up by **either**, then moves the row onto the stable value.
  **Nobody re-approves anything.** Needed because `require_device_approval` is **ON** (see T4).
- Proof the tests are worth something: reverting `screenSignature()` to the old formula makes
  **4 of them fail**.

### #225 / #226 — late login and the logout nudge
- **Half-day cut-off:** `LATE_LOGIN_CUTOFF_MINUTES` = flat **11:30 on every working day** (#226
  corrected #225, which derived it and gave 11:15 on Saturday). Past it the dialog **drops the
  "Late login" tile**, defaults to **Half day**, and is titled "Too late for a full day". Applies
  to a refused login too. Off days never bind.
  - The arithmetic: the flexible window closes 19:30 and needs 9h, so nothing started after 10:30
    can complete it; 11:30 is the hour of leeway. A test asserts `closeDay` can only reach `short`
    from 11:30.
  - **Deliberately flat so the grace cannot move it.** `grace_minutes` is a single global setting
    whose only effect is on fixed days (a flexible day derives its start from the window). Owner
    wants **Saturday strict with no grace** → that is **HR Settings → Office & Hours → grace = 0**,
    no code change, and it will NOT drag the cut-off back to 11:00.
- **Logout reminder:** new edge fn **`attendance-logout-reminder`**. Finds today's open sessions
  and sends the employee bell + desktop alert + email ("You are still logged in"). Refuses to run
  before the day's window closes (unless `force: true`), and sends **at most one per person per
  day** (checks for an existing `hr_logout_reminder` since IST midnight). Resigned employees and
  unlinked logins skipped. `hr_logout_reminder` routed to `/attendance`.
  - Cron: **`setup/ADD_LOGOUT_REMINDER_CRON.sql`**, `0 14 * * *` = 19:30 IST. **Owner RAN it** —
    `cron.schedule` returned job id **22**, verified `active = true`.
  - ⚠ He ran the SQL BEFORE the merge, so the function did not exist yet; merged straight after.

## T3. Live testing on the deployed app (the gap from the last session's mistake #2)
The sandbox **can** reach the live app and Supabase, and the Playwright power drives a real browser.
This is now the way to verify, not just tsc/tests/build.

- **Login `{}` fix verified live:** wrong password on `easemyoffice.emo-crm.workers.dev` showed
  **"Invalid login credentials"** (not `{}`) with **exactly one** `auth/v1/token` request — proving
  a credential error is not retried.
- **Reading a logged-in page live:** inject nothing, just sign in with Playwright; `/attendance`
  rendered clean (no stuck spinner, no console errors).
- **The punch round trip, read off the wire** (this is how to check the client is really deployed):
  ```json
  {"action":"login","device_key":"…","device_label":"Chrome on Linux",
   "device_fp":"21cd78a4…","device_fp_legacy":"15e9e1e6…",
   "latitude":28.704061,"longitude":77.102493,"accuracy":30,
   "fix_samples":1,"fix_spread_m":0,"late_reason":"…"}
  → {"ok":false,"reason":"device_not_approved",
     "message":"This device is waiting for admin approval…","attempts_left":2}
  ```
- **`attendance-logout-reminder` verified live without side effects:** call it with the right
  secret and NO `force` → `{"ok":true,"skipped":"the working window has not closed yet",
  "now":"13:34","window_end":"19:30"}`; wrong secret → 401. **Never call it with `force: true`
  during the day** — that would tell the whole team to log out.
- Useful values (anon key is public, it ships in the client bundle): project ref
  `cfzwdlibvxksrxcrsvpp`, `CRON_SECRET` = `emo-cron-5034`.

## T4. Facts established this session
- **`require_device_approval` is ON.** Proven by the live `device_not_approved` verdict. This is
  why #224 needed the legacy-fingerprint fallback.
- **Attempt limit works:** the UI showed "(2 of 3 attempts left)" inline, 3 per 15 minutes.
- **Owner's test account is `varunattri3245@gmail.com` / `Test@123` — the "Neha Singh R" login.**
  He says it is not in real use and was created for testing. It IS linked to an employee record and
  carries real-looking October attendance (8, 9, 12 Oct punches), so anything punched there lands in
  that employee's month. Ask before writing to it.
- **Real-phone punch verified (owner's own test, read back from the server):** distances
  **11, 14, 15, 16, 19 m** from the office across six accepted punches — varying, i.e. genuine GPS
  rather than a frozen fix — all inside the radius, **zero spoof flags**, login→logout→login cycles
  clean. First time the #220 location work was confirmed on a real device.
- **Same-day re-login shows no late popup, and the owner confirmed that is correct.** The dialog is
  gated on `!row` (first login of the day only).

## T5. MISTAKES I MADE — do not repeat
1. **Merged #224 before confirming the check-runs.** I sent the "wait for CI" and the merge in the
   same parallel batch, so the merge went out before I had read the result. They happened to be
   green and I verified main afterwards, but the rule is: read the check-runs, THEN merge.
2. **Was handed `varunattri3245@gmail.com` as a "dummy account" and nearly punched with it.**
   Checking the session first showed `full_name: "Neha Singh R"` with real attendance history. Always
   confirm who an account belongs to (session JSON / dashboard greeting) before writing data.
3. Used wrong signatures from memory (`windowMinutes`, `closeDay`) and wrote a test that threw —
   read the signature, do not assume it.

## T6. New finding, NOT yet fixed — login before hydration does nothing
Filling the login form and pressing **Sign in** immediately after a cold page load did **nothing**:
the URL became `/login?`, i.e. the browser did a **native GET form submit** because React had not
hydrated yet, so `onSubmit`/`preventDefault` never ran. Waiting ~3 s and it worked.
- Real-world window is narrow (typing takes seconds) but **right after a deploy on a slow phone** it
  is reachable, and it looks exactly like "login does nothing".
- Recommended fix: keep the Sign in button disabled until the component has mounted. **Offered to
  the owner, not yet approved.**

## T7. OPEN / QUEUED WORK
1. **IN PROGRESS — punch speed + geofence strictness.** Owner: "login/logout 8–9 second le raha
   hai … quick hona chahiye location fetch ke saath, location precise honi chahiye, aur apne 50 m
   area ke bahar se login/logout hona hi nahi chahiye, geofencing ka error dikhana chahiye."
   - Client cost: `readPosition()` watches for **`SAMPLE_WINDOW_MS = 9000`** and only exits early
     on `accuracy <= GOOD_ENOUGH_M (25)` **and** `readings >= 2`.
   - Server cost: the live punch POST took **6.2 s**. `attendance-punch` runs ~10 sequential
     queries (employee → attempt count → hr_settings → office → device lookup + 2 updates →
     shared-device check → open row → write), most of which are independent and could be
     parallelised.
   - Open question put to the owner: outside the office the verdict is `outside_geofence`, which is
     in `REMOTE_ELIGIBLE`, so the reply carries `remote_allowed: true` and the dialog still offers
     **Work from home**. Does he want that escape REMOVED (pure error) or kept? WFH was his own
     #215 feature, so do not remove it without a clear yes.
   - Note: the "50 m" is a setting he controls — `office_locations.radius_m` (HR Settings → Office
     & Hours), separate from `max_accuracy_m` (also 50, the GPS-precision limit). He decided on
     23 Oct that attendance is **phone-only** and `max_accuracy_m` stays 50.
2. **QUEUED, TO DO LAST — multiple email recipients + CC/BCC (owner asked for this explicitly to be
   remembered and done after the attendance work):**
   - Payment acknowledgment currently sends to **one** email only.
   - Add **"Add new email"** plus **CC / BCC / normal send** options to the **lead**, **booking**
     and **payment acknowledgment** forms, so a client with several addresses can be covered —
     "baaki saare forms mein bhi".
   - The **alternate email captured on New Booking must also save to the Google Sheet.**
   - Relevant files to start from: `src/components/send-quotation-dialog.tsx`,
     `src/components/dashboard/new-booking-dialog.tsx`, `src/lib/payment-ack-email.ts`,
     `src/lib/bookings-sheet.ts` (`bookingSheetValues`, `updateBookingInSheet`) and
     `setup/apps-script-code.gs`. Bookings already have two alternative contact numbers (#?) —
     mirror that shape for emails.
3. **Apps Script (#211) STILL not confirmed deployed** — carried over from the previous session.
   Until the owner pastes the new `doPost` + `updateRow()` from `setup/apps-script-code.gs` and
   deploys a new version, an admin booking edit APPENDS a duplicate sheet row.
4. **Clean-up owed:** a pending device **"Chrome on Linux"** was registered under the test employee
   by my sandbox browser — the owner should revoke/delete it in Staff & Attendance → Attendance →
   Devices.
5. Earlier open items in §10 and S11 above are untouched and still apply.

## T8. Owner preferences reconfirmed
- Short Hinglish. No option menus. One recommendation.
- **Verify on the live app, not just in CI** — and say plainly what was NOT tested.
- Do not merge 09:00–11:30 IST. Also avoid merging while he is mid live-test on his phone: a deploy
  makes an open app reload.
- SQL inline in chat, small runnable blocks, with a verification query.
- "Save" = commit this memory and **keep working in the same session**.

---

# RAW SESSION LOG — 23 Oct 2026, part 2 (append-only; T1–T8 above untouched)

Continues from T1–T8. That section was written mid-session and committed as #227; this covers
everything after it.

## U1. Shipped PRs #227–#230 (all squash-merged, all deployed)

| PR | Main SHA | What |
|---|---|---|
| #227 | `4c65b89` | The T1–T8 session log above |
| #228 | `f62a9c7` | Punch speed: GPS early-exit + 5 server queries → 1 round trip |
| #229 | `7bc9869` | Outside the office never creates attendance; WFH becomes an application; login button disabled until hydrated |
| #230 | `cc19346` | Multiple email recipients with CC/BCC; `alt_email` columns; sheet column 41 |

## U2. #228 — punch speed, and why the numbers are misleading
Owner: a punch took **8–9 s**.

**What I measured on the live app:** the punch POST alone took **6.2 s**, while the same edge
infrastructure answered a 2-query function in **~1.0 s** (timed `attendance-logout-reminder` three
times: 0.98 / 1.02 / 1.20). So the cost was **waiting in series**, not work.

**Client** — `readPosition` settled on the first reading good enough instead of sitting out the
window:
- `accuracy <= GOOD_ENOUGH_M (25)` → used **immediately**. It used to need a second reading to rule
  out a cached fix, but `maximumAge: 0` already forbids one, so the wait bought nothing.
- 25–50 m → one more reading, keeps the better.
- vaguer → keeps sampling (the server would reject it anyway).
- `SAMPLE_WINDOW_MS` **9000 → 4000**; coarse laptop fallback **15000 → 8000**.

**Server** — five independent reads (attempt count, `hr_settings`, this device, the same device
under another employee, the open session) now run in one `Promise.all`. Verdict order unchanged:
the attempt-limit refusal still returns before anything is written.

**⚠ The measurement trap — read this before optimising further.** Response header says
`x-sb-edge-region: us-east-1`. **The sandbox is in the US**, so the function runs in us-east-1 and
every query crosses to the India database. The owner's phone gets a region near India.
**My latency numbers are NOT his.** After the change I measured 6084 ms cold / **4633 ms warm**
from the sandbox, with no "warm before" baseline — so I could not prove the improvement and said so.
**I asked him to time a punch on his phone and he has not answered yet.**

**Three round trips still removable (designed, not done):**
1. fold the `office_locations` lookup into the parallel batch (fetch all active offices, pick in memory)
2. combine the two device UPDATEs (`last_seen`/`user_agent`, then `fingerprint`) into one
3. drop the `auth.getUser()` network call — `verify_jwt` already verified the token, so `sub` can be
   read locally

## U3. #229 — the geofence is now final
Owner, verbatim: *"agar koi office ke bahar se login karta hai to uski location details aa jani
chahiye, bas punch in nahi hona chahiye. agar koi work from home pe hai to wo apply karega work
from home."*

**What it used to do:** an outside-office login was refused once, then **accepted** on the retry if
the browser resent `remote: true` + a reason — writing `open_since` and `status: in_progress`, so
the person was logged in from wherever they were, hours accruing, with only `remote_status:
'pending'` depending on the admin.

**Now:**
- outside the office the punch is **refused whatever the body says**; no `attendance` row is created
  or reopened
- the attempt is still audited with **full location** (`latitude`, `longitude`, `accuracy_m` are set
  on `event` at build time, `distance_m` right after `checkPunch`, all before any `reject()`)
- the reply carries **`request_allowed`** (renamed from `remote_allowed`) meaning "you cannot punch,
  but you may apply". Both UI hosts (`attendance.tsx`, `quick-punch.tsx`) read the new name; the
  `too_many_attempts` reply uses it too, so someone stuck outside is never dead-ended.
- **WFH is an application:** `login-options.tsx` now files
  `apply_attendance_request / work_from_home` instead of `doPunch({ remote: true })`. This loses
  nothing — `approveRemoteDay` in `hr-requests` already created the attendance row and credited the
  scheduled hours on approval, so the instant remote punch was redundant.
- **One exception kept:** `continuingRemote` (a day already approved/pending remote) can still
  punch, otherwise an approved WFH day could not be logged out of.
- Admin visibility: the Security table's distance cell is now a **Google Maps link** (hover shows
  lat/lng to 6 dp). Coordinates were previously **only in the CSV export**.

**Also in #229 — the login hydration race (found in T6, owner approved the fix):** `login.tsx` keeps
the Sign in button `disabled` until a mount effect sets `ready`. **Verified live** by fetching the
server-rendered HTML: `<button type="submit" disabled="">Loading…</button>`.

## U4. #230 — multiple recipients with CC/BCC
Owner wanted "add new mail" + CC/BCC on the lead, booking and payment-acknowledgment forms, and the
booking's alternate email in the Google Sheet.

**Nothing was needed server-side.** `send-client-email` already accepts `to`/`cc`/`bcc` as a single
address, a comma string **or** an array, and already dedupes. The whole gap was UI + columns.

- **`src/components/email-recipients.tsx`** — `useEmailRecipients({ primary, alsoTo, defaultBcc,
  resetKey })` returns `{ recipients, fields, hasRecipients }` (same shape as `useLoginOptions`).
  To as removable chips + an Add field, comma CC and BCC. **The record's own address cannot be
  removed** — removing it would send a client their own paperwork via someone else.
- **`src/lib/email-utils.ts`** — the regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` was copy-pasted in FOUR
  places (quotation dialog, reminders, new-booking twice). Now one copy with two standards:
  **To is strict** (a typo must block the send), **CC/BCC lenient** (a trailing comma must not).
  `isEmailAddress`, `dedupeEmails`, `parseEmailList`, `everyEmailValid`, `clientRecipients`. 17 tests.
- Wired: payment acknowledgment (booking email + both alternates, BCC still defaults to the shared
  inbox so it lands in Gmail Sent), lead email, and the quotation dialog's BCC became editable.
- **Columns** (`setup/ADD_ALTERNATE_EMAILS.sql`, mirroring `alt_contact_no`/`alt_contact_no_2`):
  `bookings.alt_email`, `bookings.alt_email_2`, `leads.alt_email`. **Owner RAN it and verified all
  three rows.** `types.ts` hand-edited (no DB credentials in the sandbox).
- **Google Sheet:** `alt_email` appended as **column 41 (AO)** in BOTH the new-booking append array
  and `bookingSheetValues()` (plus `BookingSheetSource`). **Never insert next to Email Id (column
  31)** — that shifts columns 32–40 and silently corrupts every row a later `updateRow` touches.
  Apps Script needs **no redeploy** (`updateRow` writes `values.length` columns from A), but
  **cell AO1 must be typed in by hand** because `HEADERS` only writes on an empty tab.

## U5. Live-test facts established
- **#224's fingerprint dedupe verified live, by accident.** I wiped localStorage AND cookies, so a
  new `device_key` was minted (`5f8cfd52…` → `5456b496…`) but **`device_fp` stayed identical**
  (`21cd78a4…`). The server matched the fingerprint, moved the existing row to the new key and kept
  its status — **no duplicate device row**. Exactly what the fix is for.
- **The geofence change is NOT verified live.** From 20 km away the verdict was
  `device_not_approved`, because **the device check runs before the location check** and my sandbox
  device was never approved. `outside_geofence` with the new behaviour still needs a real approved
  device outside the office.
- **New Booking's `Alternative Email` / `Alternative Email 2` verified live** on the deployed app.
  The payment-ack recipient editor and the lead composer were **not** seen running: the ack editor
  only appears after saving a real booking, and the test account has no leads under RLS.
- The test employee's day was left **open** on 23 Oct (login 01:14 pm, logout —), which makes it the
  natural first subject for the 19:30 logout reminder.

## U6. MISTAKES — do not repeat
1. **Spent 2 of the owner's 3 punch attempts** on the test employee while probing the geofence. The
   limit is per EMPLOYEE per 15 minutes, not per device, so testing eats the real person's budget.
   Check `attempts_left` in the reply and stop at one.
2. **Measured latency from the sandbox and nearly reported it as the owner's.** The sandbox is in
   us-east-1; the DB and the users are in India. Always check `x-sb-edge-region` before quoting a
   number, and ask the owner for a figure from his phone.
3. Used `read_file` with paths relative to `/projects/sandbox` instead of
   `/projects/sandbox/Easemyoffice` several times — every call failed. The repo is in a subfolder.
4. Edited existing files with a Python script and introduced **9 new prettier errors**; had to find
   and hand-fix each one to restore lint parity (437 → 437). After scripted edits, always re-run the
   before/after eslint count.

## U7. OPEN ITEMS
1. **AO1 header** — owner must type `Alternate Email` into cell AO1 of the Bookings tab.
2. **Apps Script (#211) STILL unconfirmed** — now testable: edit a booking's alternate email and
   save. If the sheet gains a **duplicate row** instead of updating, the old script is live and he
   must paste the new `doPost` + `updateRow()` from `setup/apps-script-code.gs` and Deploy → New
   version.
3. **Punch timing from his phone** — still owed. Needed before doing the three remaining round-trip
   removals in U2.
4. **Geofence + WFH-apply need a live check** from an approved device outside the office.
5. **Pending device cleanup** — "Chrome on Linux" under the test employee, from my sandbox browser.
6. **Logout reminder's first real run** was due 19:30 IST on 23 Oct; cron job id **22**, `0 14 * * *`,
   verified active. Check:
   `SELECT user_id, title, created_at FROM notifications WHERE type = 'hr_logout_reminder' ORDER BY created_at DESC LIMIT 20;`
7. **Saturday grace** — owner said "no grace on Saturday". That is `hr_settings.grace_minutes` → `0`
   in HR Settings; no code change. The 11:30 cut-off is deliberately flat so it will not move.
8. Earlier open items in §10, S11 and T7 still apply.

---

# INCIDENT — 26 Oct 2026: the Supabase project stopped responding

## V1. What the owner reported
*"Not able to login Into CRM as in admin panel"*, then *"ye login hona is very important & log out too"*.

## V2. What it actually was
**The Supabase project, not the code.** No deploy had happened for three days (#231 was the last
merge), and [status.supabase.com](https://status.supabase.com/) reported every system operational.

Measured from outside the app:

| | Afternoon (first check) | An hour later |
|---|---|---|
| `auth/v1/health` | 0.6–1.9 s | — |
| `auth/v1/token` (password grant) | **6.0 s → 7.5 s → 504 after 40 s** | no response |
| `rest/v1` (Data API) | no response in 25 s | no response |
| edge functions | no response in 25 s | no response |

**Credentials were never the problem** — a direct `curl` to `/auth/v1/token` returned a valid access
token while the app could sign nobody in.

**Owner restarted the project and everything came back, faster than it had been all day:**
auth **0.88 s**, REST **0.7 s**, edge function **0.94 s**, CRM login click-to-dashboard **708 ms**.

## V3. THE LESSON — auth at 6–7 s was a warning we misread
Earlier the same week the owner complained a punch took **8–9 seconds**, and I treated it purely as
a code problem (#228: GPS early-exit, 5 queries → 1 round trip). Those changes were right, but
**much of that 8–9 s was this same backend already degrading.** The punch POST measured 6.2 s then
and 4.6 s after my change; the same function answers in **0.94 s** on a healthy project.

**Before optimising anything again, first measure the platform:** hit `auth/v1/health`,
`rest/v1/<table>?select=id&limit=1` and a cheap edge function with `curl -w "%{time_total}"`. If
those are slow, the application code is not the story. (And remember from U2 that the sandbox runs
in `us-east-1` while the project is in India, so compare like with like.)

## V4. #232 — making an outage legible
supabase-js sets **no timeout** on its fetch, so during the outage Sign in sat on "Signing in…" and
the attendance LOGIN button on "Checking location…" **forever** — no error, no toast, nothing in the
console, indistinguishable from a wrong password or a broken build. The #223 retry does not help,
because it only reacts to an error the server *returns*; a hang returns nothing.

- **`src/lib/with-timeout.ts`** — `withTimeout(promise, ms, message)` rejects with a `TimeoutError`
  and clears its timer.
- **Sign-in: 12 s per attempt.** A timeout is deliberately **NOT retryable**
  (`isRetryableAuthError` returns false for `TimeoutError`) — a server silent for 12 s is down, and
  retrying twice more would make the user wait ~40 s for the same answer. A server that *answers*
  with a retryable error still gets its two retries.
- **`invokeFunction`: 15 s** → "The server is not responding…". Covers the punch, leave requests and
  every client email. The 401 session refresh is wrapped too.
- 10 tests added (445 → 455).

**Verified live during the real outage:** the message appeared after **12.7 s** and the button
returned to a usable "Sign in".

## V5. Live verifications after the restart (all previously unverified)
- **GPS read: 81 ms** — #228's early exit working on a real fix (accuracy 18 m ≤ 25 m, so the first
  reading was used). It used to sit out a 9-second window.
- **#225/#226 confirmed live:** pressing LOGIN at 17:30 gave **"Too late for a full day · It is past
  11:30, so today can no longer be a full day"** with the **"Late login" tile absent** — only Work
  from home, Half day and Leave.
- **#229 confirmed live:** the WFH option now reads *"Apply for today; the admin approves the day"* —
  an application, not a punch.
- Cancelled without submitting; no attendance or leave data was created.

## V6. GitHub Actions is ALSO down — and it is not the same thing as the CRM
The `Typecheck and build` check fails **in 2 seconds with no steps executed**, twice, on a repo where
Actions are enabled with `allowed_actions: all`. That is a runner that never starts — most likely
**Actions minutes / spending limit** (month end, and 9 PRs ran on 23 Oct). The billing API returns
403 to this token, so the owner must check **GitHub → Settings → Billing → Actions**.

**What still works while Actions is down** (measured, and worth repeating to the owner, who asked
"GitHub nahi chal raha to CRM open nahi hoga?"):
- CRM login page 200 in 1.04 s, dashboard 200 in 0.35 s — the app runs on **Cloudflare**, not GitHub
- Supabase auth 200 in 0.88 s
- **`Workers Builds: easemyoffice: success` on the same commit Actions failed on** — Cloudflare builds
  and deploys independently, so deploys keep working

The only loss is the pre-merge safety net. **Procedure while it is down:** run
`npx tsc --noEmit`, `bun run test` and `bun run build` in the sandbox, put the results in the PR
body, and **ask the owner before merging** — do not merge around a red check unsupervised. He
approved #232 this way with an explicit "kro merge".

## V7. Owner's dashboard checklist, in the order given (restart fixed it this time)
1. Organization → Billing (a failed payment would explain Supabase *and* Actions at once)
2. Resume/Restore button on the project page
3. Settings → General → **Restart project** ← this is what worked
4. Settings → Database → Disk usage (a full disk produces exactly this signature: Data API and
   Functions hanging while Auth degrades more slowly)

## V8. Still open after this incident
1. **GitHub Actions** — billing/minutes unconfirmed; resets on 1 Nov if it is the monthly allowance.
2. **A real punch timing from the office** — still owed. Expect ~2 s now; the three remaining
   round-trip removals in U2 are only worth doing if it is still slow.
3. Sheet **AO1** header, Apps Script **#211** confirmation, and the pending **"Chrome on Linux"**
   device under the test employee — all unchanged from U7.
