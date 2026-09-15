# Renewals Gmail Inbox — Setup

Gives the Renewals team its own **Lead Inbox** inside the CRM, reading the
**renewals@easemyoffice.in** mailbox — completely separate from the sales inbox
(contact@easemyoffice.in). Appears in the sidebar as **Renewal Inbox** for
`renewals` and `admin` roles at `/renewals/inbox`.

It mirrors the sales inbox stack:
- Edge function `supabase/functions/renewals-gmail-bridge/index.ts` (a clone of
  `gmail-bridge`) reading its OWN secrets.
- Frontend `src/routes/_authenticated/renewals/inbox.tsx` using the shared
  helpers in `src/lib/gmail.ts` with the bridge name `renewals-gmail-bridge`.

> Supabase edge-function secrets are **project-global by name**, so the renewals
> mailbox uses DISTINCT secret names — it does NOT reuse `GMAIL_WEBHOOK_URL` /
> `GMAIL_TOKEN` (those stay pointed at contact@).

---

## 1. Deploy the Apps Script on the renewals Google account

1. Sign in to **renewals@easemyoffice.in** in Google.
2. Open <https://script.google.com> → **New project**.
3. Paste the contents of `setup/gmail-apps-script.gs` (the same script the sales
   mailbox uses).
4. Set a **distinct** token at the top:
   ```gs
   const TOKEN = "renewals-<make-a-long-secret>";
   ```
5. **Deploy → New deployment → Web app**:
   - **Execute as:** Me (renewals@easemyoffice.in)
   - **Who has access:** **Anyone**  ← must be "Anyone", not "Anyone with a Google account"
6. Copy the **/exec** Web App URL (must end in `/exec`).

## 2. Add the Supabase secrets

Supabase → **Edge Functions → Secrets**:

| Secret | Value |
| --- | --- |
| `RENEWALS_GMAIL_WEBHOOK_URL` | the renewals Apps Script `/exec` URL |
| `RENEWALS_GMAIL_TOKEN` | must equal the `TOKEN` set in the renewals Apps Script |

(Leave the existing `GMAIL_WEBHOOK_URL` / `GMAIL_TOKEN` untouched — those are the
sales mailbox.)

## 3. Deploy

The `renewals-gmail-bridge` edge function auto-deploys on merge to `main`
(`.github/workflows/deploy-supabase-functions.yml`). No manual deploy needed.
JWT verification stays ON (default) — it's called from the authenticated
browser, same as `gmail-bridge`.

## 4. Use it

Renewals dashboard → **Renewal Inbox**. Emails from renewals@ list there;
**Claim** creates a renewal lead (a `bookings` row with `renewal_status=pending`
+ a plan expiry date so it shows in Renewal Leads/Pipeline) assigned to the rep,
and labels the Gmail thread `"<Name> lead"` (same convention as sales).

---

## Notes for the next agent
- The three Gmail helpers in `src/lib/gmail.ts` (`fetchInbox`, `fetchThread`,
  `claimEmailInGmail`) take an optional bridge-name arg (`GmailBridgeFn`),
  defaulting to `"gmail-bridge"`. The renewals page passes
  `"renewals-gmail-bridge"`. The sales inbox is unchanged.
- There is intentionally **no renewals tag-sync cron** yet (the sales
  `gmail-tag-sync` is contact@-only). If a server-side renewals sweep is needed
  later, clone `gmail-tag-sync` as `renewals-gmail-tag-sync` with
  `RENEWALS_GMAIL_WEBHOOK_URL`/`RENEWALS_GMAIL_TOKEN` + its own
  `[functions.renewals-gmail-tag-sync] verify_jwt = false` in config.toml, and
  scope profile-matching to renewals-role users.
