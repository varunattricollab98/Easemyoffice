# Agent Context — EaseMyOffice CRM

> This file is the persistent memory/handoff for the AI agent working on this repo.
> If you're an agent starting a new session on this repo: **read this first.**
> Last updated: after PR #155.

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
- Tests: **Vitest** unit tests (`src/lib/*.test.ts`) + Playwright e2e (`e2e/`)

## 3. Deployment — ALL AUTOMATIC (don't deploy manually)
- **Frontend:** Cloudflare is connected to GitHub → every merge to `main` auto-builds + deploys (~3 min). No manual `bun run deploy`.
- **Edge functions:** `.github/workflows/deploy-supabase-functions.yml` auto-deploys `supabase/functions/**` on push to main (needs `SUPABASE_ACCESS_TOKEN` repo secret).
- **CI:** `.github/workflows/ci.yml` runs `npx tsc --noEmit` + `bun run build` on every PR.

## 4. Sandbox: validate locally BEFORE pushing
The npm registry is reachable, so the whole CI pipeline runs in-sandbox. Verified 2026-09-28 on `main` (`ac58d09`):

| Step | Command | Result |
|---|---|---|
| Install | `bun install --frozen-lockfile` | 562 packages, ~8s |
| Typecheck | `npx tsc --noEmit` | clean |
| Unit tests | `bun run test` | 38 passed / 3 files |
| Build | `bun run build` | ~9s, emits `dist/server/index.js` + `wrangler.json` |

**Always run typecheck + tests + build before pushing** instead of waiting on CI, and don't
claim in PRs that validation was impossible.

`node`/`npx` are often missing from a fresh sandbox shell's PATH (`npx: command not found`).
Export it first, otherwise the typecheck silently doesn't run:

```sh
export PATH="/root/.nvm/versions/node/v22.23.2/bin:$PATH"
```

Still genuinely unavailable: no Supabase credentials in-sandbox, so the dev server can't
exercise real data and anything needing live DB/Gmail/Zoho access must be checked by the
owner after deploy. Some external-URL fetches may also be blocked.

> Historical note: this section previously said `bun install` failed with npm 403 and that
> nothing could be validated locally. That is no longer true — don't reintroduce that claim.

