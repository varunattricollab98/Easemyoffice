import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { activityTickerQuery } from "@/lib/dashboard-queries";
import { WidgetSkeleton } from "../widget-skeleton";

type Row = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  created_at: string;
  lead_id: string;
  leads: { client_name: string } | null;
};

export function ActivityTicker() {
  const { data, isPending } = useQuery({ ...activityTickerQuery(), select: (rows) => rows as unknown as Row[] });

  if (isPending && !data) return <WidgetSkeleton rows={6} />;

  return (
    <div className="surface-card p-4 lift-in h-full flex flex-col">
      <div className="flex items-center justify-between mb-3 widget-handle cursor-grab active:cursor-grabbing">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-info" />
          <h3 className="text-sm font-semibold">Live activity</h3>
          <span className="pulse-dot" aria-label="live" />
        </div>
      </div>
      <div className="space-y-1 overflow-y-auto flex-1">
        {(!data || data.length === 0) && (
          <div className="text-sm text-muted-foreground py-8 text-center">No activity yet.</div>
        )}
        {data?.map((a) => (
          <Link
            key={a.id}
            to="/leads/$id"
            params={{ id: a.lead_id }}
            className="block px-2 py-1.5 rounded-md hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-xs">
                <span className="font-medium">{a.leads?.client_name ?? "Lead"}</span>
                <span className="text-muted-foreground"> · {a.title}</span>
              </div>
              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
              </span>
            </div>
            {a.body && <div className="text-[11px] text-muted-foreground truncate">{a.body}</div>}
          </Link>
        ))}
      </div>
    </div>
  );
}
