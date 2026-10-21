// Why a browser could not get a location, and how to switch it on.
//
// A website cannot turn location on by itself. What it can do:
//  - permission "prompt": calling getCurrentPosition shows the browser's own
//    Allow/Block popup (same as on mobile) — readPosition() already does that.
//  - permission "denied": the browser will NOT ask again, so the user has to
//    allow it from the address bar; we show the exact steps for their device.
//  - permission granted but no fix: location is switched off in the operating
//    system (very common on Windows laptops) — steps for that instead.
// The Permissions API "change" event lets the dialog retry automatically the
// moment the user allows it.

export type LocationPermission = "granted" | "prompt" | "denied" | "unknown";

export async function locationPermission(): Promise<LocationPermission> {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
    const s = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return s.state as LocationPermission;
  } catch {
    return "unknown";
  }
}

/** Calls `cb` whenever the geolocation permission changes. Returns an unsubscribe. */
export function onLocationPermissionChange(cb: (state: LocationPermission) => void): () => void {
  let status: PermissionStatus | null = null;
  let cancelled = false;
  const handler = () => status && cb(status.state as LocationPermission);
  navigator.permissions
    ?.query({ name: "geolocation" as PermissionName })
    .then((s) => {
      if (cancelled) return;
      status = s;
      s.addEventListener("change", handler);
    })
    .catch(() => {});
  return () => {
    cancelled = true;
    status?.removeEventListener("change", handler);
  };
}

export type Platform = "windows" | "mac" | "android" | "ios" | "other";
export type BrowserName = "chrome" | "edge" | "safari" | "firefox" | "other";

export function detectPlatform(
  ua = typeof navigator === "undefined" ? "" : navigator.userAgent,
): Platform {
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "mac";
  return "other";
}

export function detectBrowser(
  ua = typeof navigator === "undefined" ? "" : navigator.userAgent,
): BrowserName {
  if (/Edg\//.test(ua)) return "edge";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Chrome\//.test(ua) || /CriOS\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua)) return "safari";
  return "other";
}

export type LocationProblem = "blocked_in_browser" | "off_in_device" | "timeout" | "unsupported";

/** Turns a failed fix + permission state into the problem to explain. */
export function locationProblem(error: string, permission: LocationPermission): LocationProblem {
  if (error === "geolocation_unsupported") return "unsupported";
  if (error === "timeout") return "timeout";
  // Allowed for the site but still refused = the OS blocks the browser.
  if (error === "permission_denied")
    return permission === "granted" ? "off_in_device" : "blocked_in_browser";
  return "off_in_device";
}

const BROWSER_LABEL: Record<BrowserName, string> = {
  chrome: "Chrome",
  edge: "Edge",
  safari: "Safari",
  firefox: "Firefox",
  other: "your browser",
};

/** Step-by-step instructions for the user's device. */
export function locationSteps(
  problem: LocationProblem,
  platform: Platform,
  browser: BrowserName,
): string[] {
  const b = BROWSER_LABEL[browser];
  if (problem === "unsupported")
    return [`This browser cannot share location. Open the CRM in Chrome and try again.`];
  if (problem === "timeout")
    return [
      "Your location is taking too long to load.",
      "Make sure Wi-Fi is ON (laptops find their location through Wi-Fi), move near a window, then press Try again.",
    ];
  if (problem === "blocked_in_browser") {
    if (platform === "ios")
      return [
        "Open iPhone Settings → Privacy & Security → Location Services → turn it ON.",
        `Scroll to ${browser === "chrome" ? "Chrome" : "Safari Websites"} → choose "While Using the App".`,
        "Come back here and press Try again.",
      ];
    if (platform === "android")
      return [
        "Tap the icon on the left of the address bar (🔒 or ⚙).",
        'Tap "Permissions" (or "Site settings") → Location → Allow.',
        "Come back and press Try again.",
      ];
    return [
      `In ${b}, click the icon on the left of the address bar (🔒 or the settings slider).`,
      'Find "Location" and switch it to Allow (or click "Site settings" → Location → Allow).',
      "This window retries by itself once you allow it — or press Try again.",
    ];
  }
  // Location switched off for the whole device.
  if (platform === "windows")
    return [
      "Open Windows Settings → Privacy & security → Location.",
      'Turn ON "Location services" and "Let desktop apps access your location".',
      "Keep Wi-Fi ON, then press Try again.",
    ];
  if (platform === "mac")
    return [
      "Open System Settings → Privacy & Security → Location Services.",
      `Turn Location Services ON, and switch ON ${b} in the list.`,
      `Quit and reopen ${b} if it asks, then press Try again.`,
    ];
  if (platform === "android")
    return [
      "Swipe down from the top of the screen and turn ON Location.",
      `If it still fails: Settings → Location → App permissions → ${b} → Allow.`,
      "Press Try again.",
    ];
  if (platform === "ios")
    return [
      "Open Settings → Privacy & Security → Location Services → turn it ON.",
      `Set ${browser === "chrome" ? "Chrome" : "Safari Websites"} to "While Using the App", then press Try again.`,
    ];
  return ["Turn on location for this device and browser, then press Try again."];
}

/** Thrown by the punch mutations when the user closes the location dialog. */
export const LOCATION_CANCELLED = "location_cancelled";
