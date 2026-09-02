# User Actions: Stop the Shared-Inbox BCC Flood

Ye document un steps ko cover karta hai jo aapko **manually** karne padenge taaki BCC flood wala fix live ho jaye. Code change ho chuka hai (branch `feat/stop-inbox-bcc-flood-email-log`), lekin sirf code merge hone se kaam poora nahi hoga.

## Background: kya change hua hai

Pehle har client email ki ek copy shared inbox `contact@easemyoffice.in` par BCC ho jaati thi. Jab ek saath 1000 followups jaate the, main inbox mein chaos ban jaata tha. Ab:

- **send-client-email** aur **process-reminders** edge functions ab forced shared-inbox BCC nahi lagate. `process-reminders` hi wo cron path tha jo 1000-followups flood banata tha.
- In dono functions mein har successful send ab `public.email_log` table mein ek row ke roop mein record hota hai (service-role client se, RLS bypass karke).
- Frontend dialogs ab `bcc: "contact@easemyoffice.in"` hardcode nahi karte; wo `lead_id` / `booking_id` / `created_by` pass karte hain taaki log link ho jaye.
- Lead detail page ab email_log se **"N emails sent · last sent X ago"** dikhata hai, so aapko records ke liye inbox ki zaroorat nahi.

> **Important:** Cloudflare git-build sirf **frontend** deploy karta hai. Edge functions aur SQL migrations **automatically deploy/apply NAHI hote**. Isliye neeche ke steps zaroori hain, warna fix live nahi hoga.

---

## (a) Redeploy the two edge functions

Edge functions Cloudflare build se **alag** deploy hote hain. Jab tak aap in dono ko redeploy nahi karte, purana forced-BCC wala version hi live rahega aur flood chalta rahega.

Live Supabase project ref: **`cfzwdlibvxksrxcrsvpp`**

Terminal se ye do commands chalao:

```bash
supabase functions deploy send-client-email --project-ref cfzwdlibvxksrxcrsvpp
supabase functions deploy process-reminders --project-ref cfzwdlibvxksrxcrsvpp
```

Dono functions redeploy hone ke baad hi naya (no-force-BCC + email_log logging) code live hoga.

> **Note:** PR #16 mein ek CI auto-deploy workflow hai jo in functions ko automatically deploy kar sakta hai, lekin usko ek `SUPABASE_ACCESS_TOKEN` repo secret chahiye jo abhi aapne confirm nahi kiya hai. Jab tak wo secret set nahi hota, auto-deploy kaam nahi karega, is case mein upar wale manual `supabase functions deploy` commands hi chalao.

---

## (b) Unset the `CRM_BCC_EMAIL` secret in Supabase

Ye belt-and-suspenders step hai. BCC ab **opt-in per-send only** hai (sirf tab jab caller explicitly `bcc` param pass kare). Lekin safety ke liye shared-inbox wala secret hata do taaki koi residual reference bhi shared inbox par copy na bheje.

Supabase Dashboard mein jao:

**Supabase → Edge Functions → Secrets** → `CRM_BCC_EMAIL` ko **unset / delete** kar do.

Iske baad koi bhi automatic shared-inbox copy possible nahi rahegi.

---

## (c) Run the SQL migration `setup/ADD_EMAIL_LOG.sql`

Naya `public.email_log` table create karne ke liye migration chalao. Ye migration **idempotent** hai (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, aur `DROP POLICY IF EXISTS` guards ke saath), so ise **safely re-run** kiya ja sakta hai without error.

Steps:

1. Supabase Dashboard → **SQL Editor** kholo.
2. Repo se `setup/ADD_EMAIL_LOG.sql` ki poori file ka content copy karo.
3. SQL Editor mein paste karke **Run** karo.

> **Note:** Migrations Cloudflare build se **auto-apply NAHI hoti**. Aapko ye SQL manually SQL Editor mein chalana zaroori hai, warna edge functions ka log-insert fail hoga aur lead page par "N emails sent" nahi dikhega.

---

## (d) How to verify

Sab kuch sahi live hua ya nahi, ye confirm karne ke liye:

1. CRM se ek **test client email** bhejo (kisi lead ke detail page se, ya kisi bhi normal send flow se).
2. Confirm karo ki uski **koi copy `contact@easemyoffice.in` par NAHI aayi** (shared inbox check karo, kuch nahi aana chahiye).
3. Confirm karo ki `public.email_log` mein ek **nayi row** aayi hai. SQL Editor mein check kar sakte ho:

   ```sql
   SELECT id, to_email, subject, status, sent_at, source
   FROM public.email_log
   ORDER BY sent_at DESC
   LIMIT 5;
   ```

4. Us lead ke **detail page** par jao aur confirm karo ki **"N emails sent"** count badh gaya hai aur "last sent X ago" naya time dikha raha hai.

Agar teeno cheezein sahi hain (no shared-inbox copy, nayi email_log row, incremented count), to fix live hai.

---

## Note: `CRM_MARKER` intentionally kept

Emails ke body mein ek invisible marker text **`EMO-CRM-SENT`** (CRM_MARKER) abhi bhi inject hota hai. Ye **jaan-boojh kar rakha gaya hai**, ye invisible aur harmless hai. Agar future mein aap kisi specific send par BCC wapas opt-in karna chahein, to ye marker Gmail-side filtering ke liye kaam aata rahega. Isliye ise remove nahi kiya gaya. Aapko iske liye kuch karne ki zaroorat nahi hai.
