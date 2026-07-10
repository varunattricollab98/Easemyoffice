// Lightweight in-app performance tracking.
// Pages call usePagePerf(label, isLoading) to record query/render time.
// PerfPanel subscribes to the store and renders the metrics.

import { useEffect, useRef } from "react";

export type PerfMetric = {
  page: string;
  firstDataMs: number | null; // mount → first data
  lastQueryMs: number | null; // duration of most recent refetch
  lastRenderMs: number | null; // duration of last render commit
  updatedAt: number;
};

type Store = {
  appLoadMs: number | null;
  pages: Record<string, PerfMetric>;
};

const listeners = new Set<() => void>();
const store: Store = { appLoadMs: null, pages: {} };

function emit() {
  listeners.forEach((l) => l());
}

export function subscribePerf(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getPerfSnapshot(): Store {
  return store;
}

export function setAppLoad(ms: number) {
  store.appLoadMs = ms;
  emit();
}

export function recordPagePerf(page: string, patch: Partial<PerfMetric>) {
  const cur = store.pages[page] ?? {
    page,
    firstDataMs: null,
    lastQueryMs: null,
    lastRenderMs: null,
    updatedAt: 0,
  };
  store.pages[page] = { ...cur, ...patch, updatedAt: Date.now() };
  emit();
}

// Capture initial app load timing once, after first paint.
export function bootstrapAppLoadTiming() {
  if (typeof window === "undefined") return;
  if (store.appLoadMs !== null) return;
  const finalize = () => {
    try {
      const nav = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      if (nav) {
        // Time from navigation start to DOMContentLoaded
        setAppLoad(Math.round(nav.domContentLoadedEventEnd));
      } else {
        setAppLoad(Math.round(performance.now()));
      }
    } catch {
      setAppLoad(Math.round(performance.now()));
    }
  };
  if (document.readyState === "complete") finalize();
  else window.addEventListener("load", finalize, { once: true });
}

/**
 * Hook each major page calls to record:
 *  - firstDataMs : time from mount until isLoading becomes false the first time
 *  - lastQueryMs : duration of subsequent refetches (isLoading true→false)
 *  - lastRenderMs: render commit duration (rough)
 */
export function usePagePerf(page: string, isLoading: boolean) {
  const mountedAt = useRef(performance.now());
  const queryStart = useRef<number | null>(performance.now());
  const firstCaptured = useRef(false);
  const renderStart = useRef(performance.now());

  // Track loading transitions
  useEffect(() => {
    if (isLoading) {
      queryStart.current = performance.now();
    } else if (queryStart.current !== null) {
      const dur = Math.round(performance.now() - queryStart.current);
      if (!firstCaptured.current) {
        firstCaptured.current = true;
        recordPagePerf(page, {
          firstDataMs: Math.round(performance.now() - mountedAt.current),
          lastQueryMs: dur,
        });
      } else {
        recordPagePerf(page, { lastQueryMs: dur });
      }
      queryStart.current = null;
    }
  }, [isLoading, page]);

  // Track render commit time
  renderStart.current = performance.now();
  useEffect(() => {
    const dur = Math.round(performance.now() - renderStart.current);
    recordPagePerf(page, { lastRenderMs: dur });
  });
}
