// Tiny in-memory store of recent realtime events.
// Drives the live "Pulse" pill and per-widget glow.
import { useSyncExternalStore } from "react";

type PulseEvent = {
  at: number;
  kind: "lead" | "follow_up" | "activity";
  detail?: string;
};

const events: PulseEvent[] = [];
const listeners = new Set<() => void>();
const WINDOW_MS = 5 * 60_000;

function emit() { listeners.forEach((l) => l()); }

export function pushPulse(ev: Omit<PulseEvent, "at">) {
  events.push({ ...ev, at: Date.now() });
  // Trim
  const cutoff = Date.now() - WINDOW_MS;
  while (events.length && events[0].at < cutoff) events.shift();
  emit();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  // Tick once a second so the displayed "X updates in last 5 min" decays
  const id = setInterval(() => fn(), 1000);
  return () => { listeners.delete(fn); clearInterval(id); };
}

function snapshot() {
  const cutoff = Date.now() - WINDOW_MS;
  let count = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].at >= cutoff) count++;
    else break;
  }
  const last = events[events.length - 1];
  return { count, lastAt: last?.at ?? null, lastKind: last?.kind ?? null };
}

let cached = snapshot();
let cachedTick = 0;
function getServerSnapshot() { return cached; }
function getSnapshot() {
  // Re-evaluate at most every animation frame to keep referential stability
  const now = Date.now();
  if (now - cachedTick > 250) {
    cached = snapshot();
    cachedTick = now;
  }
  return cached;
}

export function usePulse() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
