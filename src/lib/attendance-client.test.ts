// Browser side of a punch: who this device is, and getting a GPS fix good
// enough for the server to accept.
//
// This is the code behind the October 2026 attendance incident. Two failures
// hit the whole team and neither had a test:
//   - the same phone kept coming back as a NEW device (needing approval)
//     because its id lived in one store that the browser cleared;
//   - "GPS reading is too imprecise" on phones and laptops, because a single
//     one-shot read was taken before the receiver had sharpened.
// Nothing here decides a verdict (the edge function does), so these tests are
// about never losing the device identity and never giving up on a fix early.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeFunction = vi.fn();
vi.mock("@/lib/edge-functions", () => ({
  invokeFunction: (...args: unknown[]) => invokeFunction(...args),
}));

import { describeDevice, getDeviceKey, punch, readPosition, type Fix } from "./attendance-client";

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";

// --- fakes -----------------------------------------------------------------

/** localStorage that can also be made to throw, like Safari in private mode. */
function fakeStorage(opts: { throws?: boolean } = {}) {
  const map = new Map<string, string>();
  return {
    map,
    api: {
      getItem: (k: string) => {
        if (opts.throws) throw new Error("storage disabled");
        return map.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        if (opts.throws) throw new Error("storage disabled");
        map.set(k, v);
      },
      removeItem: (k: string) => void map.delete(k),
    },
  };
}

/** document.cookie with real get/set semantics (set one, read them all back). */
function fakeCookieJar(opts: { frozen?: boolean } = {}) {
  const jar = new Map<string, string>();
  const document = {
    get cookie() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(raw: string) {
      if (opts.frozen) return; // cookies blocked by the browser
      const [pair] = raw.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i).trim(), pair.slice(i + 1));
    },
  };
  return { jar, document };
}

type Coords = { latitude: number; longitude: number; accuracy: number };
const position = (accuracy: number, lat = 28.631512, lng = 77.216734, timestamp = 1_000) => ({
  coords: { latitude: lat, longitude: lng, accuracy } as Coords,
  timestamp,
});
/** GeolocationPositionError carries the code constants on the instance. */
const geoError = (code: 1 | 2 | 3) => ({
  code,
  PERMISSION_DENIED: 1,
  POSITION_UNAVAILABLE: 2,
  TIMEOUT: 3,
  message: "",
});

function mockGeolocation() {
  const state = {
    watchOptions: null as PositionOptions | null,
    coarseOptions: null as PositionOptions | null,
    cleared: [] as number[],
    coarseCalls: 0,
    onPosition: (_p: unknown) => {},
    onError: (_e: unknown) => {},
    /** readCoarse passes the same resolve as both callbacks. */
    coarseResolve: null as ((v: unknown) => void) | null,
    throwOnWatch: false,
  };
  const geolocation = {
    watchPosition: (ok: (p: unknown) => void, err: (e: unknown) => void, o: PositionOptions) => {
      if (state.throwOnWatch) throw new Error("watchPosition unavailable");
      state.onPosition = ok;
      state.onError = err;
      state.watchOptions = o;
      return 7;
    },
    clearWatch: (id: number) => state.cleared.push(id),
    getCurrentPosition: (ok: (p: unknown) => void, _e: unknown, o: PositionOptions) => {
      state.coarseCalls++;
      state.coarseOptions = o;
      state.coarseResolve = ok;
    },
  };
  vi.stubGlobal("navigator", { geolocation, userAgent: ANDROID_UA });
  return state;
}

/** Lets the pending promise chain inside readPosition run. */
const flush = () => vi.advanceTimersByTimeAsync(0);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  invokeFunction.mockReset();
});

// --- device identity -------------------------------------------------------

