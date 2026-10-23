// Home-screen app support: service worker registration and the browser's
// "install app" prompt.
//
// Imported for its side effects from the root route, so the one-time
// `beforeinstallprompt` event is captured even if it fires on the login page,
// before any component that offers the button has mounted.

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

// After a deploy, an app that was already open (home-screen app resumed from
// the background, a tab left open overnight) still runs the OLD build. Its
// lazily loaded page files no longer exist on the server, so opening a page
// failed and left an endless spinner. Reload once to pick up the new build.
const RELOAD_KEY = "emo:stale-build-reload";
export function reloadForNewBuild() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? "0");
    if (Date.now() - last < 30_000) return; // never loop
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    /* storage blocked: still reload once */
  }
  window.location.reload();
}
export const STALE_CHUNK =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (e) => {
    e.preventDefault();
    reloadForNewBuild();
  });
  window.addEventListener("unhandledrejection", (e) => {
    const msg = String((e.reason as { message?: string } | undefined)?.message ?? e.reason ?? "");
    if (STALE_CHUNK.test(msg)) reloadForNewBuild();
  });
  window.addEventListener("error", (e) => {
    if (STALE_CHUNK.test(String(e.message ?? ""))) reloadForNewBuild();
  });
  window.addEventListener("beforeinstallprompt", (e) => {
    // Keep Chrome's mini-infobar from showing; the CRM offers its own button.
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* installability is a nice-to-have; never break the app over it */
      });
    });
  }
}

/** Running as an installed app (home-screen icon) rather than in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iPhone/iPad Safari has no install prompt — the user adds it from the Share menu. */
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

export function usePwaInstall() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  const standalone = isStandalone();
  return {
    installed: standalone,
    /** Android / desktop Chrome & Edge: a real one-tap install is available. */
    canPrompt: !!deferred && !standalone,
    /** iOS: show "Share → Add to Home Screen" instructions instead. */
    showIosHint: isIos() && !standalone,
    install: async () => {
      if (!deferred) return false;
      const e = deferred;
      deferred = null;
      await e.prompt();
      const { outcome } = await e.userChoice;
      notify();
      return outcome === "accepted";
    },
  };
}
