import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { INTERESTS, SERVICES, labelFor } from "@/lib/crm";
import { formatDistanceToNow } from "date-fns";
import { useEffect, useRef, useState } from "react";
import { needsAttentionQuery } from "@/lib/dashboard-queries";
import { WidgetSkeleton } from "../widget-skeleton";

export function NeedsAttention({ pulseTick = 0 }: { pulseTick?: number }) {
  const { data, isPending } = useQuery(needsAttentionQuery());

  // Track last-seen ids to flash newly-changed rows
  const seen = useRef<Map<string, string>>(new Map());
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!data) return;
    const flash = new Set<string>();
    data.forEach((r) => {
      const prev = seen.current.get(r.id);
      if (prev && prev !== r.updated_at) flash.add(r.id);
      seen.current.set(r.id, r.updated_at);
    });
    if (flash.size) {
      setFlashIds(flash);
      const t = setTimeout(() => setFlashIds(new Set()), 1500);
      return () => clearTimeout(t);
    }
  }, [data, pulseTick]);

  if (isPending && !data) return <WidgetSkeleton rows={5} />;

  return (
    <div className="surface-card p-4 lift-in h-full flex flex-col">
      <div className="flex items-center justify-between mb-3 widget-handle cursor-grab active:cursor-grabbing">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <h3 className="text-sm font-semibold">Needs attention</h3>
          <span className="pulse-dot" aria-label="live" />
        </div>
        <Link to="/follow-ups" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="space-y-1.5 overflow-y-auto flex-1">
        {data?.length === 0 && (
          <div className="text-sm text-muted-foreground py-8 text-center">
            ✨ Inbox zero. Nice work.
          </div>
        )}
        {data?.map((l) => {
          const interest = INTERESTS.find((i) => i.id === l.interest);
          const overdue = l.next_follow_up_at && new Date(l.next_follow_up_at) < new Date();
          return (
            <Link
              key={l.id}
              to="/leads/$id"
              params={{ id: l.id }}
              className={`flex items-center gap-3 p-2.5 rounded-lg border border-transparent hover:bg-accent/50 hover:border-border transition-colors ${flashIds.has(l.id) ? "row-flash" : ""}`}
            >
              <div className={`size-2 rounded-full ${overdue ? "bg-destructive" : "bg-amber-500"}`} />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate text-sm">{l.client_name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {l.company_name ? `${l.company_name} · ` : ""}{labelFor(SERVICES, l.service_required)}
                </div>
              </div>
              {interest && (
                <Badge variant="secondary" className={interest.className}>
                  {interest.emoji} {interest.label}
                </Badge>
              )}
              <div className="text-[11px] text-muted-foreground hidden md:block tabular-nums w-28 text-right">
                {l.next_follow_up_at
                  ? `${overdue ? "Overdue " : "Due "}${formatDistanceToNow(new Date(l.next_follow_up_at), { addSuffix: true })}`
                  : "No follow-up"}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
