// Read-side queries shared by the employee and admin attendance pages. All go
// through RLS: an employee only ever gets their own rows back.

import { daysInMonth } from "@/lib/attendance-rules";
import { hrmsDb, type AttendanceRow, type Holiday, type HrSettings } from "@/lib/hrms";

export function monthRange(year: number, month: number) {
  const mm = String(month).padStart(2, "0");
  return {
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${String(daysInMonth(year, month)).padStart(2, "0")}`,
  };
}

export async function fetchHrSettings(): Promise<HrSettings | null> {
  const { data } = await hrmsDb().from("hr_settings").select("*").maybeSingle();
  return data ?? null;
}

export async function fetchHolidays(from: string, to: string): Promise<Holiday[]> {
  const { data } = await hrmsDb()
    .from("holidays")
    .select("*")
    .eq("active", true)
    .gte("date", from)
    .lte("date", to)
    .order("date");
  return data ?? [];
}

export async function fetchAttendance(
  from: string,
  to: string,
  employeeId?: string,
): Promise<AttendanceRow[]> {
  let q = hrmsDb().from("attendance").select("*").gte("work_date", from).lte("work_date", to);
  if (employeeId) q = q.eq("employee_id", employeeId);
  const { data, error } = await q.order("work_date");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Holidays that count as non-working days. Optional holidays are not days off for everyone. */
export const offDayHolidays = (holidays: Holiday[]) =>
  holidays
    .filter((h) => h.holiday_type !== "optional")
    .map((h) => ({ date: h.date, name: h.name }));

export const timeIST = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata",
      })
    : "—";

export const dateTimeIST = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
