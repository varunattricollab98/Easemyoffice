# Website "Contact Us" Form -> CRM Lead Intake

> **Hinglish note:** Ye endpoint aapki marketing website ke "Contact Us" form ko seedha CRM se jodta hai. Jab koi visitor form bharega, ek naya lead **bina assign kiye** ban jayega (stage `New Lead`, source `Website`). Reps use lead ko **Pipeline / Leads** page par **claim** kar sakte hain. Koi SQL run karne ki zaroorat nahi, service-role client aur existing `leads` table use hoti hai.

## Endpoint

```
POST https://easemyoffice.emo-crm.workers.dev/api/public/hooks/lead-intake
```

- Public and unauthenticated (no login required).
- Accepts `application/json`, `application/x-www-form-urlencoded`, and `multipart/form-data`.
- CORS enabled (`Access-Control-Allow-Origin: *`) so a form on a different domain can POST.
- Created leads are **UNASSIGNED** (`assigned_to = NULL`), `stage = new_lead`, `source = website`, and show up for reps to **claim** in the Pipeline / Leads views (filter Source = Website).

## Accepted fields

| Field (with aliases) | Maps to | Required |
| --- | --- | --- |
| `name`, `full_name`, `client_name` | `client_name` | **Yes** |
| `phone`, `mobile`, `contact`, `contact_no` | `mobile` | **Yes** |
| `email`, `email_id` | `email` (must contain `@`, else stored as null) | No |
| `company`, `business`, `company_name` | `company_name` | No |
| `city`, `location` | `city` | No |
| `message`, `query`, `requirement`, `notes` | `notes` | No |
| `service`, `service_required` | `service_required` (only if it matches a service id) | No |
| `source` | `source` (only if a valid source id, else `website`) | No |

Valid `service` ids: `virtual_office`, `gst_registration`, `apob`, `business_registration`, `iec`, `trademark`, `other`.

Valid `source` ids: `website`, `email`, `whatsapp`, `indiamart`, `google_ads`, `meta_ads`, `referral`, `direct_call`, `other`.

## Responses

| Status | Body | Meaning |
| --- | --- | --- |
| 200 | `{ "ok": true, "lead_id": "...", "lead_code": "..." }` | Lead created |
| 200 | `{ "ok": true, "deduped": true, "lead_id": "..." }` | Existing lead matched by mobile/email; no duplicate created |
| 200 | `{ "ok": true, "skipped": true }` | Honeypot triggered (bot silently dropped) |
| 400 | `{ "ok": false, "error": "name and phone are required" }` | Missing required fields |
| 401 | `{ "ok": false, "error": "unauthorized" }` | Token guard enabled and token mismatch |
| 500 | `{ "ok": false, "error": "..." }` | Database insert failed |

## Sample HTML form

```html
<form action="https://easemyoffice.emo-crm.workers.dev/api/public/hooks/lead-intake" method="POST">
  <input name="name" placeholder="Your name" required />
  <input name="phone" placeholder="Mobile number" required />
  <input name="email" type="email" placeholder="Email" />
  <input name="company" placeholder="Company / business" />
  <input name="city" placeholder="City" />
  <textarea name="message" placeholder="How can we help?"></textarea>
  <!-- Honeypot: keep hidden from real users. Bots fill it -> lead is silently dropped. -->
  <input name="website_hp" type="text" tabindex="-1" autocomplete="off" style="display:none" aria-hidden="true" />
  <button type="submit">Send</button>
</form>
```

## Sample fetch() (JSON)

```js
await fetch("https://easemyoffice.emo-crm.workers.dev/api/public/hooks/lead-intake", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "Rahul Sharma",
    phone: "9876543210",
    email: "rahul@example.com",
    company: "Sharma Traders",
    city: "Mumbai",
    message: "Need a virtual office in Mumbai.",
    service: "virtual_office",
  }),
});
```

## Sample curl

```bash
curl -X POST https://easemyoffice.emo-crm.workers.dev/api/public/hooks/lead-intake \
  -H "Content-Type: application/json" \
  -d '{"name":"Rahul Sharma","phone":"9876543210","email":"rahul@example.com","message":"Need a virtual office."}'
```

## Anti-abuse

- **Honeypot:** Add a hidden field named `website_hp` (or `_gotcha`) to the form. If it is non-empty on submit, the request returns `200 { ok: true, skipped: true }` and **no lead is created** (bots are silently dropped).
- **Optional shared secret (`LEAD_INTAKE_TOKEN`):** If you set this Cloudflare Worker secret, every request must present a matching token via the `x-intake-token` header **or** a `token` body field, otherwise the endpoint returns `401`. If the secret is **not** set, the token check is skipped so the endpoint works out of the box.

### Configuring the optional token

1. Set the Worker secret:
   ```bash
   npx wrangler secret put LEAD_INTAKE_TOKEN
   ```
   (or add it in the Cloudflare dashboard: Workers & Pages -> your worker -> Settings -> Variables and Secrets).
2. `LEAD_INTAKE_TOKEN` is already listed in `SERVER_ENV_KEYS` in `src/server.ts`, so it is bridged onto `process.env` at runtime. **Do not** prefix it with `VITE_` (that would ship it to the browser).
3. Send it from your form/site:
   ```js
   fetch(url, {
     method: "POST",
     headers: { "Content-Type": "application/json", "x-intake-token": "YOUR_TOKEN" },
     body: JSON.stringify({ name, phone }),
   });
   ```

## No SQL required

This endpoint uses the **service-role** Supabase client (bypasses RLS) and the existing `leads` table with its defaults, so there is **no migration to run**. It logs a best-effort `lead_activities` row of type `created` for each captured lead.

## Claim flow

New leads arrive **unassigned**. Reps open the **Pipeline / Leads** page, filter by **Source = Website**, and **claim** the leads they want to work. Claiming requires the `leads_update` RLS policy to allow updating rows where `assigned_to IS NULL` (see `setup/FIX_LEADS_CLAIM_RLS.sql`).
