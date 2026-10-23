// Recovering an app that is running a build which no longer exists.
//
// Merging deploys instantly. An app that was already open (home-screen icon
// resumed from the background, a tab left open overnight) keeps the OLD build,
// whose lazily loaded page files are gone from the server — which is what left
// people staring at a spinner mid-login in October 2026. The fix is to notice
// that specific failure and reload exactly once.

import { afterEach, describe, expect, it, vi } from "vitest";

type Listener = (e: Record<string, unknown>) => void;

/**
 * pwa.ts attaches its listeners at import time, so each test imports a fresh
 * copy against a fresh fake window.
 */
async function loadPwa(opts: { storageThrows?: boolean; standalone?: boolean; ua?: string } = {}) {
  const listeners = new Map<string, Listener[]>();
  const reload = vi.fn();
  const store = new Map<string, string>();

  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => {
      if (opts.storageThrows) throw new Error("storage blocked");
      return store.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (opts.storageThrows) throw new Error("storage blocked");
      store.set(k, v);
    },
  });
  vi.stubGlobal("window", {
    addEventListener: (type: string, fn: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    location: { reload },
    matchMedia: () => ({ matches: !!opts.standalone }),
    devicePixelRatio: 2,
  });
  vi.stubGlobal("navigator", { userAgent: opts.ua ?? "Mozilla/5.0 (Windows NT 10.0) Chrome/129" });

  vi.resetModules();
  const mod = await import("./pwa");
  const fire = (type: string, e: Record<string, unknown> = {}) =>
    (listeners.get(type) ?? []).forEach((fn) => fn(e));
  return { ...mod, fire, reload, store, listeners };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("STALE_CHUNK", () => {
  it("matches what each browser actually says when a page file is gone", async () => {
    const { STALE_CHUNK } = await loadPwa();
    const real = [
      // Chrome / Edge
      "Failed to fetch dynamically imported module: https://crm.easemyoffice.in/assets/attendance-B1xY.js",
      // Firefox
      "error loading dynamically imported module",
      // Safari
      "Importing a module script failed.",
      // Vite preloading a stylesheet that was replaced
      "Unable to preload CSS for /assets/index-D4f2.css",
    ];
    for (const m of real) expect(STALE_CHUNK.test(m)).toBe(true);
  });

  it("is case-insensitive, as the wording varies by version", async () => {
    const { STALE_CHUNK } = await loadPwa();
    expect(STALE_CHUNK.test("FAILED TO FETCH DYNAMICALLY IMPORTED MODULE")).toBe(true);
  });

  it("does not match ordinary app errors", async () => {
    // Reloading on every error would hide real bugs and could loop.
    const { STALE_CHUNK } = await loadPwa();
    const other = [
      "TypeError: x is not a function",
      "NetworkError when attempting to fetch resource.",
      "Edge Function returned a non-2xx status code",
      "Failed to fetch",
      "",
    ];
    for (const m of other) expect(STALE_CHUNK.test(m)).toBe(false);
  });
});

describe("reloadForNewBuild", () => {
  it("reloads and remembers when it did", async () => {
    const { reloadForNewBuild, reload, store } = await loadPwa();
    reloadForNewBuild();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.get("emo:stale-build-reload")).toBeTruthy();
  });

  it("never loops: a second trigger inside 30 s is ignored", async () => {
    // Two failed chunks in a row would otherwise reload forever.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T04:00:00Z"));
    const { reloadForNewBuild, reload } = await loadPwa();

    reloadForNewBuild();
    vi.setSystemTime(new Date("2026-10-23T04:00:10Z"));
    reloadForNewBuild();
    vi.setSystemTime(new Date("2026-10-23T04:00:29Z"));
    reloadForNewBuild();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("allows another reload after the guard window", async () => {
    // A second deploy later in the same session must still be picked up.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T04:00:00Z"));
    const { reloadForNewBuild, reload } = await loadPwa();

    reloadForNewBuild();
    vi.setSystemTime(new Date("2026-10-23T04:01:00Z"));
    reloadForNewBuild();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("still reloads when sessionStorage is blocked", async () => {
    // Private mode has no session storage; being stuck is worse than a
    // possible second reload.
    const { reloadForNewBuild, reload } = await loadPwa({ storageThrows: true });
    reloadForNewBuild();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("stale-build listeners", () => {
  it("handles Vite's preloadError and stops the default error", async () => {
    const { fire, reload } = await loadPwa();
    const preventDefault = vi.fn();
    fire("vite:preloadError", { preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads on a rejected dynamic import", async () => {
    const { fire, reload } = await loadPwa();
    fire("unhandledrejection", {
      reason: new Error("Failed to fetch dynamically imported module: /assets/leads-X.js"),
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reads a rejection reason that is not an Error", async () => {
    const { fire, reload } = await loadPwa();
    fire("unhandledrejection", { reason: "Importing a module script failed." });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("ignores an unrelated rejection", async () => {
    const { fire, reload } = await loadPwa();
    fire("unhandledrejection", { reason: new Error("Row not found") });
    fire("unhandledrejection", {});
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads on a window error for a missing module", async () => {
    const { fire, reload } = await loadPwa();
    fire("error", { message: "Unable to preload CSS for /assets/index-D4f2.css" });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("ignores an ordinary window error", async () => {
    const { fire, reload } = await loadPwa();
    fire("error", { message: "Uncaught TypeError: undefined is not an object" });
    fire("error", {});
    expect(reload).not.toHaveBeenCalled();
  });

  it("registers for all three failure channels", async () => {
    // A dynamic import can surface as any of these depending on the browser.
    const { listeners } = await loadPwa();
    for (const type of ["vite:preloadError", "unhandledrejection", "error"])
      expect(listeners.get(type)?.length).toBe(1);
  });
});

describe("install state", () => {
  it("reads the installed app from the display mode", async () => {
    expect((await loadPwa({ standalone: true })).isStandalone()).toBe(true);
    expect((await loadPwa({ standalone: false })).isStandalone()).toBe(false);
  });

  it("recognises iOS, which has no install prompt", async () => {
    const ios = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1";
    expect((await loadPwa({ ua: ios })).isIos()).toBe(true);
    expect((await loadPwa({ ua: "Mozilla/5.0 (Linux; Android 14) Chrome/129" })).isIos()).toBe(
      false,
    );
  });
});
