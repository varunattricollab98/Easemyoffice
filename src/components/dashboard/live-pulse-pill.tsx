import { usePulse } from "@/lib/realtime-pulse";
import { Radio } from "lucide-react";
import { cn } from "@/lib/utils";

export function LivePulsePill() {
  const { count, lastAt } = usePulse();
  const live = count > 0 && lastAt && Date.now() - lastAt < 15_000;
  return (
    <div className={cn(
      "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs surface-glass",
      live && "border-primary/40",
    )}>
      <span className={cn("relative flex h-2 w-2")}>
        <span className={cn(
          "absolute inline-flex h-full w-full rounded-full opacity-75",
          live ? "bg-success animate-ping" : "bg-muted-foreground/40",
        )} />
        <span className={cn(
          "relative inline-flex h-2 w-2 rounded-full",
          live ? "bg-success" : "bg-muted-foreground/60",
        )} />
      </span>
      <Radio className="h-3 w-3 opacity-70" />
      <span className="tabular-nums">
        {count} {count === 1 ? "update" : "updates"} · last 5 min
      </span>
    </div>
  );
}
