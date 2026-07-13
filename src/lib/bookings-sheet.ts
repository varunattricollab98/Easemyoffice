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

export interface PlanRow {
  code: string;
  vo_plan?: string;
  sp_name?: string;
  area?: string;
  city?: string;
  state?: string;
  sp_status?: string;
  sp_payable?: string | number;
}

export interface SheetConfig {
  nextBookingId?: string | null;
  plans: PlanRow[];
}

// Reads the next available Booking ID + the plans master list from the Google
// Sheet (via the get-sheet-config edge function). Fails open (empty) if the
// sheet/function isn't set up, so the booking form still works normally.
export async function getSheetConfig(): Promise<SheetConfig> {
  try {
    const { data, error } = await supabase.functions.invoke("get-sheet-config", { body: {} });
    if (error || !data?.ok) return { plans: [] };
    return {
      nextBookingId: data.nextBookingId ?? null,
      plans: Array.isArray(data.plans) ? data.plans : [],
    };
  } catch {
    return { plans: [] };
  }
}
