import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const BOOKING_HEADERS = [
  "Date", "Sales Agent", "Booking ID", "Booking Source", "Plan Name", "VO Plan",
  "SP Name", "Area", "City", "State", "SP Status",
  "VO Amount", "VO GST 18%", "Add on Services", "Add on Amount", "Add on GST 18%",
  "Total Amount (₹)", "TDS %", "TDS Amount (₹)", "Amount After TDS",
  "Payment Mode / Reference No.", "Payment ID/UTR", "Invoice Number",
  "SP Payable (₹)", "Add on Payable (₹)", "Profit (₹)",
  "SP Payment Status", "VO Status",
  "Business Name", "Client Name", "Email Id", "Contact No.", "Remarks", "Sales Month",
  "Amount Received (₹)", "Balance Amount (₹)", "Balance Due Date",
] as const;

const BookingSchema = z.object({
  date: z.string().min(1),
  sales_agent: z.string().min(1).max(120),
  booking_id: z.string().min(1).max(60),
  booking_source: z.string().min(1).max(60),
  plan_name: z.string().min(1).max(120),
  vo_plan: z.string().max(120).default(""),
  sp_name: z.string().max(120).default(""),
  area: z.string().max(120).default(""),
  city: z.string().max(60).default(""),
  state: z.string().max(60).default(""),
  sp_status: z.string().max(40).default(""),
  vo_amount: z.number().min(0),
  vo_gst: z.number().min(0),
  addon_services: z.string().max(255).default(""),
  addon_amount: z.number().min(0).default(0),
  addon_gst: z.number().min(0).default(0),
  total_amount: z.number().min(0),
  tds_pct: z.number().min(0).max(100).default(0),
  tds_amount: z.number().min(0).default(0),
  amount_after_tds: z.number().min(0),
  payment_mode_ref: z.string().max(120).default(""),
  payment_id_utr: z.string().max(120).default(""),
  invoice_number: z.string().max(60).default(""),
  sp_payable: z.number().min(0).default(0),
  addon_payable: z.number().min(0).default(0),
  profit: z.number(),
  sp_payment_status: z.string().max(30).default(""),
  vo_status: z.string().max(30).default(""),
  business_name: z.string().max(160).default(""),
  client_name: z.string().min(1).max(120),
  email_id: z.string().max(254).default(""),
  contact_no: z.string().min(7).max(20),
  remarks: z.string().max(1000).default(""),
  sales_month: z.string().min(1).max(20),
  amount_received: z.number().min(0).default(0),
  balance_amount: z.number().min(0).default(0),
  balance_due_date: z.string().optional().nullable(),
});

const GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";
const SHEET_TAB = "Bookings";
const SHEET_RANGE = `${SHEET_TAB}!A:AK`;

function extractSheetId(input: string): string | null {
  const trimmed = input.trim();
  const m = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

async function getSheetId(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("app_settings").select("value").eq("key", "bookings_sheet_id").maybeSingle();
  return (data?.value as { id?: string } | null)?.id ?? null;
}

function gatewayHeaders(): HeadersInit | null {
  const lovable = process.env.LOVABLE_API_KEY;
  const sheets = process.env.GOOGLE_SHEETS_API_KEY;
  if (!lovable || !sheets) return null;
  return {
    Authorization: `Bearer ${lovable}`,
    "X-Connection-Api-Key": sheets,
    "Content-Type": "application/json",
  };
}

async function ensureHeaders(spreadsheetId: string, headers: HeadersInit) {
  const range = `${SHEET_TAB}!A1:AK1`;
  const getRes = await fetch(`${GATEWAY}/spreadsheets/${spreadsheetId}/values/${range}`, { headers });
  if (getRes.status === 400 || getRes.status === 404) {
    await fetch(`${GATEWAY}/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: "POST", headers,
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SHEET_TAB } } }] }),
    });
  }
  const getJson = getRes.ok ? await getRes.json() : { values: [] };
  const hasHeader = Array.isArray(getJson.values) && getJson.values.length > 0;
  if (!hasHeader) {
    await fetch(
      `${GATEWAY}/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
      { method: "PUT", headers, body: JSON.stringify({ values: [BOOKING_HEADERS as unknown as string[]] }) },
    );
  }
}

export const setBookingsSheet = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d) => z.object({ url_or_id: z.string().min(8).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: adminRow } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", context.userId).eq("role", "admin").maybeSingle();
    if (!adminRow) throw new Error("Forbidden: admin only");
    const id = extractSheetId(data.url_or_id);
    if (!id) throw new Error("Invalid Google Sheets URL or ID");
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: "bookings_sheet_id", value: { id }, updated_by: context.userId });
    if (error) throw new Error(error.message);
    return { id };
  });

