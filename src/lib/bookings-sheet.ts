import { supabase } from "@/integrations/supabase/client";

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
