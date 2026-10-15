// Non-component helpers shared by the Documentation views (kept out of
// doc-ui.tsx so that file only exports components, for fast refresh).

import { useEffect, useState } from "react";

/** Re-renders every `intervalMs` so TAT countdowns stay live. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function pct(rate: number | null): string {
  return rate == null ? "—" : `${Math.round(rate * 100)}%`;
}

export function bookingRef(
  b: { external_booking_id?: string | null; booking_code?: string | null } | null,
): string {
  return b?.external_booking_id || b?.booking_code || "—";
}

export function bookingTitle(
  b: { business_name?: string | null; client_name?: string | null } | null,
): string {
  return b?.business_name || b?.client_name || "Untitled booking";
}
