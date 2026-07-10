import { useEffect, useState, useSyncExternalStore } from "react";
import { Activity, ChevronDown, ChevronUp } from "lucide-react";
import {
  bootstrapAppLoadTiming,
  getPerfSnapshot,
  subscribePerf,
} from "@/lib/perf";

const STORAGE_KEY = "emo-crm:perf-panel-open";

function useSnap() {
  return useSyncExternalStore(
    (cb) => subscribePerf(cb),
    () => getPerfSnapshot(),
    () => getPerfSnapshot(),
  );
}

export function PerfPanel() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    bootstrapAppLoadTiming();
    try {
      setOpen(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const snap = useSnap();
  const pages = Object.values(snap.pages).sort((a, b) => b.updatedAt - a.updatedAt);

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <div className="fixed bottom-3 right-3 z-50 select-none">
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 rounded-full bg-foreground/90 text-background shadow-lg px-3 py-1.5 text-xs font-medium hover:bg-foreground"
        aria-label="Performance panel"
      >
        <Activity className="h-3.5 w-3.5" />
        {snap.appLoadMs ? `${snap.appLoadMs}ms` : "perf"}
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
      </button>
      {open && (
        <div className="mt-2 w-72 rounded-lg border bg-popover text-popover-foreground shadow-xl p-3 text-xs space-y-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground">App load</span>
            <span className="font-mono">{snap.appLoadMs ?? "—"} ms</span>
          </div>
          <div className="border-t pt-2 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Pages
            </div>
            {pages.length === 0 && (
              <div className="text-muted-foreground italic">No pages tracked yet.</div>
            )}
            {pages.map((p) => (
              <div key={p.page} className="space-y-0.5">
                <div className="font-medium">{p.page}</div>
                <div className="grid grid-cols-3 gap-1 font-mono text-[11px] text-muted-foreground">
                  <span title="First data load">first {p.firstDataMs ?? "—"}ms</span>
                  <span title="Last query">qry {p.lastQueryMs ?? "—"}ms</span>
                  <span title="Last render">rnd {p.lastRenderMs ?? "—"}ms</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
