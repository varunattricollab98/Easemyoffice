// CRM activity heartbeat for idle tracking.
//
// While someone is logged in for attendance, every real interaction with the
// CRM (click, key, scroll, touch, mouse movement) keeps them "active". At most
// every couple of minutes an interaction pings `attendance_heartbeat()`; the
// database uses its own clock, and when the gap since the previous ping reaches
// the idle threshold (60 min by default) that gap is recorded as idle time.
//
// Nothing is sent while the user is inactive, so a closed laptop, a closed tab
// or a CRM left untouched in the background all show up as idle — which is the
// point for work-from-home days.

import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/** Minimum spacing between pings while active. Bounds idle accuracy to ~2 min. */
const SEND_EVERY_MS = 2 * 60_000;
/** When not logged in for attendance (or not an employee), re-check this rarely. */
const NOT_TRACKING_BACKOFF_MS = 10 * 60_000;
/** Fired by the attendance page after a LOGIN / LOGOUT so tracking starts at once. */
export const ATTENDANCE_CHANGED_EVENT = "emo:attendance-changed";

export function ActivityHeartbeat() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id) return;
    let lastSent = 0;
    let nextAllowed = 0;
    let inFlight = false;

    const send = async () => {
      const now = Date.now();
      if (inFlight || now < nextAllowed || now - lastSent < SEND_EVERY_MS) return;
      inFlight = true;
      lastSent = now;
      try {
        const { data, error } = await supabase.rpc("attendance_heartbeat" as never);
        const tracking = !error && (data as { tracking?: boolean } | null)?.tracking === true;
        nextAllowed = tracking ? 0 : Date.now() + NOT_TRACKING_BACKOFF_MS;
      } catch {
        nextAllowed = Date.now() + NOT_TRACKING_BACKOFF_MS;
      } finally {
        inFlight = false;
      }
    };

    const onActivity = () => void send();
    const onVisible = () => {
      if (document.visibilityState === "visible") void send();
    };
    const onAttendanceChanged = () => {
      nextAllowed = 0;
      lastSent = 0;
    };

    const opts: AddEventListenerOptions = { passive: true, capture: true };
    const events = [
      "pointerdown",
      "keydown",
      "wheel",
      "touchstart",
      "mousemove",
      "scroll",
    ] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, opts));
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(ATTENDANCE_CHANGED_EVENT, onAttendanceChanged);
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity, opts));
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(ATTENDANCE_CHANGED_EVENT, onAttendanceChanged);
    };
  }, [user?.id]);

  return null;
}
