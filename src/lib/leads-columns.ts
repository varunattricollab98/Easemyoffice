import { useCallback, useEffect, useState } from "react";

// Per-user, drag-resizable column widths for the Leads list.
// Widths are stored in pixels, keyed by user id in localStorage, so each
// salesperson keeps their own layout (and it survives reloads).

export type LeadColKey =
  | "name"
  | "contact"
  | "service"
  | "stage"
  | "agent"
  | "followup";

export interface LeadColumn {
  key: LeadColKey;
  label: string;
  /** Default width in px. */
  width: number;
  /** Minimum width the user can drag to. */
  min: number;
}

// Order + defaults. The row grid and header both build their
// grid-template-columns from this, so they always stay aligned.
export const LEAD_COLUMNS: LeadColumn[] = [
  { key: "name", label: "Lead", width: 300, min: 160 },
  { key: "contact", label: "Contact", width: 220, min: 120 },
  { key: "service", label: "Service", width: 130, min: 80 },
  { key: "stage", label: "Stage", width: 150, min: 90 },
  { key: "agent", label: "Owner", width: 120, min: 70 },
  { key: "followup", label: "Follow-up", width: 130, min: 90 },
];

export type LeadColWidths = Record<LeadColKey, number>;

export const DEFAULT_WIDTHS: LeadColWidths = LEAD_COLUMNS.reduce((acc, c) => {
  acc[c.key] = c.width;
  return acc;
}, {} as LeadColWidths);

const KEY = (uid: string) => `leads:colwidths:v1:${uid}`;

function load(uid: string): LeadColWidths {
  if (typeof window === "undefined") return { ...DEFAULT_WIDTHS };
  try {
    const raw = localStorage.getItem(KEY(uid));
    if (!raw) return { ...DEFAULT_WIDTHS };
    const parsed = JSON.parse(raw) as Partial<LeadColWidths>;
    // Merge over defaults so a newly-added column still gets a width, and clamp
    // each to its column min.
    const out = { ...DEFAULT_WIDTHS };
    for (const c of LEAD_COLUMNS) {
      const v = Number(parsed[c.key]);
      if (Number.isFinite(v) && v >= c.min) out[c.key] = v;
    }
    return out;
  } catch {
    return { ...DEFAULT_WIDTHS };
  }
}

function save(uid: string, widths: LeadColWidths) {
  try {
    localStorage.setItem(KEY(uid), JSON.stringify(widths));
  } catch {
    /* ignore quota / disabled storage */
  }
}

/**
 * Hook returning the current per-user column widths plus setters:
 *  - setWidth(key, px): live-update one column (clamped to its min)
 *  - reset(): restore defaults
 * Persists to localStorage on every change.
 */
export function useLeadColWidths(uid: string) {
  const [widths, setWidths] = useState<LeadColWidths>(() => load(uid));

  // Re-load when the user changes (e.g. login/logout in the same tab).
  useEffect(() => {
    setWidths(load(uid));
  }, [uid]);

  const setWidth = useCallback(
    (key: LeadColKey, px: number) => {
      const col = LEAD_COLUMNS.find((c) => c.key === key);
      const min = col?.min ?? 60;
      setWidths((prev) => {
        const next = { ...prev, [key]: Math.max(min, Math.round(px)) };
        save(uid, next);
        return next;
      });
    },
    [uid],
  );

  const reset = useCallback(() => {
    const next = { ...DEFAULT_WIDTHS };
    setWidths(next);
    save(uid, next);
  }, [uid]);

  // Build a CSS grid-template-columns string, with a fixed leading column for
  // the checkbox. Order follows LEAD_COLUMNS.
  const template = `40px ${LEAD_COLUMNS.map((c) => `${widths[c.key]}px`).join(" ")}`;

  return { widths, setWidth, reset, template };
}