## 5. Workflow the user expects
- Implement on a **feature branch**; **rebase onto latest origin/main** before pushing (otherwise a stale base can REVERT already-merged PRs — this happened twice).
- Push via provider Power, open a PR, then **squash-merge without asking** (user said "sab khud hi kara karo", reconfirmed after #154: "merge kardiya karo"). Merge with
  `gh api -X PUT repos/varunattricollab98/Easemyoffice/pulls/<n>/merge -f merge_method=squash`, then sync `main` and delete the branch. Still report the PR link and what shipped.
- **Gate the merge on CI, not on asking:** merge only once the check-runs for the head SHA are green and the PR reports `mergeable_state: clean`. Never merge around a failing check — fix it, or say why it can't be fixed.
- `gh` notes: gateway blocks GraphQL → use `gh api` REST (not `gh pr list`, `gh pr merge`); `gh --body-file /tmp/...` fails → pass body inline via `gh api -f body=`. **`/tmp` is not writable in the sandbox** — write scratch files under the workspace instead. `diff` is also absent from the sandbox shell.
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
- **Quotation** (#79–#87, #90, #91): self-hosted then enlarged/aligned brand logos, CA pricing
  + mail-handling wording, correct UPI, UPI QR code, removed the 10-row pricing cap, serial
  number column, selected states float to top, day-pass price settled at **599/day**.
- **Zoho Books invoicing** (#92–#96): manual Create + Send to Client, new-bookings-only
  cutoff, IGST inter-state vs CGST+SGST intra-state, client-state place of supply,
  client-only billing address, mark Paid for paid bookings. Docs point at the
  EaseMyOffice-HR org.
- **Renewals** (#99–#101, #103): renewals-only users see only renewal clients, separate
  Gmail inbox for `renewals@easemyoffice.in` with reply + snippet/premium quotation, and a
  renewal pipeline at parity with the sales pipeline.
- **Inbox / Gmail** (#89, #107–#111, #120): retry transient Google HTML interstitials,
  Reply in CRM on any thread, attachment-list layout fix, instant reopen (#109), rich-text
  + attachments composer, one "Send Quote" button, and no junk leads from our own sent copies.
- **Payment-ack email** (#98, #102, #104): reliable logo/alignment across clients,
  consistent emoji+label alignment, removed floating decorative emoji.
- **Leads** (#88, #113, #142–#152): WhatsApp opens in a new tab, Send Quotation always
  visible, delete scoped own/unassigned for users and all for admins, duplicate-lead
  name-match warning + history-preserving merge + list badge + clickable badge opening the
  duplicate group, column rebalance, user-resizable persisted columns, mobile card layout,
  and duplicate detection moved **server-side** for performance.
- **Bulk upload** (#140, #141, #145): accepts the EMO sales sheet as-is, fuzzy header
  matching (fixed Total Amount reading 0), blank date → null with per-row retry (recovered
  31 dropped rows).
- **Bookings** (#97, #105, #146): admin delete, multi-year plan duration, admin Sales Agent
  filter.
- **Calls** (#112): TeleCMI call auto-logging webhook + Calls section — this is the first
  real step of the Phase 2 telephony work in §10.
- **Dashboard / nav / search** (#115–#118, #122, #123, #135, #150): global search palette
  (+ positioning fix), call & booking-revenue KPI cards (backfilled for existing users),
  Pipeline board on the dashboard, Pipeline above Lead Inbox in the sidebar, notifications
  Mark-all-read + Read tab, staggered entrance animation.
- **Automations / notifications** (#134, #136–#139): daily renewal-expiry nudge email,
  instant new-lead alerts delivered as in-CRM notifications (email opt-in) via a DB trigger
  that replaced the 15-min cron, restricted to UNASSIGNED leads to avoid duplicates.
- **Audit** (#119): team accountability Activity Log.
- **Code health** (#124–#133): booking money math extracted into a tested module and deduped
  behind shared `computeBookingMoney`, **Vitest introduced**, app-wide error boundary +
  shared `formatINR`, ~90 `any` removed across error handling / lead-renewal rows / Hero of
  the Month (fixing latent null bugs), renewals inbox HTML rendered in a **sandboxed
  iframe** (XSS), a11y on email rows + logger util.
- **Misc** (#121): realtime demo simulator permanently disabled.

### #153 onwards
- #153 corrected §4 of this doc (the sandbox CAN run the full pipeline) and added
  `.kiro/steering/emo-crm.md` so Kiro loads the guardrails automatically.
- #154 **Convert to Booking on a lead** — opens the normal booking dialog prefilled from the
  lead (name, company, phone, alt phone, email, city, state, mapped source, and a remarks
  line carrying the lead code, service and budget). `NewBookingDialog` gained optional
  `open`/`onOpenChange`/`prefill`/`onSaved` props and renders its built-in trigger only when
  uncontrolled, so the Bookings and Dashboard usages are unchanged. `prefill` also disables
  the queue and the localStorage draft for that dialog — restore would have overwritten the
  lead, the writer would have leaked it into the user's shared draft, and `clearDraft()`
  would have deleted an unrelated in-progress draft. Mapping lives in the pure
  `src/lib/lead-to-booking.ts`, which never prefills money (`vo_amount` is the pre-GST base;
  `quoted_amount` has no input since #64 so writing it would be invisible yet still persist a
  discount) and never prefills a value that would disable Save (malformed email, sub-10-digit
  alt phone). On save the lead advances to `payment_received` via the shared
  `handleStageChange` (forward-only; already-past stages are left alone) and stamps
  `converted_date` if empty.
- #155 recorded the merge-without-asking policy in §5 and the steering file.

## 9. Data state
CRM was cleaned once: all dummy leads/bookings/reminders/notifications deleted via SQL; **users/roles/settings/email snippets kept**. The connected **Google Sheet still holds old booking data separately** from Supabase.

## 10. Pending / future
- **Phase 2 telephony (call & WhatsApp real tracking):** user is evaluating **Exotel** (or MyOperator/Ozonetel) for automatic call duration/recording/missed-call tracking, and **WhatsApp Business API** (AiSensy/Wati/Interakt). **Call is first priority, WhatsApp later.** Needs the user's telephony account + API credentials. Current call/WhatsApp logging (#72) is manual "Option A" — Phase 2 will upgrade it to automatic.
