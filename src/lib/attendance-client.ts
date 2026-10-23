// Browser side of attendance: device identity, a fresh GPS fix, and the call
// to the attendance-punch edge function. Nothing here decides a verdict — the
// server does — so none of it is a security boundary.

import { invokeFunction } from "@/lib/edge-functions";
import type { PunchKind, RejectionReason } from "@/lib/attendance-rules";
import type { AttendanceRow } from "@/lib/hrms";

const DEVICE_KEY_STORAGE = "emo:attendance-device";

const DEVICE_COOKIE = "emo_dk";

function readCookie(name: string): string | null {
  try {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

function writeCookie(name: string, value: string) {
  try {
    document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${60 * 60 * 24 * 730}; path=/; SameSite=Lax; Secure`;
  } catch {
    /* cookies blocked */
  }
}

/**
 * Random per-browser id. Kept in localStorage AND a 2-year cookie: either one
 * restores the other, so a browser that clears one store does not show up as a
 * new device (and need approval) again.
 */
export function getDeviceKey(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY_STORAGE) || readCookie(DEVICE_COOKIE);
    if (existing) {
      localStorage.setItem(DEVICE_KEY_STORAGE, existing);
      writeCookie(DEVICE_COOKIE, existing);
      return existing;
    }
    const key =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_KEY_STORAGE, key);
    writeCookie(DEVICE_COOKIE, key);
    return key;
  } catch {
    const fromCookie = readCookie(DEVICE_COOKIE);
    if (fromCookie) return fromCookie;
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

export type Fix =
  | {
      ok: true;
      latitude: number;
      longitude: number;
      accuracy: number;
      /** position.timestamp of the reading used. */
      timestamp?: number;
      /** Readings taken and the largest distance between them (m). */
      samples?: number;
      spreadM?: number;
    }
  | { ok: false; error: string };

/** Longest we keep sampling before going with the best reading so far. */
const SAMPLE_WINDOW_MS = 4000;
/** Sharp enough to punch on straight away. */
const GOOD_ENOUGH_M = 25;
/** Inside the server's accuracy limit, but vague enough to want a second look. */
const ACCEPTABLE_M = 50;
/** Fallback one-shot read; a laptop locating itself over Wi-Fi is not quick. */
const COARSE_TIMEOUT_MS = 8000;

function metersBetween(a: GeolocationCoordinates, b: GeolocationCoordinates): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function errorCode(err: GeolocationPositionError): string {
  return err.code === err.PERMISSION_DENIED
    ? "permission_denied"
    : err.code === err.TIMEOUT
      ? "timeout"
      : "position_unavailable";
}

/** One-shot read with low accuracy allowed — the laptop / weak-GPS fallback. */
function readCoarse(): Promise<GeolocationPosition | GeolocationPositionError> {
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(resolve, resolve, {
      enableHighAccuracy: false,
      timeout: COARSE_TIMEOUT_MS,
      maximumAge: 30000,
    }),
  );
}

/**
 * A fresh fix, as fast as one can be trusted.
 *
 * Phones start coarse and sharpen, so a single one-shot read used to get
 * rejected as "too imprecise". Watching fixes that, but waiting out the whole
 * window cost every punch several seconds. So: take the FIRST reading that is
 * sharp enough to decide on (`maximumAge: 0` already rules out a cached fix,
 * which is what the second reading used to guard against), give a middling
 * reading one more chance to sharpen, and only sit out the window when nothing
 * good has arrived. If high-accuracy mode fails altogether (common on laptops
 * without GPS) fall back to a normal read.
 */
export function readPosition(): Promise<Fix> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ ok: false, error: "geolocation_unsupported" });
      return;
    }
    const readings: GeolocationPosition[] = [];
    let done = false;
    let watchId: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = async (err?: GeolocationPositionError) => {
      if (done) return;
      done = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      if (timer) clearTimeout(timer);
      if (!readings.length) {
        if (err && err.code === err.PERMISSION_DENIED) {
          resolve({ ok: false, error: "permission_denied" });
          return;
        }
        const coarse = await readCoarse();
        if ("coords" in coarse) readings.push(coarse);
        else {
          resolve({ ok: false, error: errorCode(coarse) });
          return;
        }
      }
      const best = readings.reduce((a, c) => (c.coords.accuracy < a.coords.accuracy ? c : a));
      let spread = 0;
      for (const x of readings) spread = Math.max(spread, metersBetween(x.coords, best.coords));
      resolve({
        ok: true,
        latitude: best.coords.latitude,
        longitude: best.coords.longitude,
        accuracy: best.coords.accuracy,
        timestamp: best.timestamp,
        samples: readings.length,
        spreadM: Math.round(spread * 10) / 10,
      });
    };

    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          readings.push(pos);
          const { accuracy } = pos.coords;
          if (accuracy <= GOOD_ENOUGH_M) void finish();
          else if (accuracy <= ACCEPTABLE_M && readings.length >= 2) void finish();
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED || !readings.length) void finish(err);
        },
        { enableHighAccuracy: true, timeout: SAMPLE_WINDOW_MS, maximumAge: 0 },
      );
    } catch {
      void finish();
      return;
    }
    timer = setTimeout(() => void finish(), SAMPLE_WINDOW_MS);
  });
}

async function sha256Short(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Screen size in physical pixels, orientation- and zoom-independent.
 *
 * The first version of this used `width x height @ devicePixelRatio`, which
 * moves on the same device: screen.width and screen.height SWAP when an
 * Android phone is rotated, and zooming a page raises devicePixelRatio while
 * shrinking the CSS dimensions. Either one produced a new fingerprint, so the
 * phone looked like unknown hardware and asked for device approval again.
 *
 * Multiplying by the ratio cancels the zoom, sorting cancels the rotation, and
 * rounding absorbs the sub-pixel noise that leaves (e.g. 412 x 2.625).
 */
function screenSignature(): string {
  const ratio = window.devicePixelRatio || 1;
  const sides = [screen.width * ratio, screen.height * ratio]
    .map((n) => Math.round(n / 10) * 10)
    .sort((a, b) => a - b);
  return sides.join("x");
}

/** The pre-#224 screen part, kept only so an existing row can be matched. */
function legacyScreenSignature(): string {
  return `${screen.width}x${screen.height}@${window.devicePixelRatio}`;
}

/**
 * Stable hardware/OS fingerprint (screen, timezone, CPU, GPU, model). Sent
 * with each punch so the same phone/laptop is recognised after its browser
 * storage is cleared, instead of asking for device approval again.
 *
 * `legacy` is the same fingerprint computed the old way. The server falls back
 * to it when looking a device up, so devices already on file (and already
 * approved) are recognised and quietly moved to the stable value instead of
 * needing a fresh approval.
 */
export type DeviceFingerprints = { fp: string | null; legacy: string | null };
let fpCache: Promise<DeviceFingerprints> | null = null;
export function deviceFingerprints(): Promise<DeviceFingerprints> {
  if (fpCache) return fpCache;
  fpCache = (async () => {
    try {
      const nav = navigator as Navigator & {
        deviceMemory?: number;
        userAgentData?: {
          platform?: string;
          getHighEntropyValues?: (h: string[]) => Promise<Record<string, string>>;
        };
      };
      let model = "";
      let platform = nav.userAgentData?.platform ?? nav.platform ?? "";
      try {
        const hi = await nav.userAgentData?.getHighEntropyValues?.(["model", "platformVersion"]);
        model = hi?.model ?? "";
        platform += hi?.platformVersion ? ` ${hi.platformVersion.split(".")[0]}` : "";
      } catch {
        /* not Chromium */
      }
      let gpu = "";
      try {
        const gl = document.createElement("canvas").getContext("webgl");
        const ext = gl?.getExtension("WEBGL_debug_renderer_info");
        if (gl && ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? "");
      } catch {
        /* no WebGL */
      }
      const parts = (screenPart: string) =>
        [
          platform,
          model,
          screenPart,
          Intl.DateTimeFormat().resolvedOptions().timeZone,
          nav.hardwareConcurrency ?? "",
          nav.deviceMemory ?? "",
          gpu,
        ].join("|");
      const [fp, legacy] = await Promise.all([
        sha256Short(parts(screenSignature())),
        sha256Short(parts(legacyScreenSignature())),
      ]);
      return { fp, legacy: legacy === fp ? null : legacy };
    } catch {
      return { fp: null, legacy: null };
    }
  })();
  return fpCache;
}

export type PunchResult =
  | { ok: true; action: PunchKind; attendance: AttendanceRow; remote?: boolean }
  | {
      ok: false;
      reason: RejectionReason;
      message: string;
      /** Cannot punch from here, but may apply for WFH / half day / leave. */
      request_allowed?: boolean;
      attempts_left?: number;
    };

/**
 * Reads the location and sends the punch. A failed fix is still sent (without
 * coordinates) so the attempt and its reason land in the audit trail.
 *
 * For a work-from-home request pass `remote` + `reason`, and the `fix` from the
 * attempt that was just rejected so the user does not wait for GPS twice.
 */
export async function punch(
  action: PunchKind,
  opts: { remote?: boolean; reason?: string; fix?: Fix; lateReason?: string } = {},
): Promise<PunchResult & { fix: Fix }> {
  const fix = opts.fix ?? (await readPosition());
  const fingerprints = await deviceFingerprints();
  const body: Record<string, unknown> = {
    action,
    device_key: getDeviceKey(),
    device_label: describeDevice(navigator.userAgent),
    device_fp: fingerprints.fp,
    device_fp_legacy: fingerprints.legacy,
  };
  if (fix.ok) {
    body.latitude = fix.latitude;
    body.longitude = fix.longitude;
    body.accuracy = fix.accuracy;
    body.fix_timestamp = fix.timestamp ?? null;
    body.fix_samples = fix.samples ?? null;
    body.fix_spread_m = fix.spreadM ?? null;
  } else {
    body.client_error = fix.error;
  }
  if (opts.lateReason) body.late_reason = opts.lateReason;
  if (opts.remote) {
    body.remote = true;
    body.remote_reason = opts.reason ?? "";
  }
  const data = await invokeFunction<Record<string, unknown> | null>("attendance-punch", body);
  if (data?.error) throw new Error(String(data.error));
  return { ...(data as PunchResult), fix };
}

/**
 * Leave requests and admin decisions (hr-requests edge function). Business-rule
 * failures come back as `{ ok: false, message }` and are thrown here so callers
 * can surface them with a toast.
 */
export async function hrRequest<T = Record<string, unknown>>(
  body: Record<string, unknown>,
): Promise<T> {
  const data = await invokeFunction<Record<string, unknown> | null>("hr-requests", body);
  if (data?.error) throw new Error(String(data.error));
  if (data?.ok === false) throw new Error(String(data.message ?? "Request failed"));
  return data as T;
}
