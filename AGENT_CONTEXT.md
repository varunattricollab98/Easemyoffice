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
| 3 | flexible schedules, WFH approval, leave (2/month, carry 1), CRM idle tracking | 🟡 PR open — waiting on owner to run migration `20260516000007`, then merge |
| 4 | attendance corrections + payroll readiness | — |
| 5 | salary structures, incentive rules (from bookings), payroll run + lock + adjustments | — |

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
