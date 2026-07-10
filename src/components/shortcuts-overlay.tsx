import { useEffect, useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SHORTCUTS, getBinding, prettyBinding, readDisabledAll } from "@/lib/shortcuts";
import { Link } from "@tanstack/react-router";
import { Settings as SettingsIcon, Keyboard } from "lucide-react";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);

export function ShortcutsOverlay() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [, force] = useState(0);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onChange = () => force((n) => n + 1);
    window.addEventListener("shortcuts:open", onOpen);
    window.addEventListener("shortcuts:changed", onChange);
    return () => {
      window.removeEventListener("shortcuts:open", onOpen);
      window.removeEventListener("shortcuts:changed", onChange);
    };
  }, []);

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = SHORTCUTS.filter((s) => {
      const b = getBinding(s.id);
      const hay = `${s.label} ${s.group} ${b ?? "disabled"}`.toLowerCase();
      return !term || hay.includes(term);
    });
    return filtered.reduce<Record<string, typeof SHORTCUTS>>((acc, s) => {
      (acc[s.group] ||= []).push(s); return acc;
    }, {});
  }, [q]);

  const disabledAll = readDisabledAll();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Keyboard className="h-5 w-5" /> Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            {disabledAll ? "Shortcuts are disabled on this device." : "Press “?” anywhere to open this. Search by name or key."}
          </DialogDescription>
        </DialogHeader>

        <Input autoFocus placeholder="Search shortcuts…" value={q} onChange={(e) => setQ(e.target.value)} />

        <div className="max-h-[60vh] overflow-y-auto space-y-4 pr-1">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">{group}</div>
              <div className="space-y-1">
                {items.map((s) => {
                  const b = getBinding(s.id);
                  return (
                    <div key={s.id} className="flex items-center justify-between border rounded-md px-3 py-1.5 text-sm">
                      <span>{s.label}</span>
                      <kbd className={`px-2 py-0.5 rounded font-mono text-xs ${b ? "bg-muted" : "bg-muted/40 text-muted-foreground line-through"}`}>
                        {prettyBinding(b, isMac)}
                      </kbd>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {Object.keys(groups).length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-8">No matches.</div>
          )}
        </div>

        <div className="pt-2 border-t flex justify-end">
          <Link to="/settings" onClick={() => setOpen(false)} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
            <SettingsIcon className="h-4 w-4" /> Customize in Settings
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
