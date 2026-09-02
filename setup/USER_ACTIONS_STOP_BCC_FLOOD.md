# User Actions: Stop the Shared-Inbox BCC Flood

Ye document un steps ko cover karta hai jo aapko **manually** karne padenge taaki BCC flood wala fix live ho jaye. Code change ho chuka hai (branch `feat/stop-inbox-bcc-flood-email-log`), lekin sirf code merge hone se kaam poora nahi hoga.

## Background: kya change hua hai

Pehle har client email ki ek copy shared inbox `contact@easemyoffice.in` par BCC ho jaati thi. Jab ek saath 1000 followups jaate the, main inbox mein chaos ban jaata tha. Ab **BCC sirf followups ke liye hataya gaya hai** — payment acknowledgment aur quotation emails jaan-boojh kar shared-inbox BCC **rakhte hain** taaki wo Gmail Sent mein dikhein.

- **process-reminders** (followup cron path jo 1000-followups flood banata tha) ab forced shared-inbox BCC nahi lagata. Yahi wo path hai jise band karna tha.
- **send-client-email** ab BCC **sirf tab** lagata hai jab caller explicitly `bcc` param pass kare (opt-in per-send). Koi forced/default shared-inbox copy nahi.
- **Payment acknowledgment** (booking dialog) aur **quotation** (send-quotation dialog) emails jaan-boojh kar `bcc: "contact@easemyoffice.in"` pass karte hain — ye Gmail Sent mein reflect hone chahiye, isliye inka BCC rakha gaya hai.
- Har successful send ab `public.email_log` table mein bhi ek row ke roop mein record hota hai (service-role client se, RLS bypass karke). Ye Gmail Sent copy ke saath-saath extra record hai.
- Frontend dialogs `lead_id` / `booking_id` / `created_by` pass karte hain taaki log link ho jaye.
- Lead detail page ab email_log se **"N emails sent · last sent X ago"** dikhata hai.

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

Dono functions redeploy hone ke baad hi naya (opt-in-BCC + email_log logging) code live hoga. Iske baad followups shared inbox par flood nahi karenge, jabki payment-ack aur quotation emails apni Gmail Sent copy ke saath jaate rahenge.

> **Note:** PR #16 mein ek CI auto-deploy workflow hai jo in functions ko automatically deploy kar sakta hai, lekin usko ek `SUPABASE_ACCESS_TOKEN` repo secret chahiye jo abhi aapne confirm nahi kiya hai. Jab tak wo secret set nahi hota, auto-deploy kaam nahi karega, is case mein upar wale manual `supabase functions deploy` commands hi chalao.

---

## (b) `CRM_BCC_EMAIL` secret — kuch karne ki zaroorat nahi

**Pehle jo bola gaya tha ki `CRM_BCC_EMAIL` unset karo — wo ab galat hai, unset mat karo.**

BCC ab **sirf tab** lagta hai jab caller (frontend send flow) explicitly `bcc` param pass kare. `send-client-email` function ab `CRM_BCC_EMAIL` secret ko forced default BCC ke roop mein use **nahi** karta. Iska matlab:

- `CRM_BCC_EMAIL` unset karne se payment-ack / quotation ki Gmail Sent copy **band nahi hogi** (wo copy caller ke explicit `bcc` param se aati hai, secret se nahi). Isliye unset karna misleading hai aur flood bhi isse nahi rukta.
- Flood already band ho jaata hai kyunki `process-reminders` (followups) ab koi `bcc` pass hi nahi karta.

So is secret ko waise hi chhod do — koi action needed nahi.

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

1. **Followup test:** kisi lead par ek followup trigger karo (ya cron chalne do).
2. Confirm karo ki us followup ki **koi copy `contact@easemyoffice.in` par NAHI aayi** (shared inbox check karo — followups ab flood nahi karne chahiye).
3. **Payment-ack / quotation test:** ek booking par payment acknowledgment bhejo, aur kisi lead par quotation bhejo. Confirm karo ki **inki copy `contact@easemyoffice.in` ke Gmail Sent mein AAYI hai** (ye jaan-boojh kar rakha gaya hai).
4. Confirm karo ki `public.email_log` mein ek **nayi row** aayi hai. SQL Editor mein check kar sakte ho:

   ```sql
   SELECT id, to_email, subject, status, sent_at, source
   FROM public.email_log
   ORDER BY sent_at DESC
   LIMIT 5;
   ```

5. Us lead ke **detail page** par jao aur confirm karo ki **"N emails sent"** count badh gaya hai aur "last sent X ago" naya time dikha raha hai.

Agar sab cheezein sahi hain (followup ki koi shared-inbox copy nahi, payment-ack/quotation ki Gmail Sent copy aa gayi, nayi email_log row, incremented count), to fix live hai.

---

## Note: `CRM_MARKER` intentionally kept

Emails ke body mein ek invisible marker text **`EMO-CRM-SENT`** (CRM_MARKER) abhi bhi inject hota hai. Ye **jaan-boojh kar rakha gaya hai**, ye invisible aur harmless hai. Agar future mein aap kisi specific send par BCC wapas opt-in karna chahein, to ye marker Gmail-side filtering ke liye kaam aata rahega. Isliye ise remove nahi kiya gaya. Aapko iske liye kuch karne ki zaroorat nahi hai.