describe("getDeviceKey", () => {
  it("mints one id and mirrors it into localStorage and a cookie", () => {
    const store = fakeStorage();
    const { jar, document } = fakeCookieJar();
    vi.stubGlobal("localStorage", store.api);
    vi.stubGlobal("document", document);

    const key = getDeviceKey();
    expect(key).toBeTruthy();
    expect(key).not.toBe("ephemeral");
    expect(store.map.get("emo:attendance-device")).toBe(key);
    expect(jar.get("emo_dk")).toBe(encodeURIComponent(key));
    // Asking again must never produce a second identity for the same browser.
    expect(getDeviceKey()).toBe(key);
  });

  it("recovers the id from the cookie when localStorage was cleared", () => {
    // Clearing site data / "clear browsing data" wipes localStorage but the
    // cookie survives — this is what stopped the daily "new device" rows.
    const store = fakeStorage();
    const { document } = fakeCookieJar();
    vi.stubGlobal("localStorage", store.api);
    vi.stubGlobal("document", document);
    document.cookie = "emo_dk=known-device";

    expect(getDeviceKey()).toBe("known-device");
    expect(store.map.get("emo:attendance-device")).toBe("known-device");
  });

  it("recovers the id from localStorage when the cookie was cleared", () => {
    const store = fakeStorage();
    const { jar, document } = fakeCookieJar();
    store.map.set("emo:attendance-device", "known-device");
    vi.stubGlobal("localStorage", store.api);
    vi.stubGlobal("document", document);

    expect(getDeviceKey()).toBe("known-device");
    expect(jar.get("emo_dk")).toBe("known-device");
  });

  it("prefers localStorage and leaves both stores agreeing", () => {
    const store = fakeStorage();
    const { jar, document } = fakeCookieJar();
    store.map.set("emo:attendance-device", "from-storage");
    vi.stubGlobal("localStorage", store.api);
    vi.stubGlobal("document", document);
    document.cookie = "emo_dk=from-cookie";

    expect(getDeviceKey()).toBe("from-storage");
    expect(jar.get("emo_dk")).toBe("from-storage");
  });

  it("decodes a cookie value that had to be escaped", () => {
    const { document } = fakeCookieJar();
    vi.stubGlobal("localStorage", fakeStorage().api);
    vi.stubGlobal("document", document);
    document.cookie = `emo_dk=${encodeURIComponent("a b+c")}`;
    expect(getDeviceKey()).toBe("a b+c");
  });

  it("falls back to the cookie when localStorage throws", () => {
    // Private mode / "block third-party storage" makes every call throw.
    const { document } = fakeCookieJar();
    vi.stubGlobal("localStorage", fakeStorage({ throws: true }).api);
    vi.stubGlobal("document", document);
    document.cookie = "emo_dk=known-device";
    expect(getDeviceKey()).toBe("known-device");
  });

  it("returns 'ephemeral' only when both stores are unusable", () => {
    // The punch still reaches the server and is audited; with device approval
    // required it is simply refused rather than silently accepted.
    vi.stubGlobal("localStorage", fakeStorage({ throws: true }).api);
    vi.stubGlobal("document", fakeCookieJar({ frozen: true }).document);
    expect(getDeviceKey()).toBe("ephemeral");
  });

  it("survives a browser with no cookie support at all", () => {
    const store = fakeStorage();
    vi.stubGlobal("localStorage", store.api);
    vi.stubGlobal("document", undefined);
    const key = getDeviceKey();
    expect(key).not.toBe("ephemeral");
    expect(store.map.get("emo:attendance-device")).toBe(key);
  });
});

