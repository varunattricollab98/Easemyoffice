-- ─────────────────────────────────────────────────────────────────────────
-- ADD_ZOHO_INVOICE.sql
-- Adds the columns needed for the Zoho Books invoice integration.
--
--   gst_number           -> the client's GSTIN (entered in the booking form)
--   gst_address          -> the client's billing address for the tax invoice
--   zoho_customer_id      -> Zoho Books contact id (so we reuse/update the same
--                            customer instead of creating duplicates)
--   zoho_invoice_id       -> Zoho Books invoice id (set once the invoice is
--                            created; its presence means "invoice already made")
--   zoho_invoice_number   -> the human-readable Zoho number (e.g. INV-HR-1603)
--   zoho_invoice_status   -> Zoho status snapshot (draft / sent / paid …)
--   zoho_pdf_url          -> a link to the invoice PDF (for the "PDF" button)
--   zoho_invoice_sent_at  -> when "Send to Client" last emailed the invoice
--
-- Safe to run multiple times (IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS gst_number          text,
  ADD COLUMN IF NOT EXISTS gst_address         text,
  ADD COLUMN IF NOT EXISTS zoho_customer_id     text,
  ADD COLUMN IF NOT EXISTS zoho_invoice_id      text,
  ADD COLUMN IF NOT EXISTS zoho_invoice_number  text,
  ADD COLUMN IF NOT EXISTS zoho_invoice_status  text,
  ADD COLUMN IF NOT EXISTS zoho_pdf_url         text,
  ADD COLUMN IF NOT EXISTS zoho_invoice_sent_at timestamptz;

-- Fast lookup of "which bookings already have a Zoho invoice".
CREATE INDEX IF NOT EXISTS idx_bookings_zoho_invoice_id
  ON public.bookings (zoho_invoice_id)
  WHERE zoho_invoice_id IS NOT NULL;
