// Creates and sends GST invoices in Zoho Books for a CRM booking.
//
//   { action: "create", booking_id }  -> find/create the Zoho customer, create a
//                                         tax invoice from the booking's amounts,
//                                         and store the Zoho ids/number/pdf back
//                                         on the booking row.
//   { action: "send",   booking_id }  -> email the already-created invoice to the
//                                         client via Zoho (uses the client's email
//                                         on the booking; falls back to Zoho's
//                                         saved contact email).
//   { action: "status", booking_id }  -> refresh the stored Zoho status/pdf url.
//
// Called from the browser via supabase.functions.invoke("zoho-invoice", { body }).
// Supabase verifies the caller's JWT automatically, so only logged-in users can
// use it. Failures return HTTP 200 with { ok:false, error } so the browser can
// read the message (invoke() hides the body on non-2xx).
//
// Zoho auto-numbers the invoice (e.g. INV-HR-1603), applies the org's template,
// and — given place_of_supply + an 18% GST tax on the line items — splits
// CGST/SGST (intra-state) vs IGST (inter-state) itself. We only pass amounts,
// customer, GSTIN and the client's state.
//
// Required Edge Function secrets (Supabase -> Edge Functions -> Secrets):
//   ZOHO_CLIENT_ID
//   ZOHO_CLIENT_SECRET
//   ZOHO_REFRESH_TOKEN
//   ZOHO_ORG_ID            -> Zoho Books organization id (e.g. 60039342640)
//   ZOHO_API_DOMAIN        -> e.g. https://www.zohoapis.in   (India)
//   ZOHO_ACCOUNTS_DOMAIN   -> e.g. https://accounts.zoho.in  (India)
//   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CLIENT_ID = Deno.env.get("ZOHO_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("ZOHO_CLIENT_SECRET") ?? "";
const REFRESH_TOKEN = Deno.env.get("ZOHO_REFRESH_TOKEN") ?? "";
const ORG_ID = Deno.env.get("ZOHO_ORG_ID") ?? "";
const API_DOMAIN = (Deno.env.get("ZOHO_API_DOMAIN") ?? "https://www.zohoapis.in").replace(/\/+$/, "");
const ACCOUNTS_DOMAIN = (Deno.env.get("ZOHO_ACCOUNTS_DOMAIN") ?? "https://accounts.zoho.in").replace(/\/+$/, "");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Rate applied to the taxable line items. Bookings already compute GST at 18%.
const GST_RATE = 18;

// The seller's home state (EaseMyOffice / Narula Technologies LLP GSTIN
// 06AANFN9510H1Z3 => 06 => Haryana). Used to decide intra- vs inter-state GST:
//   client state == home state  -> intra-state -> CGST+SGST (Zoho "GST18")
//   client state != home state  -> inter-state -> IGST      (Zoho "IGST18")
const HOME_STATE_CODE = (Deno.env.get("ZOHO_HOME_STATE_CODE") ?? "HR").toUpperCase();

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Indian state -> 2-letter code (Zoho place_of_supply). Covers the common
// spellings; we normalise case/whitespace before matching. Used to tell Zoho
// the client's state so it can decide CGST/SGST vs IGST. ──────────────────────
const STATE_CODES: Record<string, string> = {
  "andhra pradesh": "AP", "arunachal pradesh": "AR", "assam": "AS", "bihar": "BR",
  "chhattisgarh": "CG", "chhatisgarh": "CG", "goa": "GA", "gujarat": "GJ",
  "haryana": "HR", "himachal pradesh": "HP", "jharkhand": "JH", "karnataka": "KA",
  "kerala": "KL", "madhya pradesh": "MP", "maharashtra": "MH", "manipur": "MN",
  "meghalaya": "ML", "mizoram": "MZ", "nagaland": "NL", "odisha": "OD",
  "orissa": "OD", "punjab": "PB", "rajasthan": "RJ", "sikkim": "SK",
  "tamil nadu": "TN", "tamilnadu": "TN", "telangana": "TS", "tripura": "TR",
  "uttar pradesh": "UP", "uttarakhand": "UK", "uttaranchal": "UK",
  "west bengal": "WB", "delhi": "DL", "new delhi": "DL",
  "jammu and kashmir": "JK", "jammu & kashmir": "JK", "ladakh": "LA",
  "chandigarh": "CH", "puducherry": "PY", "pondicherry": "PY",
  "andaman and nicobar islands": "AN", "dadra and nagar haveli and daman and diu": "DD",
  "lakshadweep": "LD",
};

