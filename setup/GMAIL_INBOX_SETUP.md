# Lead Inbox setup (shared Gmail: contact@easemyoffice.in)

Shows new lead emails inside the CRM. A salesperson clicks "Claim as my lead" →
a lead is created assigned to them **and** the Gmail thread gets a "<Name> lead"
label so everyone can see it's taken. Admins see everything.

This uses a Google Apps Script on the `contact@easemyoffice.in` account — the same
pattern as your booking sheet, just on the mailbox.

---

## Part 1 — Create the Apps Script (in the contact@ account)
1. Log into **contact@easemyoffice.in**, then open **script.google.com** → **New project**.
2. Delete the sample code, paste the code from `setup/gmail-apps-script.gs`.
3. On the `TOKEN` line, set your own secret phrase (e.g. `emo-inbox-4471`). Remember it.
4. Save (💾).

## Part 2 — Publish as a Web App
1. **Deploy → New deployment** → gear icon → **Web app**.
2. **Execute as:** Me · **Who has access:** Anyone → **Deploy**.
3. Authorize (Advanced → Go to project → Allow). It needs Gmail read + modify access — that's expected.
4. Copy the **Web app URL** (ends in `/exec`).

## Part 3 — Deploy the bridge function + secrets (Supabase)
1. Edge Functions → **Deploy a new function → Via Editor** → name it exactly
   **`gmail-bridge`** → paste code from `supabase/functions/gmail-bridge/index.ts` → Deploy.
2. Edge Functions → **Secrets** → add:
   - `GMAIL_WEBHOOK_URL` = the `/exec` URL from Part 2
   - `GMAIL_TOKEN` = the exact secret phrase from Part 1

---

## Done
Open the CRM → **Lead Inbox** (left sidebar):
- Emails from the shared mailbox appear here.
- **Claim as my lead** → creates the lead (assigned to you) + labels the Gmail thread "<Your name> lead".
- **Open in Gmail** → reply in Gmail as usual.
- Filters: **All / Unclaimed / My leads**. Admins see all; the label shows who claimed each one.

If the mailbox/function isn't set up yet, the tab simply says "not connected" — nothing else breaks.
