import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { STAGES } from "@/lib/crm";
import { CountUp } from "../count-up";
import { Layers } from "lucide-react";
import { pipelineCountsQuery } from "@/lib/dashboard-queries";
import { WidgetSkeleton } from "../widget-skeleton";

export function PipelineSnapshot() {
  const { data, isPending } = useQuery(pipelineCountsQuery());
  const total = Object.values(data ?? {}).reduce((a, b) => a + b, 0) || 1;

  if (isPending && !data) return <WidgetSkeleton rows={3} />;

  return (
    <div className="surface-card p-4 lift-in h-full flex flex-col">
      <div className="flex items-center justify-between mb-3 widget-handle cursor-grab active:cursor-grabbing">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Pipeline snapshot</h3>
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums">{total} leads</span>
      </div>

      {/* Stacked funnel bar */}
      <div className="flex h-2 rounded-full overflow-hidden border bg-muted/40 mb-3">
        {STAGES.map((s) => {
          const v = data?.[s.id] ?? 0;
          const pct = (v / total) * 100;
          if (pct < 0.5) return null;
          return (
            <div
              key={s.id}
              className={s.color}
              style={{ width: `${pct}%`, transition: "width 700ms cubic-bezier(.22,1,.36,1)" }}
              title={`${s.label}: ${v}`}
            />
          );
        })}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 flex-1">
        {STAGES.map((s) => (
          <Link
            key={s.id}
            to="/pipeline"
            className="rounded-xl border bg-card/60 p-2.5 hover:bg-accent/50 hover:-translate-y-0.5 transition-all"
          >
            <div className={`h-1.5 w-8 rounded-full ${s.color} mb-1.5`} />
            <div className="text-[10px] text-muted-foreground line-clamp-1">{s.label}</div>
            <div className="text-lg font-semibold leading-tight">
              <CountUp value={data?.[s.id] ?? 0} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
