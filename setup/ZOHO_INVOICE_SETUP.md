# Zoho Books Invoice Integration — Setup

The CRM can create GST invoices in **Zoho Books** and email them to the client,
straight from the **Invoices** page. This is a **manual** flow: you click
**Create Invoice**, then **Send to Client**. Nothing is pushed automatically, so
a bad GST number or a Zoho hiccup never blocks a booking.

Zoho owns the numbering, the template, and the CGST/SGST-vs-IGST split. The CRM
only sends the customer, amounts, GSTIN and the client's state.

---

## 1. Run the database migration

Supabase → **SQL Editor** → paste & run [`setup/ADD_ZOHO_INVOICE.sql`](./ADD_ZOHO_INVOICE.sql).

It adds these columns to `bookings` (safe to re-run):
`gst_number`, `gst_address`, `zoho_customer_id`, `zoho_invoice_id`,
`zoho_invoice_number`, `zoho_invoice_status`, `zoho_pdf_url`,
`zoho_invoice_sent_at`.

## 2. Add the Edge Function secrets

Supabase → **Edge Functions → Secrets** (or Project Settings → Edge Functions):

| Secret | Value |
| --- | --- |
| `ZOHO_CLIENT_ID` | from the Zoho API Console self-client |
| `ZOHO_CLIENT_SECRET` | from the same self-client |
| `ZOHO_REFRESH_TOKEN` | generated once from the grant code (never expires) |
| `ZOHO_ORG_ID` | `60040190159` (EaseMyOffice-HR — the Haryana org) |
| `ZOHO_API_DOMAIN` | `https://www.zohoapis.in` |
| `ZOHO_ACCOUNTS_DOMAIN` | `https://accounts.zoho.in` |

> These are secrets — keep them **only** in Supabase, never in the repo.
> `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

### Regenerating the refresh token (if ever needed)

1. https://api-console.zoho.in/ → your Self Client → **Generate Code**
2. Scope:
   `ZohoBooks.invoices.CREATE,ZohoBooks.invoices.READ,ZohoBooks.contacts.CREATE,ZohoBooks.contacts.READ,ZohoBooks.settings.READ`
3. Exchange the code (within 10 min):
   ```
   curl -X POST "https://accounts.zoho.in/oauth/v2/token" \
     -d "grant_type=authorization_code" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET" \
     -d "code=THE_GENERATED_CODE"
   ```
   Copy `refresh_token` from the response into the secret above.

## 3. Deploy

The `zoho-invoice` edge function auto-deploys on merge to `main`
(`.github/workflows/deploy-supabase-functions.yml`). No manual deploy needed.

## 4. Zoho email settings (one-time, for branding + your own copy)

So the client sees the mail from **you** and you keep a lifetime copy:

- **From address:** Zoho Books → *Settings → Emails* → verify
  `contact@easemyoffice.in` as a from-address (Zoho sends a verification link).
- **Keep a copy (BCC):** Zoho Books → *Settings → Emails* → enable
  **"Send a copy of the email to me"** / add a BCC to your inbox. Every invoice
  email then also lands in your mailbox — a permanent record.

The invoice is additionally stored in **Zoho** (Sent status) and in the **CRM**
(`zoho_invoice_id`, number, status), so the record lives in three places.

---

## How it works (for the next agent)

- Edge function: `supabase/functions/zoho-invoice/index.ts`. Actions:
  `create` (find/create contact → create invoice → store ids on the booking),
  `send` (email via Zoho), `pdf` (fetch the official PDF server-side, return
  base64 — the browser can't send the OAuth header itself), `status` (refresh).
- Place of supply comes from the booking's `state` (falls back to the GSTIN's
  leading 2-digit state code), so Zoho picks CGST/SGST vs IGST automatically.
- The 18% GST tax id is looked up from the org's `settings/taxes` and attached
  to each line item; if none is found the invoice still creates (untaxed) and
  the response flags `taxed:false`.
- UI: `src/routes/_authenticated/invoices.tsx` shows **Create Invoice** until an
  invoice exists, then **Send to Client** (+ **Resend** once sent) and **PDF**.
- GST fields (`gst_number`, `gst_address`) are captured in both booking forms:
  `src/components/dashboard/new-booking-dialog.tsx` and
  `src/routes/_authenticated/renewals/bookings.tsx`.