describe("describeDevice", () => {
  it("names the browser and OS for the admin device list", () => {
    expect(describeDevice(ANDROID_UA)).toBe("Chrome on Android");
    expect(
      describeDevice(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari on iOS");
    expect(
      describeDevice(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
      ),
    ).toBe("Edge on Windows");
    expect(
      describeDevice(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/129.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome on macOS");
  });

  it("never returns an empty label for an unknown agent", () => {
    expect(describeDevice("")).toBe("Browser on Unknown OS");
    expect(describeDevice("curl/8.5.0")).toBe("Browser on Unknown OS");
  });
});

// --- getting a fix ---------------------------------------------------------

describe("readPosition", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("reports the browser having no geolocation at all", async () => {
    vi.stubGlobal("navigator", { userAgent: ANDROID_UA });
    await expect(readPosition()).resolves.toEqual({
      ok: false,
      error: "geolocation_unsupported",
    });
  });

  it("asks for a fresh high-accuracy fix, never a cached one", async () => {
    // maximumAge:0 is why "Use my location" stopped returning yesterday's
    // coordinates; the 9 s window is the time allowed to sharpen.
    const geo = mockGeolocation();
    void readPosition();
    await flush();
    expect(geo.watchOptions).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });
    // The sampling window is the worst case a user can be made to wait.
    expect(geo.watchOptions?.timeout).toBe(4000);
  });

  it("keeps the most accurate of several readings and reports the spread", async () => {
    const geo = mockGeolocation();
    const p = readPosition();
    // A phone sharpens: 150 m, then 60 m, then 30 m.
    geo.onPosition(position(150, 28.6318, 77.2167));
    geo.onPosition(position(60, 28.6316, 77.2167));
    geo.onPosition(position(30, 28.631512, 77.216734, 4_200));
    await vi.advanceTimersByTimeAsync(9000);

    const fix = await p;
    expect(fix.ok).toBe(true);
    if (!fix.ok) return;
    expect(fix.accuracy).toBe(30);
    expect(fix.latitude).toBe(28.631512);
    expect(fix.timestamp).toBe(4_200);
    expect(fix.samples).toBe(3);
    // Spread is the distance from the chosen reading to the furthest one.
    expect(fix.spreadM).toBeGreaterThan(20);
    expect(fix.spreadM).toBeLessThan(80);
    expect(geo.cleared).toEqual([7]);
  });

  it("stops early once a reading is sharp enough", async () => {
    const geo = mockGeolocation();
    const p = readPosition();
    geo.onPosition(position(80));
    geo.onPosition(position(18)); // within 25 m and the second reading
    await flush();

    const fix = await p;
    expect(fix.ok && fix.accuracy).toBe(18);
    expect(fix.ok && fix.samples).toBe(2);
    expect(geo.cleared).toEqual([7]);
    // No need for the coarse fallback when the watch produced a fix.
    expect(geo.coarseCalls).toBe(0);
  });

  it("goes on the very first sharp reading, without waiting", async () => {
    // This is the whole point of the speed work: a punch used to sit out the
    // sampling window even when the first fix was already good. `maximumAge:0`
    // rules out a cached reading, which is what a second one guarded against.
    const geo = mockGeolocation();
    const p = readPosition();
    geo.onPosition(position(8));
    await flush();

    expect(await p).toMatchObject({ ok: true, accuracy: 8, samples: 1, spreadM: 0 });
    expect(geo.cleared).toEqual([7]);
    expect(geo.coarseCalls).toBe(0);
  });

  it("gives a middling reading one more chance to sharpen", async () => {
    // 40 m is inside the server's 50 m limit but worth a second look; the
    // better of the two is used.
    const geo = mockGeolocation();
    let settled = false;
    const p = readPosition().then((f) => {
      settled = true;
      return f;
    });
    geo.onPosition(position(40));
    await flush();
    expect(settled).toBe(false);

    geo.onPosition(position(34));
    await flush();
    expect(await p).toMatchObject({ ok: true, accuracy: 34, samples: 2 });
  });

  it("waits out the window only while every reading is too vague", async () => {
    // A fix the server would reject (over 50 m) is never worth settling for
    // early — keep sampling and hand over the best of a bad lot.
    const geo = mockGeolocation();
    let settled = false;
    const p = readPosition().then((f) => {
      settled = true;
      return f;
    });
    geo.onPosition(position(900));
    geo.onPosition(position(400));
    await flush();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(4000);
    expect(await p).toMatchObject({ ok: true, accuracy: 400, samples: 2 });
  });

  it("falls back to a coarse read when high accuracy times out (laptops)", async () => {
    // A laptop has no GPS: high-accuracy mode fails, Wi-Fi positioning works.
    const geo = mockGeolocation();
    const p = readPosition();
    geo.onError(geoError(3)); // TIMEOUT, no readings yet
    await flush();
    expect(geo.coarseCalls).toBe(1);
    expect(geo.coarseOptions).toMatchObject({ enableHighAccuracy: false, maximumAge: 30000 });

    geo.coarseResolve?.(position(1800));
    expect(await p).toMatchObject({ ok: true, accuracy: 1800, samples: 1 });
  });

  it("does not retry after the user denied location", async () => {
    // Asking again would only show another refusal; the dialog explains the
    // browser steps instead.
    const geo = mockGeolocation();
    const p = readPosition();
    geo.onError(geoError(1)); // PERMISSION_DENIED
    await flush();
    expect(await p).toEqual({ ok: false, error: "permission_denied" });
    expect(geo.coarseCalls).toBe(0);
  });

  it("gives up with the real reason when the coarse read also fails", async () => {
    const geo = mockGeolocation();
    const p = readPosition();
    geo.onError(geoError(3));
    await flush();
    geo.coarseResolve?.(geoError(2)); // POSITION_UNAVAILABLE
    expect(await p).toEqual({ ok: false, error: "position_unavailable" });
  });

  it("maps a coarse timeout to 'timeout' so the dialog can mention Wi-Fi", async () => {
    const geo = mockGeolocation();
    const p = readPosition();
    geo.onError(geoError(3));
    await flush();
    geo.coarseResolve?.(geoError(3));
    expect(await p).toEqual({ ok: false, error: "timeout" });
  });

  it("ignores a late error once it already has a reading", async () => {
    const geo = mockGeolocation();
    const p = readPosition();
    geo.onPosition(position(45));
    geo.onError(geoError(3)); // the watch gives up, but we have something
    await flush();
    await vi.advanceTimersByTimeAsync(9000);
    expect(await p).toMatchObject({ ok: true, accuracy: 45 });
    expect(geo.coarseCalls).toBe(0);
  });

  it("falls back when watchPosition itself throws", async () => {
    const geo = mockGeolocation();
    geo.throwOnWatch = true;
    const p = readPosition();
    await flush();
    expect(geo.coarseCalls).toBe(1);
    geo.coarseResolve?.(position(900));
    expect(await p).toMatchObject({ ok: true, accuracy: 900 });
  });

  it("resolves exactly once even if readings keep arriving", async () => {
    const geo = mockGeolocation();
    const p = readPosition();
    geo.onPosition(position(20));
    geo.onPosition(position(10));
    await flush();
    const first = await p;
    // Stray callbacks after the watch was cleared must not change the answer
    // or start a coarse read.
    geo.onPosition(position(5));
    geo.onError(geoError(3));
    await vi.advanceTimersByTimeAsync(9000);
    expect(await p).toEqual(first);
    expect(geo.cleared).toEqual([7]);
    expect(geo.coarseCalls).toBe(0);
  });
});

// --- sending the punch -----------------------------------------------------

describe("punch", () => {
  const GOOD: Fix = {
    ok: true,
    latitude: 28.631512,
    longitude: 77.216734,
    accuracy: 14,
    timestamp: 1_700_000_000_000,
    samples: 3,
    spreadM: 2.5,
  };

  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage().api);
    vi.stubGlobal("document", fakeCookieJar().document);
    vi.stubGlobal("navigator", { userAgent: ANDROID_UA });
  });

  const bodyOf = () => invokeFunction.mock.calls[0][1] as Record<string, unknown>;

  it("sends the device identity, the fix and its quality signals", async () => {
    invokeFunction.mockResolvedValue({ ok: true, action: "login", attendance: { id: "a1" } });
    const res = await punch("login", { fix: GOOD });

    expect(invokeFunction).toHaveBeenCalledTimes(1);
    expect(invokeFunction.mock.calls[0][0]).toBe("attendance-punch");
    expect(bodyOf()).toMatchObject({
      action: "login",
      device_label: "Chrome on Android",
      latitude: GOOD.latitude,
      longitude: GOOD.longitude,
      accuracy: 14,
      fix_timestamp: GOOD.timestamp,
      fix_samples: 3,
      fix_spread_m: 2.5,
    });
    expect(bodyOf().device_key).toBeTruthy();
    expect(bodyOf().client_error).toBeUndefined();
    // The caller gets the fix back so a follow-up WFH request can reuse it
    // instead of waiting for GPS twice.
    expect(res.fix).toEqual(GOOD);
    expect(res.ok).toBe(true);
  });

  it("still reports a failed fix so the attempt is audited", async () => {
    invokeFunction.mockResolvedValue({ ok: false, reason: "no_location", message: "No location" });
    const fix: Fix = { ok: false, error: "permission_denied" };
    const res = await punch("login", { fix });

    expect(bodyOf()).toMatchObject({ action: "login", client_error: "permission_denied" });
    expect(bodyOf().latitude).toBeUndefined();
    expect(bodyOf().accuracy).toBeUndefined();
    expect(res.ok).toBe(false);
    expect(res.fix).toEqual(fix);
  });

  it("passes a work-from-home request with its reason", async () => {
    invokeFunction.mockResolvedValue({ ok: true, action: "login", attendance: {}, remote: true });
    await punch("login", { fix: { ok: false, error: "timeout" }, remote: true, reason: "Fever" });
    expect(bodyOf()).toMatchObject({ remote: true, remote_reason: "Fever" });
  });

  it("passes a late-login reason and omits it otherwise", async () => {
    invokeFunction.mockResolvedValue({ ok: true, action: "login", attendance: {} });
    await punch("login", { fix: GOOD, lateReason: "Metro delay" });
    expect(bodyOf().late_reason).toBe("Metro delay");

    invokeFunction.mockReset();
    invokeFunction.mockResolvedValue({ ok: true, action: "login", attendance: {} });
    await punch("login", { fix: GOOD });
    expect(bodyOf().late_reason).toBeUndefined();
  });

  it("reads the location itself when the caller has no fix", async () => {
    vi.useFakeTimers();
    const geo = mockGeolocation();
    invokeFunction.mockResolvedValue({ ok: true, action: "logout", attendance: {} });
    const p = punch("logout");
    await flush();
    geo.onPosition(position(12));
    await flush();
    await p;
    expect(bodyOf()).toMatchObject({ action: "logout", accuracy: 12 });
  });

  it("surfaces a hard error from the function instead of returning it", async () => {
    invokeFunction.mockResolvedValue({ error: "Not signed in." });
    await expect(punch("login", { fix: GOOD })).rejects.toThrow("Not signed in.");
  });

  it("lets a transport failure through to the caller", async () => {
    invokeFunction.mockRejectedValue(new Error("The service is unreachable"));
    await expect(punch("login", { fix: GOOD })).rejects.toThrow("The service is unreachable");
  });
});