export const getBookingsSheet = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async () => {
    const id = await getSheetId();
    return { id };
  });

export const appendBooking = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d) => BookingSchema.parse(d))
  .handler(async ({ data, context }) => {
    // 1. Save to DB (always)
    const { error: dbErr } = await supabaseAdmin.from("bookings").insert({
      external_booking_id: data.booking_id,
      booking_date: data.date,
      sales_agent_id: context.userId,
      sales_agent_name: data.sales_agent,
      booking_source: data.booking_source,
      plan_name: data.plan_name,
      vo_plan: data.vo_plan,
      sp_name: data.sp_name, area: data.area, city: data.city, state: data.state, sp_status: data.sp_status,
      vo_amount: data.vo_amount, vo_gst: data.vo_gst,
      addon_services: data.addon_services, addon_amount: data.addon_amount, addon_gst: data.addon_gst,
      total_amount: data.total_amount, tds_pct: data.tds_pct, tds_amount: data.tds_amount,
      amount_after_tds: data.amount_after_tds,
      payment_mode_ref: data.payment_mode_ref, payment_id_utr: data.payment_id_utr,
      invoice_number: data.invoice_number,
      sp_payable: data.sp_payable, addon_payable: data.addon_payable, profit: data.profit,
      sp_payment_status: data.sp_payment_status, vo_status: data.vo_status,
      business_name: data.business_name, client_name: data.client_name,
      email_id: data.email_id, contact_no: data.contact_no,
      remarks: data.remarks, sales_month: data.sales_month,
      amount_received: data.amount_received,
      balance_amount: data.balance_amount,
      balance_due_date: data.balance_due_date || null,
      assigned_to: context.userId,
      created_by: context.userId,
    });
    if (dbErr) throw new Error(`DB insert failed: ${dbErr.message}`);

    // 2. Append to Sheet (best effort)
    const spreadsheetId = await getSheetId();
    const headers = gatewayHeaders();
    let sheetWarning: string | null = null;
    if (spreadsheetId && headers) {
      try {
        await ensureHeaders(spreadsheetId, headers);
        const row = [
          data.date, data.sales_agent, data.booking_id, data.booking_source, data.plan_name, data.vo_plan,
          data.sp_name, data.area, data.city, data.state, data.sp_status,
          data.vo_amount, data.vo_gst, data.addon_services, data.addon_amount, data.addon_gst,
          data.total_amount, data.tds_pct, data.tds_amount, data.amount_after_tds,
          data.payment_mode_ref, data.payment_id_utr, data.invoice_number,
          data.sp_payable, data.addon_payable, data.profit,
          data.sp_payment_status, data.vo_status,
          data.business_name, data.client_name, data.email_id, data.contact_no, data.remarks, data.sales_month,
          data.amount_received, data.balance_amount, data.balance_due_date ?? "",
        ];
        const res = await fetch(
          `${GATEWAY}/spreadsheets/${spreadsheetId}/values/${SHEET_RANGE}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
          { method: "POST", headers, body: JSON.stringify({ values: [row] }) },
        );
        if (!res.ok) sheetWarning = `Sheet sync failed [${res.status}]`;
      } catch (e) {
        sheetWarning = (e as Error).message;
      }
    } else if (!spreadsheetId) {
      sheetWarning = "No sheet linked";
    } else {
      sheetWarning = "Google Sheets connector not configured";
    }
    return { ok: true, sheet_warning: sheetWarning };
  });

export const listBookings = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: adminRow } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", context.userId).eq("role", "admin").maybeSingle();
    let q = supabaseAdmin.from("bookings").select("*").order("created_at", { ascending: false }).limit(500);
    if (!adminRow) q = q.or(`assigned_to.eq.${context.userId},created_by.eq.${context.userId}`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { bookings: data ?? [] };
  });

export const markBalancePaid = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), amount: z.number().min(0).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error: getErr } = await supabaseAdmin
      .from("bookings").select("balance_amount,amount_received,total_amount,assigned_to,created_by")
      .eq("id", data.id).maybeSingle();
    if (getErr || !row) throw new Error("Booking not found");
    const { data: adminRow } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", context.userId).eq("role", "admin").maybeSingle();
    if (!adminRow && row.assigned_to !== context.userId && row.created_by !== context.userId) {
      throw new Error("Forbidden");
    }
    const paid = data.amount ?? Number(row.balance_amount ?? 0);
    const { error } = await supabaseAdmin.from("bookings").update({
      amount_received: Number(row.amount_received ?? 0) + paid,
      balance_amount: Math.max(0, Number(row.balance_amount ?? 0) - paid),
      balance_paid_at: new Date().toISOString(),
    }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
