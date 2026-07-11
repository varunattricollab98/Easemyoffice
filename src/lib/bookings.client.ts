import { supabase } from "@/integrations/supabase/client";

// Column order for the Google Sheet — MUST match the HEADERS in the Apps Script.
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

// Best-effort push of one booking row to the connected Google Sheet.
// Never throws — returns a status so the UI can note it without blocking saves.
export async function syncBookingToSheet(values: (string | number)[]): Promise<{ ok: boolean; note?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("sync-booking-to-sheet", { body: { values } });
    if (error) return { ok: false, note: "sheet not connected" };
    if (data?.ok) return { ok: true };
    return { ok: false, note: data?.error || "sheet not connected" };
  } catch {
    return { ok: false, note: "sheet not connected" };
  }
}
