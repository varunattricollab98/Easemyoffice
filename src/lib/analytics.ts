// Lightweight client-side event tracking.
// Persists to localStorage as a fallback / offline buffer.
// For `kpi_tile_click` events we ALSO insert into the `kpi_events` table
// so the admin report can aggregate across all devices and users.
import { supabase } from "@/integrations/supabase/client";

export type AnalyticsEvent = {
  name: string;
  props?: Record<string, string | number | boolean | null>;
  ts: number;
  userId?: string | null;
  team?: string | null;
};

const KEY = "analytics:events:v1";
const ACTOR_KEY = "analytics:actor:v1";
const MAX = 2000;

type Actor = { userId: string | null; team: string | null };

function read(): AnalyticsEvent[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as AnalyticsEvent[];
  } catch {
    return [];
  }
}

function readActor(): Actor {
  if (typeof window === "undefined") return { userId: null, team: null };
  try {
    return JSON.parse(localStorage.getItem(ACTOR_KEY) ?? "{}") as Actor;
  } catch {
    return { userId: null, team: null };
  }
}

/** Set the active user + team so subsequent events are attributed correctly. */
export function setAnalyticsActor(actor: Actor) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ACTOR_KEY, JSON.stringify(actor));
  } catch {
    /* ignore */
  }
}

export function track(name: string, props?: AnalyticsEvent["props"]) {
  if (typeof window === "undefined") return;
  const actor = readActor();
  const evt: AnalyticsEvent = {
    name,
    props,
    ts: Date.now(),
    userId: actor.userId,
    team: actor.team,
  };
  const list = [...read(), evt].slice(-MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* quota — ignore */
  }
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug("[analytics]", name, props ?? {});
  }

  // Persist KPI clicks server-side (fire-and-forget). RLS allows insert when
  // user_id matches the signed-in user; if not signed in we silently skip.
  if (name === "kpi_tile_click" && actor.userId) {
    const p = props ?? {};
    const rawSearch = p.search as unknown;
    const search: Record<string, unknown> =
      typeof rawSearch === "string"
        ? safeParse(rawSearch)
        : rawSearch && typeof rawSearch === "object"
          ? (rawSearch as Record<string, unknown>)
          : {};
    void supabase
      .from("kpi_events")
      .insert({
        user_id: actor.userId,
        team: actor.team,
        kpi_id: String(p.id ?? p.label ?? "unknown"),
        label: p.label != null ? String(p.label) : null,
        path: p.path != null ? String(p.path) : null,
        search: search as never,
        value: typeof p.value === "number" ? p.value : null,
      })
      .then(({ error }) => {
        if (error && import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn("[analytics] kpi_events insert failed", error.message);
        }
      });
  }
}

function safeParse(s: string): Record<string, unknown> {
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
}

export function getEvents(): AnalyticsEvent[] {
  return read();
}

export function clearEvents() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}

export function getEventCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of read()) counts[e.name] = (counts[e.name] ?? 0) + 1;
  return counts;
}
