// Browser side of attendance: device identity, a fresh GPS fix, and the call
// to the attendance-punch edge function. Nothing here decides a verdict — the
// server does — so none of it is a security boundary.

import { supabase } from "@/integrations/supabase/client";
import type { PunchKind, RejectionReason } from "@/lib/attendance-rules";
import type { AttendanceRow } from "@/lib/hrms";

const DEVICE_KEY_STORAGE = "emo:attendance-device";

/** Random per-browser id, created once and kept in localStorage. */
export function getDeviceKey(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY_STORAGE);
    if (existing) return existing;
    const key =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_KEY_STORAGE, key);
    return key;
  } catch {
    // Storage blocked (private mode): a per-page-load id still lets the server
    // log the attempt; with approval required it will simply be refused.
    return "ephemeral";
  }
}

/** "Chrome on Android" — a human label for the device list. */
export function describeDevice(ua: string): string {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Browser";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "Unknown OS";
  return `${browser} on ${os}`;
}

type Fix =
  | { ok: true; latitude: number; longitude: number; accuracy: number }
  | { ok: false; error: string };

/** A fresh high-accuracy fix. Never a cached one — it could be from elsewhere. */
export function readPosition(): Promise<Fix> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ ok: false, error: "geolocation_unsupported" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          ok: true,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) =>
        resolve({
          ok: false,
          error:
            err.code === err.PERMISSION_DENIED
              ? "permission_denied"
              : err.code === err.TIMEOUT
                ? "timeout"
                : "position_unavailable",
        }),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

export type PunchResult =
  | { ok: true; action: PunchKind; attendance: AttendanceRow }
  | { ok: false; reason: RejectionReason; message: string };

/**
 * Reads the location and sends the punch. A failed fix is still sent (without
 * coordinates) so the attempt and its reason land in the audit trail.
 */
export async function punch(action: PunchKind): Promise<PunchResult> {
  const fix = await readPosition();
  const body: Record<string, unknown> = {
    action,
    device_key: getDeviceKey(),
    device_label: describeDevice(navigator.userAgent),
  };
  if (fix.ok) {
    body.latitude = fix.latitude;
    body.longitude = fix.longitude;
    body.accuracy = fix.accuracy;
  } else {
    body.client_error = fix.error;
  }
  const { data, error } = await supabase.functions.invoke("attendance-punch", { body });
  if (error) throw new Error(error.message || "Attendance service is unreachable");
  if (data?.error) throw new Error(String(data.error));
  return data as PunchResult;
}