// --- recognising the same hardware ----------------------------------------

/**
 * A fresh copy of the module (the fingerprint is cached per load) against a
 * fake device.
 */
async function loadClient(
  device: {
    width?: number;
    height?: number;
    dpr?: number;
    platform?: string;
    cores?: number;
    memory?: number;
    noScreen?: boolean;
  } = {},
) {
  if (device.noScreen) vi.stubGlobal("screen", undefined);
  else vi.stubGlobal("screen", { width: device.width ?? 412, height: device.height ?? 915 });
  vi.stubGlobal("window", { devicePixelRatio: device.dpr ?? 2.625 });
  vi.stubGlobal("navigator", {
    userAgent: ANDROID_UA,
    platform: device.platform ?? "Linux armv8l",
    hardwareConcurrency: device.cores ?? 8,
    deviceMemory: device.memory ?? 8,
  });
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
  vi.stubGlobal("localStorage", fakeStorage().api);
  vi.resetModules();
  return import("./attendance-client");
}

describe("deviceFingerprints", () => {
  // A Galaxy S23 in portrait: 412 x 915 CSS pixels at a 2.625 ratio.
  const PHONE = { width: 412, height: 915, dpr: 2.625 };
  const PHONE_ROTATED = { width: 915, height: 412, dpr: 2.625 };

  it("does not change when the phone is rotated", async () => {
    // screen.width and screen.height swap on Android, and the old formula
    // used them in order — so a landscape punch asked for device approval as
    // if it came from unknown hardware.
    const a = await (await loadClient(PHONE)).deviceFingerprints();
    const b = await (await loadClient(PHONE_ROTATED)).deviceFingerprints();
    expect(a.fp).toBeTruthy();
    expect(a.fp).toBe(b.fp);
  });

  it("does not change when the page is zoomed", async () => {
    // Zooming raises devicePixelRatio and shrinks the CSS dimensions by the
    // same factor, so the physical size is the stable quantity.
    const normal = await (
      await loadClient({ width: 1920, height: 1080, dpr: 1 })
    ).deviceFingerprints();
    const zoomed = await (
      await loadClient({ width: 1536, height: 864, dpr: 1.25 })
    ).deviceFingerprints();
    expect(normal.fp).toBe(zoomed.fp);
  });

  it("still separates genuinely different hardware", async () => {
    const phone = await (await loadClient(PHONE)).deviceFingerprints();
    const tablet = await (
      await loadClient({ width: 800, height: 1280, dpr: 2 })
    ).deviceFingerprints();
    const laptop = await (
      await loadClient({ width: 1920, height: 1080, dpr: 1, platform: "Win32", cores: 16 })
    ).deviceFingerprints();
    expect(new Set([phone.fp, tablet.fp, laptop.fp]).size).toBe(3);
  });

  it("separates devices that differ only in their specs", async () => {
    const a = await (await loadClient({ ...PHONE, cores: 8, memory: 8 })).deviceFingerprints();
    const b = await (await loadClient({ ...PHONE, cores: 4, memory: 4 })).deviceFingerprints();
    expect(a.fp).not.toBe(b.fp);
  });

  it("also sends the old fingerprint, which is what moved on rotation", async () => {
    // The server looks this up as a fallback, so a device approved under the
    // old value is recognised instead of needing approval again.
    const a = await (await loadClient(PHONE)).deviceFingerprints();
    const b = await (await loadClient(PHONE_ROTATED)).deviceFingerprints();
    expect(a.legacy).toBeTruthy();
    expect(a.legacy).not.toBe(a.fp);
    // Proof of the original problem: the old value differs between the two.
    expect(a.legacy).not.toBe(b.legacy);
  });

  it("is a short hex digest, not something identifying", async () => {
    const { fp } = await (await loadClient(PHONE)).deviceFingerprints();
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
  });

  it("computes once per page load", async () => {
    const mod = await loadClient(PHONE);
    const first = await mod.deviceFingerprints();
    // Even if the device appears to change (rotation), the cached answer holds
    // for the rest of the session.
    vi.stubGlobal("screen", { width: 915, height: 412 });
    expect(await mod.deviceFingerprints()).toEqual(first);
  });

  it("gives up quietly when the browser exposes nothing to measure", async () => {
    const mod = await loadClient({ noScreen: true });
    expect(await mod.deviceFingerprints()).toEqual({ fp: null, legacy: null });
  });
});

