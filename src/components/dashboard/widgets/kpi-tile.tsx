import { type LucideIcon, ArrowUpRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { CountUp } from "../count-up";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { track } from "@/lib/analytics";

export function KpiTile({
  label,
  value,
  icon: Icon,
  accent = "primary",
  pulse,
  hint,
  to,
  search,
  tooltip,
  eventName,
}: {
  label: string;
  value: number | undefined;
  icon: LucideIcon;
  accent?: "primary" | "success" | "warning" | "destructive" | "info" | "rose";
  pulse?: boolean;
  hint?: string;
  to?: string;
  search?: Record<string, string | undefined>;
  tooltip?: string;
  eventName?: string;
}) {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!pulse) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1400);
    return () => clearTimeout(t);
  }, [pulse, value]);

  const accentMap: Record<string, string> = {
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
    info: "text-info",
    rose: "text-rose-500",
  };
  const ringMap: Record<string, string> = {
    primary: "from-primary/15",
    success: "from-success/15",
    warning: "from-warning/15",
    destructive: "from-destructive/15",
    info: "from-info/15",
    rose: "from-rose-500/15",
  };
  // Tinted chip instead of the old flat `bg-background/60 border`, so the icon
  // carries the tile's accent instead of sitting in a grey box.
  const chipMap: Record<string, string> = {
    primary: "bg-primary/10 border-primary/20",
    success: "bg-success/10 border-success/20",
    warning: "bg-warning/10 border-warning/20",
    destructive: "bg-destructive/10 border-destructive/20",
    info: "bg-info/10 border-info/20",
    rose: "bg-rose-500/10 border-rose-500/20",
  };

  const interactive = !!to;
  const ariaLabel = `${label}: ${value ?? "—"}${tooltip ? ` — ${tooltip}` : ""}`;

  const inner = (
    <>
      <div
        className={cn(
          "absolute inset-x-0 top-0 h-16 bg-gradient-to-b to-transparent pointer-events-none",
          ringMap[accent],
        )}
      />
      <div className="relative flex items-start justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wide font-medium leading-tight text-muted-foreground">
          {label}
        </div>
        <div
          className={cn(
            "shrink-0 rounded-lg p-1.5 border flex items-center gap-1",
            chipMap[accent],
            accentMap[accent],
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {interactive && (
            <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-70 group-focus-visible:opacity-70 transition-opacity" />
          )}
        </div>
      </div>
      <div className="relative mt-3">
        <div className="flex items-end justify-between gap-2">
          <div className="text-3xl font-semibold leading-none tabular-nums">
            <CountUp value={value} />
          </div>
          {pulse && <span className="pulse-dot mb-1" aria-label="live" />}
        </div>
        {/* Always render the hint slot. Only "Total leads" sets a hint, and
            without a placeholder that one tile grew taller than the rest and
            knocked the row's numbers out of alignment. */}
        <div className="mt-1 min-h-4 text-[11px] text-muted-foreground">{hint ?? ""}</div>
      </div>
    </>
  );

  const baseClass = cn(
    "surface-card relative overflow-hidden p-4 lift-in h-full flex flex-col justify-between",
    flash && "row-flash",
  );
  // Lift + accent border live in `.tile-link` (styles.css) rather than a
  // `transition-all` here, which was both undurated and re-animating properties
  // .surface-card already handles.
  const interactiveClass = cn(
    "group tile-link cursor-pointer",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  );

  if (!interactive) {
    return <div className={baseClass}>{inner}</div>;
  }

  const handleActivate = () => {
    track("kpi_tile_click", {
      id: eventName ?? label,
      label,
      value: value ?? null,
      path: to ?? null,
      search: search ? JSON.stringify(search) : null,
    });
  };

  const link = (
    <Link
      to={to}
      search={search as never}
      aria-label={ariaLabel}
      onClick={handleActivate}
      className={cn(baseClass, interactiveClass)}
    >
      {inner}
    </Link>
  );

  if (!tooltip) return link;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs max-w-[220px]">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
