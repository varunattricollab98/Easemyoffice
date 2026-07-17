import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Plus } from "lucide-react";
import { ALL_WIDGETS, DEFAULT_VISIBLE, type WidgetId } from "@/lib/dashboard-prefs";
import { KPI_CATALOG, DEFAULT_KPIS, type KpiId } from "@/lib/dashboard-kpis";

export function AddWidgetPanel({
  visible,
  onChange,
  kpis,
  onKpisChange,
}: {
  visible: WidgetId[];
  onChange: (next: WidgetId[]) => void;
  kpis: KpiId[];
  onKpisChange: (next: KpiId[]) => void;
}) {
  const toggle = (id: WidgetId, on: boolean) => {
    const set = new Set(visible);
    on ? set.add(id) : set.delete(id);
    // Preserve canonical order
    onChange(ALL_WIDGETS.map((w) => w.id).filter((w) => set.has(w)) as WidgetId[]);
  };

  // KPI cards keep the user's chosen order; newly enabled cards are appended.
  const toggleKpi = (id: KpiId, on: boolean) => {
    if (on) {
      if (!kpis.includes(id)) onKpisChange([...kpis, id]);
    } else {
      onKpisChange(kpis.filter((k) => k !== id));
    }
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Add or remove widgets">
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Widgets</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[320px] sm:w-[380px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Customize dashboard</SheetTitle>
          <SheetDescription>Choose your stat cards and widgets. In Edit layout mode you can drag cards to reorder them.</SheetDescription>
        </SheetHeader>

        {/* KPI stat cards */}
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stat cards</h3>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onKpisChange(DEFAULT_KPIS)}>
              Reset
            </Button>
          </div>
          <ul className="mt-2 space-y-1.5" role="list">
            {KPI_CATALOG.map((k) => {
              const on = kpis.includes(k.id);
              return (
                <li key={k.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border">
                  <label htmlFor={`kpi-${k.id}`} className="text-sm font-medium cursor-pointer flex-1 flex items-center gap-2">
                    <k.icon className="h-3.5 w-3.5 text-muted-foreground" /> {k.label}
                  </label>
                  <Switch
                    id={`kpi-${k.id}`}
                    checked={on}
                    onCheckedChange={(v) => toggleKpi(k.id, v)}
                    aria-label={`Toggle ${k.label} card`}
                  />
                </li>
              );
            })}
          </ul>
        </div>

        {/* Widgets */}
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Widgets</h3>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onChange(DEFAULT_VISIBLE)}>
              Reset
            </Button>
          </div>
          <ul className="mt-2 space-y-1.5" role="list">
            {ALL_WIDGETS.map((w) => {
              const on = visible.includes(w.id);
              return (
                <li key={w.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border">
                  <label htmlFor={`w-${w.id}`} className="text-sm font-medium cursor-pointer flex-1">
                    {w.label}
                  </label>
                  <Switch
                    id={`w-${w.id}`}
                    checked={on}
                    onCheckedChange={(v) => toggle(w.id, v)}
                    aria-label={`Toggle ${w.label}`}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}
