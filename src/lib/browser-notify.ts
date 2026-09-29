// Native OS/browser notifications, so a rep sees pending work even when the CRM
// tab is not the one they are looking at.
//
// Deliberately uses the plain Notification API and no service worker. That means
// alerts only fire while a CRM tab is open somewhere — which matches the actual
// need (a rep with the CRM open in a background tab) and avoids shipping a
// service worker whose caching would have to be reasoned about on every deploy.
// Push notifications to a closed browser would need a service worker plus a push
// subscription backend; that is a separate, much larger piece of work.

const STORAGE_KEY = "emo:browser-notify";

export type NotifyState = "unsupported" | "default" | "granted" | "denied";

const hasSupport = () => typeof window !== "undefined" && "Notification" in window;

/** Current permission, normalised for SSR and unsupported browsers. */
export function notifyState(): NotifyState {
  if (!hasSupport()) return "unsupported";
  return Notification.permission as NotifyState;
}

/** Whether the user has switched desktop alerts ON inside the CRM. */
export function notifyEnabled(): boolean {
  if (!hasSupport()) return false;
  if (Notification.permission !== "granted") return false;
  try {
    // Granted-but-off is a real state: the browser remembers permission forever,
    // so the app needs its own switch to let someone turn the noise off without
    // digging into browser settings.
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setNotifyEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* storage unavailable — the permission itself still governs behaviour */
  }
}

/**
 * Asks the browser for permission. MUST be called from a user gesture (a click);
 * browsers ignore or auto-deny permission prompts that fire on page load.
 */
export async function requestBrowserNotifications(): Promise<NotifyState> {
  if (!hasSupport()) return "unsupported";
  if (Notification.permission === "granted") {
    setNotifyEnabled(true);
    return "granted";
  }
  if (Notification.permission === "denied") return "denied";
  const result = await Notification.requestPermission();
  if (result === "granted") setNotifyEnabled(true);
  return result as NotifyState;
}

// Titles already shown recently, so the 30s catch-up poll in NotificationsWatcher
// cannot re-pop something the realtime channel already delivered.
const recent = new Map<string, number>();
const DEDUPE_MS = 5 * 60_000;

/**
 * Shows an OS notification.
 *
 * Suppressed while the CRM tab is visible: an in-app toast already covers that
 * case, and firing both means every event interrupts twice. Pass `force` for
 * something that must surface regardless.
 */
export function showBrowserNotification(opts: {
  title: string;
  body?: string;
  /** Collapses repeats of the same thing into one OS notification. */
  tag?: string;
  /** Opened (and the tab focused) when the notification is clicked. */
  url?: string;
  force?: boolean;
}): void {
  if (!notifyEnabled()) return;
  if (!opts.force && document.visibilityState === "visible") return;

  const key = opts.tag || opts.title;
  const now = Date.now();
  const last = recent.get(key);
  if (last && now - last < DEDUPE_MS) return;
  recent.set(key, now);
  // Keep the map from growing without bound over a long session.
  if (recent.size > 200) {
    for (const [k, t] of recent) if (now - t > DEDUPE_MS) recent.delete(k);
  }

  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      tag: opts.tag,
      // Without this a re-sent tag stays silent, which would hide genuinely
      // repeated reminders such as an overdue task nagging on its cadence.
      renotify: !!opts.tag,
    } as NotificationOptions);
    n.onclick = () => {
      window.focus();
      if (opts.url) window.location.href = opts.url;
      n.close();
    };
  } catch {
    /* some browsers throw when constructing notifications in odd contexts */
  }
}
