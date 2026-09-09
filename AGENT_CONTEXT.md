# Agent Context — EaseMyOffice CRM

> This file is the persistent memory/handoff for the AI agent working on this repo.
> If you're an agent starting a new session on this repo: **read this first.**
> Last updated: after PR #77.

---

## 1. What this project is
**EaseMyOffice CRM** — a sales CRM for virtual office / GST / business registration services.
Sales team manages leads → follow-ups → bookings → clients, and sends quotation emails.

- **Correct repo:** `varunattricollab98/Easemyoffice` (this one).
  ⚠️ `varunattricollab98/easemyofficecollab98` is EMPTY — never use it.
- **Live:** https://easemyoffice.emo-crm.workers.dev (planned: crm.easemyoffice.in)

## 2. Tech stack
- TanStack Start + React 19 + TanStack Router
- Supabase (Postgres + Deno edge functions) — project ref `cfzwdlibvxksrxcrsvpp`
- Cloudflare Workers (hosting)
- UI: Radix + Tailwind v4 + shadcn-style components in `src/components/ui`
- Package manager: **bun**

## 3. Deployment — ALL AUTOMATIC (don't deploy manually)
- **Frontend:** Cloudflare is connected to GitHub → every merge to `main` auto-builds + deploys (~3 min). No manual `bun run deploy`.
- **Edge functions:** `.github/workflows/deploy-supabase-functions.yml` auto-deploys `supabase/functions/**` on push to main (needs `SUPABASE_ACCESS_TOKEN` repo secret).
- **CI:** `.github/workflows/ci.yml` runs `npx tsc --noEmit` + `bun run build` on every PR.

## 4. Sandbox constraint (IMPORTANT)
Network is **INTEGRATIONS_ONLY**: `bun install` FAILS (npm 403). So build/lint/typecheck/dev-server and external-URL fetches **cannot run in-sandbox**. Rely on CI to validate; always note this limitation in PRs.

## 5. Workflow the user expects
- Implement on a **feature branch**; **rebase onto latest origin/main** before pushing (otherwise a stale base can REVERT already-merged PRs — this happened twice).
- Push via provider Power, open a PR, then **squash-merge without asking** (user said "sab khud hi kara karo").
- `gh` notes: gateway blocks GraphQL → use `gh api` REST (not `gh pr list`); `gh --body-file /tmp/...` fails (sandbox fs) → pass body inline via `gh api -f body=`.
- **User language:** communicates in Hindi/Hinglish, prefers replies in **Hinglish**. But **SQL/code must be clean English** (comments fine).

## 6. Gmail lead-inbox + tag-sync
- Shared Gmail `contact@easemyoffice.in` fronted by a Google **Apps Script Web App** (`setup/gmail-apps-script.gs`), deployed EXTERNALLY on that Google account. **Editing the repo file does nothing until the owner pastes it into the live Apps Script and redeploys the Web App.**
- Edge function `gmail-bridge` proxies actions: inbox / thread / claim / tagged.
- Manual claim/markMine/assign (`src/routes/_authenticated/inbox.tsx`) add a Gmail label `"<Name> lead"`. **The CRM NEVER creates a "converted" label** — if the user sees "converted" auto-applied, it's a Gmail filter or Apps Script rule, not the CRM.
- Server sync `gmail-tag-sync` edge function (+ `supabase/functions/_shared/gmail-parse.ts`, byte-identical to `src/lib/gmail.ts`) runs every 10 min via pg_cron: enumerates all `"<Name> lead"` threads full-mailbox, matches owner tag → profile, dedups on `[realEmail, senderAddr]`, inserts leads (source='email') assigned to that salesperson via service role.
- **Secrets (Supabase → Edge Functions):** `GMAIL_WEBHOOK_URL`, `GMAIL_TOKEN`, `CRON_SECRET` (= `emo-cron-5034`).
- `setup/ADD_GMAIL_TAG_SYNC_CRON.sql` was run (also created `email_log` table which didn't exist, and widened its status CHECK to allow `'unmatched'`). Needs `pg_cron` + `pg_net` extensions.

## 7. Key files
- `src/components/send-quotation-dialog.tsx` — quotation dialog + `buildQuotationHtml` email. Brand logos are self-hosted at `easemyoffice.in/logos/*.png`. **SVG/WebP DON'T render in email clients** → use PNG, or Clearbit `https://logo.clearbit.com/<domain>`.
- `src/components/dashboard/new-booking-dialog.tsx` — `NewBookingDialog` (self-contained trigger; also on Bookings page). Contains the payment-acknowledgment email HTML.
- `src/lib/email-signature.ts` — "Your Dedicated Manager" block.
- `src/routes/_authenticated/leads/$id.tsx` — lead detail; call/WhatsApp activity logging.
- `src/components/app-shell.tsx` — sidebar (sticky). `src/styles.css` — global CSS + `.scrollbar-modern` utility.
- DB: `leads` (source='email' for email leads); `lead_activities` has a `payload` JSONB and `activity_type` enum includes `call`/`whatsapp`.

## 8. Shipped features (merged PRs)
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

## 9. Data state
CRM was cleaned once: all dummy leads/bookings/reminders/notifications deleted via SQL; **users/roles/settings/email snippets kept**. The connected **Google Sheet still holds old booking data separately** from Supabase.

## 10. Pending / future
- **Phase 2 telephony (call & WhatsApp real tracking):** user is evaluating **Exotel** (or MyOperator/Ozonetel) for automatic call duration/recording/missed-call tracking, and **WhatsApp Business API** (AiSensy/Wati/Interakt). **Call is first priority, WhatsApp later.** Needs the user's telephony account + API credentials. Current call/WhatsApp logging (#72) is manual "Option A" — Phase 2 will upgrade it to automatic.
