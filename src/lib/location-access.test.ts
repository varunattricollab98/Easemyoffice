// Why a punch could not read the location, and what we tell the user to do.
//
// This is the code behind the October 2026 incident where "every single
// employee" was blocked: Chrome on laptops refused location, links opened
// inside WhatsApp could not share it at all, and the dialog has to name the
// right fix for each device or people simply cannot mark attendance.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectBrowser,
  detectPlatform,
  isInAppBrowser,
  locationProblem,
  locationSteps,
  type BrowserName,
  type LocationProblem,
  type Platform,
} from "./location-access";

const UA = {
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.0.0 Mobile/15E148 Safari/604.1",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macFirefox:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0",
  whatsapp:
    "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36 WhatsApp/2.24.20.78 A",
  instagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 325.0.0.17.108",
  facebook:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 [FBAN/FBIOS;FBAV/450.0.0.38.108]",
  androidWebview:
    "Mozilla/5.0 (Linux; Android 14; SM-S911B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36",
  gmail:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/330.0.636715751 Mobile/15E148 Safari/604.1",
};

/** locationProblem() reads navigator.userAgent through isInAppBrowser(). */
function withUserAgent(ua: string) {
  vi.stubGlobal("navigator", { userAgent: ua });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detectPlatform", () => {
  it("names the four platforms we give instructions for", () => {
    expect(detectPlatform(UA.androidChrome)).toBe("android");
    expect(detectPlatform(UA.iphoneSafari)).toBe("ios");
    expect(detectPlatform(UA.windowsChrome)).toBe("windows");
    expect(detectPlatform(UA.macSafari)).toBe("mac");
    expect(detectPlatform("")).toBe("other");
  });

  it("reads an iPad and a Linux desktop", () => {
    expect(detectPlatform("Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)")).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("other");
  });
});

describe("detectBrowser", () => {
  it("does not mistake Edge or Chrome for Safari", () => {
    // Every Chromium UA also contains "Safari/537.36", so order matters.
    expect(detectBrowser(UA.windowsEdge)).toBe("edge");
    expect(detectBrowser(UA.windowsChrome)).toBe("chrome");
    expect(detectBrowser(UA.androidChrome)).toBe("chrome");
    expect(detectBrowser(UA.macSafari)).toBe("safari");
  });

  it("reads Chrome on iOS (CriOS) and Firefox", () => {
    expect(detectBrowser(UA.iphoneChrome)).toBe("chrome");
    expect(detectBrowser(UA.macFirefox)).toBe("firefox");
    expect(detectBrowser("")).toBe("other");
  });
});

describe("isInAppBrowser", () => {
  it("detects the apps whose built-in browser cannot share location", () => {
    expect(isInAppBrowser(UA.whatsapp)).toBe(true);
    expect(isInAppBrowser(UA.instagram)).toBe(true);
    expect(isInAppBrowser(UA.facebook)).toBe(true);
    expect(isInAppBrowser(UA.gmail)).toBe(true);
    // Android WebView: the "; wv)" token. This is the one that also loses
    // storage, which made the same phone look like a new device every day.
    expect(isInAppBrowser(UA.androidWebview)).toBe(true);
  });

  it("does not flag a real browser", () => {
    expect(isInAppBrowser(UA.androidChrome)).toBe(false);
    expect(isInAppBrowser(UA.iphoneSafari)).toBe(false);
    expect(isInAppBrowser(UA.windowsChrome)).toBe(false);
    expect(isInAppBrowser(UA.windowsEdge)).toBe(false);
    expect(isInAppBrowser(UA.macFirefox)).toBe(false);
  });
});

describe("locationProblem", () => {
  it("blames the operating system when the site itself is allowed", () => {
    // The Windows-laptop case: permission granted to the site, but Windows
    // location services are off, so the browser still refuses.
    withUserAgent(UA.windowsChrome);
    expect(locationProblem("permission_denied", "granted")).toBe("off_in_device");
  });

  it("blames the browser when the site is blocked or undecided", () => {
    withUserAgent(UA.windowsChrome);
    expect(locationProblem("permission_denied", "denied")).toBe("blocked_in_browser");
    expect(locationProblem("permission_denied", "prompt")).toBe("blocked_in_browser");
    expect(locationProblem("permission_denied", "unknown")).toBe("blocked_in_browser");
  });

  it("keeps timeout and unsupported separate", () => {
    withUserAgent(UA.windowsChrome);
    expect(locationProblem("timeout", "granted")).toBe("timeout");
    expect(locationProblem("geolocation_unsupported", "unknown")).toBe("unsupported");
  });

  it("falls back to the device for an unknown error", () => {
    withUserAgent(UA.androidChrome);
    expect(locationProblem("position_unavailable", "granted")).toBe("off_in_device");
    expect(locationProblem("", "unknown")).toBe("off_in_device");
  });

  it("an in-app browser outranks every other diagnosis", () => {
    // Nothing the user does in WhatsApp's browser will help, so these steps
    // must win even when the error looks like a plain denial or timeout.
    withUserAgent(UA.whatsapp);
    expect(locationProblem("permission_denied", "denied")).toBe("in_app_browser");
    expect(locationProblem("timeout", "granted")).toBe("in_app_browser");
    expect(locationProblem("geolocation_unsupported", "unknown")).toBe("in_app_browser");
  });
});

describe("locationSteps", () => {
  const problems: LocationProblem[] = [
    "in_app_browser",
    "blocked_in_browser",
    "off_in_device",
    "timeout",
    "unsupported",
  ];
  const platforms: Platform[] = ["windows", "mac", "android", "ios", "other"];
  const browsers: BrowserName[] = ["chrome", "edge", "safari", "firefox", "other"];

  it("always returns usable steps, never an empty list or a raw token", () => {
    for (const problem of problems)
      for (const platform of platforms)
        for (const browser of browsers) {
          const steps = locationSteps(problem, platform, browser);
          expect(steps.length).toBeGreaterThan(0);
          for (const s of steps) {
            expect(s.trim().length).toBeGreaterThan(10);
            // A missing BROWSER_LABEL entry would print "undefined" at the user.
            expect(s).not.toContain("undefined");
          }
        }
  });

  it("tells an in-app browser user to reopen in a real browser", () => {
    expect(locationSteps("in_app_browser", "ios", "safari").join(" ")).toContain("Safari");
    expect(locationSteps("in_app_browser", "android", "chrome").join(" ")).toContain("Chrome");
  });

  it("points Windows at the OS setting and mentions Wi-Fi", () => {
    // Laptops locate themselves over Wi-Fi; with it off the read just times out.
    const steps = locationSteps("off_in_device", "windows", "chrome").join(" ");
    expect(steps).toContain("Windows Settings");
    expect(steps).toContain("Wi-Fi");
  });

  it("names the actual browser in the address-bar steps", () => {
    expect(locationSteps("blocked_in_browser", "windows", "edge").join(" ")).toContain("Edge");
    expect(locationSteps("blocked_in_browser", "mac", "firefox").join(" ")).toContain("Firefox");
    // Mobile steps are about the site icon, not a desktop browser name.
    expect(locationSteps("blocked_in_browser", "android", "chrome").join(" ")).toContain(
      "Permissions",
    );
  });

  it("suggests Wi-Fi for a timeout", () => {
    expect(locationSteps("timeout", "mac", "safari").join(" ")).toContain("Wi-Fi");
  });
});
