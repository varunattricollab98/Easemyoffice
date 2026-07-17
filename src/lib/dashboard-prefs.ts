import { useEffect, useState } from "react";
import type { LayoutItem } from "react-grid-layout/legacy";
import { DEFAULT_KPIS, type KpiId } from "@/lib/dashboard-kpis";

const LAYOUT_KEY = (uid: string) => `dashboard:layout:v2:${uid}`;
const VISIBLE_KEY = (uid: string) => `dashboard:visible:v1:${uid}`;
const KPI_KEY = (uid: string) => `dashboard:kpis:v1:${uid}`;
const QUIET_KEY = "dashboard:quiet:v1";

export const ALL_WIDGETS = [
  { id: "hero",     label: "Hero — goal progress" },
  { id: "needs",    label: "Needs attention" },
  { id: "today",    label: "Today's follow-ups" },
  { id: "overdue",  label: "Overdue follow-ups (bulk)" },
  { id: "pipeline", label: "Pipeline snapshot" },
  { id: "activity", label: "Live activity ticker" },
] as const;

export type WidgetId = typeof ALL_WIDGETS[number]["id"];

export const DEFAULT_VISIBLE: WidgetId[] = ["hero", "needs", "today", "overdue", "pipeline", "activity"];

export function loadLayouts(uid: string): Record<string, LayoutItem[]> | null {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY(uid));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
export function saveLayouts(uid: string, layouts: Record<string, LayoutItem[]>) {
  try { localStorage.setItem(LAYOUT_KEY(uid), JSON.stringify(layouts)); } catch { /* ignore */ }
}
export function clearLayouts(uid: string) {
  try {
    localStorage.removeItem(LAYOUT_KEY(uid));
    localStorage.removeItem(VISIBLE_KEY(uid));
    localStorage.removeItem(KPI_KEY(uid));
  } catch { /* ignore */ }
}

// Ordered list of KPI stat-cards the user wants across the top of the dashboard.
// Persisted per-user; drag-to-reorder + toggle in the Widgets panel drive this.
export function useVisibleKpis(uid: string) {
  const [kpis, setKpis] = useState<KpiId[]>(() => {
    try {
      const raw = localStorage.getItem(KPI_KEY(uid));
      if (raw) return JSON.parse(raw) as KpiId[];
    } catch { /* ignore */ }
    return DEFAULT_KPIS;
  });
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KPI_KEY(uid));
      if (raw) setKpis(JSON.parse(raw) as KpiId[]);
      else setKpis(DEFAULT_KPIS);
    } catch { /* ignore */ }
  }, [uid]);
  const update = (next: KpiId[]) => {
    setKpis(next);
    try { localStorage.setItem(KPI_KEY(uid), JSON.stringify(next)); } catch { /* ignore */ }
  };
  return [kpis, update] as const;
}

export function useVisibleWidgets(uid: string) {
  const [visible, setVisible] = useState<WidgetId[]>(() => {
    try {
      const raw = localStorage.getItem(VISIBLE_KEY(uid));
      if (raw) return JSON.parse(raw) as WidgetId[];
    } catch { /* ignore */ }
    return DEFAULT_VISIBLE;
  });
  useEffect(() => {
    try {
      const raw = localStorage.getItem(VISIBLE_KEY(uid));
      if (raw) setVisible(JSON.parse(raw) as WidgetId[]);
    } catch { /* ignore */ }
  }, [uid]);
  const update = (next: WidgetId[]) => {
    setVisible(next);
    try { localStorage.setItem(VISIBLE_KEY(uid), JSON.stringify(next)); } catch { /* ignore */ }
  };
  return [visible, update] as const;
}

export function useQuietMode() {
  const [quiet, setQuiet] = useState<boolean>(() => {
    try {
      if (localStorage.getItem(QUIET_KEY) === "1") return true;
      // Default to quiet when user prefers reduced motion
      if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return true;
    } catch { /* ignore */ }
    return false;
  });
  useEffect(() => {
    try { localStorage.setItem(QUIET_KEY, quiet ? "1" : "0"); } catch { /* ignore */ }
    document.documentElement.classList.toggle("quiet", quiet);
    return () => { document.documentElement.classList.remove("quiet"); };
  }, [quiet]);
  return [quiet, setQuiet] as const;
}