describe("punch fingerprints", () => {
  it("sends both the stable and the legacy fingerprint", async () => {
    const mod = await loadClient({ width: 412, height: 915, dpr: 2.625 });
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => null }),
      cookie: "",
    });
    invokeFunction.mockResolvedValue({ ok: true, action: "login", attendance: {} });

    await mod.punch("login", {
      fix: { ok: true, latitude: 28.631512, longitude: 77.216734, accuracy: 14 },
    });
    const body = invokeFunction.mock.calls[0][1] as Record<string, unknown>;
    expect(body.device_fp).toMatch(/^[0-9a-f]{32}$/);
    expect(body.device_fp_legacy).toMatch(/^[0-9a-f]{32}$/);
    expect(body.device_fp).not.toBe(body.device_fp_legacy);
  });

  it("sends nulls rather than failing when there is nothing to fingerprint", async () => {
    const mod = await loadClient({ noScreen: true });
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => null }),
      cookie: "",
    });
    invokeFunction.mockResolvedValue({ ok: true, action: "login", attendance: {} });

    await mod.punch("login", { fix: { ok: false, error: "timeout" } });
    const body = invokeFunction.mock.calls[0][1] as Record<string, unknown>;
    expect(body.device_fp).toBeNull();
    expect(body.device_fp_legacy).toBeNull();
    expect(body.device_key).toBeTruthy();
  });
});