// GSTIN's leading two digits encode the state.
const GSTIN_STATE_BY_NUM: Record<string, string> = {
  "37": "AP", "12": "AR", "18": "AS", "10": "BR", "22": "CG", "30": "GA",
  "24": "GJ", "06": "HR", "02": "HP", "20": "JH", "29": "KA", "32": "KL",
  "23": "MP", "27": "MH", "14": "MN", "17": "ML", "15": "MZ", "13": "NL",
  "21": "OD", "03": "PB", "08": "RJ", "11": "SK", "33": "TN", "36": "TS",
  "16": "TR", "09": "UP", "05": "UK", "19": "WB", "07": "DL", "01": "JK",
  "38": "LA", "04": "CH", "34": "PY", "35": "AN", "26": "DD", "31": "LD",
};
// Reverse: code -> display name (for the billing address state text).
const CODE_TO_STATE: Record<string, string> = Object.entries(STATE_CODES).reduce(
  (acc, [name, code]) => {
    if (!acc[code]) acc[code] = name.replace(/\b\w/g, (c) => c.toUpperCase());
    return acc;
  },
  {} as Record<string, string>,
);

function stateNameToCode(stateName?: string | null): string | null {
  const key = String(stateName ?? "").trim().toLowerCase();
  return key && STATE_CODES[key] ? STATE_CODES[key] : null;
}

function gstinToCode(gstin?: string | null): string | null {
  const g = String(gstin ?? "").trim();
  return g.length >= 2 && GSTIN_STATE_BY_NUM[g.slice(0, 2)] ? GSTIN_STATE_BY_NUM[g.slice(0, 2)] : null;
}

