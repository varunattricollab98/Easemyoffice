import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Plus } from "lucide-react";
import { ALL_WIDGETS, DEFAULT_VISIBLE, type WidgetId } from "@/lib/dashboard-prefs";

export function AddWidgetPanel({
  visible,
  onChange,
}: {
  visible: WidgetId[];
  onChange: (next: WidgetId[]) => void;
}) {
  const toggle = (id: WidgetId, on: boolean) => {
    const set = new Set(visible);
    on ? set.add(id) : set.delete(id);
    // Preserve canonical order
    onChange(ALL_WIDGETS.map((w) => w.id).filter((w) => set.has(w)) as WidgetId[]);
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Add or remove widgets">
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Widgets</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[320px] sm:w-[380px]">
        <SheetHeader>
          <SheetTitle>Dashboard widgets</SheetTitle>
          <SheetDescription>Choose what appears on your dashboard. Drag to rearrange in Edit mode.</SheetDescription>
        </SheetHeader>
        <ul className="mt-4 space-y-2" role="list">
          {ALL_WIDGETS.map((w) => {
            const on = visible.includes(w.id);
            return (
              <li key={w.id} className="flex items-center justify-between gap-2 p-3 rounded-lg border">
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
        <div className="mt-4">
          <Button variant="ghost" size="sm" onClick={() => onChange(DEFAULT_VISIBLE)}>
            Reset to defaults
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