// Place of supply = the CLIENT's own state. The client's GSTIN is the most
// reliable source (its first two digits are the state); fall back to the typed
// GST address text, then any explicit client-state hint. NOTE: this must NOT be
// the virtual-office location (booking.state) — that is where the service sits,
// not where the client is registered. (Handled by the caller passing only
// client-derived values.)
function placeOfSupplyCode(gstin?: string | null, gstAddress?: string | null): string | null {
  // 1. From GSTIN (authoritative).
  const byGstin = gstinToCode(gstin);
  if (byGstin) return byGstin;
  // 2. From a state name appearing in the free-text GST address.
  const addr = String(gstAddress ?? "").toLowerCase();
  for (const [name, code] of Object.entries(STATE_CODES)) {
    if (addr.includes(name)) return code;
  }
  return null;
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

// ── Zoho auth: exchange the long-lived refresh token for a short-lived access
// token. Zoho access tokens last ~1 hour; we mint a fresh one per invocation. ──
async function getAccessToken(): Promise<string> {
  const url =
    `${ACCOUNTS_DOMAIN}/oauth/v2/token?refresh_token=${encodeURIComponent(REFRESH_TOKEN)}` +
    `&client_id=${encodeURIComponent(CLIENT_ID)}&client_secret=${encodeURIComponent(CLIENT_SECRET)}` +
    `&grant_type=refresh_token`;
  const res = await fetch(url, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Zoho auth failed: ${data.error || res.status}`);
  }
  return data.access_token as string;
}

// Thin wrapper for Zoho Books REST calls (org id + auth header on every call).
async function zoho(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${API_DOMAIN}${path}${sep}organization_id=${ORG_ID}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  // Zoho returns { code, message, ... }; code 0 == success.
  if (data && typeof data.code === "number" && data.code !== 0) {
    throw new Error(`Zoho: ${data.message || "request failed"}`);
  }
  if (!res.ok) throw new Error(`Zoho HTTP ${res.status}`);
  return data;
}

// Find the org's active 18% GST tax id matching the transaction type. For an
// inter-state supply Zoho REQUIRES an IGST tax; for intra-state it needs the
// CGST+SGST group. We pick by the tax's `tax_specification` (inter/intra) and
// `tax_specific_type` (igst) so the right one is attached. Returns null if none
// is configured (invoice still creates, just without tax — surfaced to user).
async function findGstTaxId(token: string, interState: boolean): Promise<string | null> {
  try {
    const data = await zoho(token, "GET", `/books/v3/settings/taxes`);
    const taxes: any[] = (data.taxes ?? []).filter(
      (t) => num(t.tax_percentage) === GST_RATE && !t.is_inactive,
    );
    if (interState) {
      // Inter-state -> IGST at 18%.
      const igst =
        taxes.find((t) => String(t.tax_specific_type ?? "").toLowerCase() === "igst") ||
        taxes.find((t) => String(t.tax_specification ?? "").toLowerCase() === "inter") ||
        taxes.find((t) => /igst/i.test(String(t.tax_name ?? "")));
      if (igst?.tax_id) return String(igst.tax_id);
    } else {
      // Intra-state -> CGST+SGST group.
      const grp =
        taxes.find(
          (t) =>
            String(t.tax_specification ?? "").toLowerCase() === "intra" &&
            String(t.tax_type ?? "") === "tax_group",
        ) ||
        taxes.find((t) => String(t.tax_specification ?? "").toLowerCase() === "intra") ||
        taxes.find((t) => /^gst/i.test(String(t.tax_name ?? "")) && !/igst/i.test(String(t.tax_name ?? "")));
      if (grp?.tax_id) return String(grp.tax_id);
    }
    // Last resort: any 18% tax.
    return taxes[0]?.tax_id ? String(taxes[0].tax_id) : null;
  } catch {
    return null;
  }
}

// Find an existing Zoho contact by GSTIN or email, else create one with the
// booking's client + GST details. Returns the contact id.
async function findOrCreateCustomer(
  token: string,
  b: any,
  posCode: string | null,
): Promise<string> {
  // 1. Reuse the stored contact id if we already created one for this booking.
  if (b.zoho_customer_id) return String(b.zoho_customer_id);

  const email = String(b.email_id ?? "").trim();
  const gstin = String(b.gst_number ?? "").trim();

  // 2. Try to match an existing contact (by email) to avoid duplicates.
  if (email) {
    try {
      const found = await zoho(
        token,
        "GET",
        `/books/v3/contacts?email=${encodeURIComponent(email)}`,
      );
      const c = (found.contacts ?? [])[0];
      if (c?.contact_id) return String(c.contact_id);
    } catch { /* fall through to create */ }
  }

  // 3. Create a new contact.
  const contactName =
    String(b.business_name ?? "").trim() || String(b.client_name ?? "").trim() || email || "Client";
  const payload: Record<string, unknown> = {
    contact_name: contactName,
    company_name: String(b.business_name ?? "").trim() || undefined,
    gst_treatment: gstin ? "business_gst" : "consumer",
    ...(gstin ? { gst_no: gstin } : {}),
    ...(posCode ? { place_of_contact: posCode } : {}),
    contact_persons: [
      {
        first_name: String(b.client_name ?? contactName).trim(),
        email: email || undefined,
        phone: String(b.contact_no ?? "").trim() || undefined,
      },
    ],
  };
  // Billing address = ONLY the client's GST address + the client's own state
  // (derived from posCode). We deliberately do NOT use booking city/state,
  // which hold the virtual-office LOCATION (e.g. Bangalore), not the client's
  // registered address.
  const address = String(b.gst_address ?? "").trim();
  if (address) {
    payload.billing_address = {
      address,
      ...(posCode && CODE_TO_STATE[posCode] ? { state: CODE_TO_STATE[posCode] } : {}),
      country: "India",
    };
  }
  const created = await zoho(token, "POST", `/books/v3/contacts`, payload);
  const id = created.contact?.contact_id;
  if (!id) throw new Error("Zoho did not return a contact id");
  return String(id);
}

// Expand the plan-code service prefix to a readable service name.
//   GST -> GST Registration,  BR -> Business Registration,  MA -> Mailing Address
function serviceFromPlan(planName?: string | null): string {
  const prefix = String(planName ?? "").trim().split(/[_\-\s]/)[0].toUpperCase();
  const map: Record<string, string> = {
    GST: "GST Registration",
    BR: "Business Registration",
    MA: "Mailing Address",
  };
  return map[prefix] ?? "";
}

// The virtual-office LOCATION for the item name = the booking's state (where the
// office sits, e.g. Karnataka). Falls back to city, then the plan code tail.
function voLocation(b: any): string {
  const st = String(b.state ?? "").trim();
  if (st) return st;
  const city = String(b.city ?? "").trim();
  if (city) return city;
  return "";
}

// Build the invoice line items from the booking's amounts. VO plan is always a
// line; add-ons become a second line when present. Tax id (if found) is attached
// so Zoho computes GST.
function buildLineItems(b: any, taxId: string | null): any[] {
  const items: any[] = [];
  const withTax = (li: any) => (taxId ? { ...li, tax_id: taxId } : li);

  const voAmount = num(b.vo_amount);
  if (voAmount > 0) {
    const loc = voLocation(b);
    const service = serviceFromPlan(b.plan_name);
    // "Virtual Office in <State> — <Service>" (both parts optional if unknown).
    const name =
      [`Virtual Office${loc ? ` in ${loc}` : ""}`, service].filter(Boolean).join(" \u2014 ").slice(0, 100) ||
      "Virtual Office";
    items.push(
      withTax({
        name,
        rate: voAmount,
        quantity: 1,
      }),
    );
  }
  const addOn = num(b.addon_amount);
  if (addOn > 0) {
    items.push(
      withTax({
        // Add-on services as-is from the booking.
        name: (String(b.addon_services ?? "").trim() || "Add-on Services").slice(0, 100),
        rate: addOn,
        quantity: 1,
      }),
    );
  }
  // Fallback: if neither amount is set, bill the total as one line so an invoice
  // is never empty.
  if (items.length === 0) {
    items.push(
      withTax({
        name: String(b.plan_name ?? "Services").slice(0, 100) || "Services",
        rate: num(b.vo_amount) || num(b.total_amount),
        quantity: 1,
      }),
    );
  }
  return items;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (req.method !== "POST") throw new Error("Use POST");
    if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN || !ORG_ID) {
      throw new Error(
        "Zoho is not configured. Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN and ZOHO_ORG_ID in Supabase Edge Function secrets.",
      );
    }
    if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("Supabase env missing");

    const { action = "create", booking_id } = await req.json().catch(() => ({}));
    if (!booking_id) throw new Error("booking_id is required");

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    // Load the booking.
    const { data: b, error: loadErr } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", booking_id)
      .single();
    if (loadErr || !b) throw new Error(loadErr?.message || "Booking not found");

    const token = await getAccessToken();

    // ── SEND: email an already-created invoice via Zoho ──────────────────────
    if (action === "send") {
      if (!b.zoho_invoice_id) throw new Error("No invoice created yet for this booking.");
      const to = String(b.email_id ?? "").trim();
      const body: Record<string, unknown> = {};
      if (to) body.to_mail_ids = [to];
      // Zoho uses the org's default template + email body; we only pass the
      // recipient. (BCC / from address are configured in Zoho settings.)
      await zoho(token, "POST", `/books/v3/invoices/${b.zoho_invoice_id}/email`, body);
      const sentAt = new Date().toISOString();
      await supabase
        .from("bookings")
        .update({ zoho_invoice_status: "sent", zoho_invoice_sent_at: sentAt })
        .eq("id", booking_id);
      return json({ ok: true, sent_at: sentAt, to: to || "(Zoho contact email)" });
    }

    // ── PDF: fetch the invoice PDF server-side (the download needs the OAuth
    // header the browser can't send) and return it base64-encoded so the client
    // can open/download it. ──────────────────────────────────────────────────
    if (action === "pdf") {
      if (!b.zoho_invoice_id) throw new Error("No invoice created yet for this booking.");
      const url = `${API_DOMAIN}/books/v3/invoices/${b.zoho_invoice_id}?accept=pdf&organization_id=${ORG_ID}`;
      const res = await fetch(url, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });
      if (!res.ok) throw new Error(`Zoho PDF fetch failed (HTTP ${res.status})`);
      const buf = new Uint8Array(await res.arrayBuffer());
      // Base64-encode in chunks to avoid call-stack limits on large PDFs.
      let binary = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < buf.length; i += CHUNK) {
        binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
      }
      const base64 = btoa(binary);
      return json({
        ok: true,
        filename: `Invoice-${b.zoho_invoice_number || b.external_booking_id || b.booking_code || b.zoho_invoice_id}.pdf`,
        base64,
      });
    }

    // ── STATUS: refresh stored status/pdf ────────────────────────────────────
    if (action === "status") {
      if (!b.zoho_invoice_id) throw new Error("No invoice created yet for this booking.");
      const data = await zoho(token, "GET", `/books/v3/invoices/${b.zoho_invoice_id}`);
      const inv = data.invoice ?? {};
      await supabase
        .from("bookings")
        .update({ zoho_invoice_status: inv.status ?? b.zoho_invoice_status })
        .eq("id", booking_id);
      return json({ ok: true, status: inv.status, number: inv.invoice_number });
    }

    // ── CREATE (default) ─────────────────────────────────────────────────────
    if (b.zoho_invoice_id) {
      // Already created — return the existing one instead of duplicating.
      return json({
        ok: true,
        already: true,
        invoice_id: b.zoho_invoice_id,
        invoice_number: b.zoho_invoice_number,
        pdf_url: b.zoho_pdf_url,
      });
    }

    // Place of supply = the CLIENT's own state (from GSTIN / GST address), NOT
    // the virtual-office location (booking.state).
    const posCode = placeOfSupplyCode(b.gst_number, b.gst_address);
    // Inter-state when we know the client's state and it differs from the
    // seller's home state. If the state is unknown we default to intra-state
    // (Zoho will still reject with a clear message if that's wrong).
    const interState = !!posCode && posCode !== HOME_STATE_CODE;
    const customerId = await findOrCreateCustomer(token, b, posCode);
    const taxId = await findGstTaxId(token, interState);
    const lineItems = buildLineItems(b, taxId);

    const invoicePayload: Record<string, unknown> = {
      customer_id: customerId,
      line_items: lineItems,
      ...(posCode ? { place_of_supply: posCode } : {}),
      ...(String(b.gst_number ?? "").trim() ? { gst_treatment: "business_gst", gst_no: String(b.gst_number).trim() } : {}),
      reference_number: String(b.external_booking_id ?? b.booking_code ?? "").slice(0, 100),
      notes: `Booking: ${b.external_booking_id ?? b.booking_code ?? ""}`.slice(0, 500),
    };

    const created = await zoho(token, "POST", `/books/v3/invoices`, invoicePayload);
    const inv = created.invoice ?? {};
    if (!inv.invoice_id) throw new Error("Zoho did not return an invoice id");

    // PDF download link (Zoho signs it with the org id; the "PDF" button opens it).
    const pdfUrl = `${API_DOMAIN}/books/v3/invoices/${inv.invoice_id}?accept=pdf&organization_id=${ORG_ID}`;

    const { error: upErr } = await supabase
      .from("bookings")
      .update({
        zoho_customer_id: customerId,
        zoho_invoice_id: String(inv.invoice_id),
        zoho_invoice_number: inv.invoice_number ?? null,
        zoho_invoice_status: inv.status ?? "draft",
        zoho_pdf_url: pdfUrl,
      })
      .eq("id", booking_id);
    if (upErr) throw new Error(`Invoice created in Zoho but saving to CRM failed: ${upErr.message}`);

    return json({
      ok: true,
      invoice_id: String(inv.invoice_id),
      invoice_number: inv.invoice_number ?? null,
      status: inv.status ?? "draft",
      pdf_url: pdfUrl,
      taxed: !!taxId,
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message });
  }
});
