// Presentation for a lead's activity history: a vertical timeline with one
// icon tile per activity type (reference: "Activity Timeline"). Takes the
// existing lead_activities rows as-is — no data shaping beyond display.

import type { ReactNode } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowRightLeft,
  Bell,
  CircleDot,
  Mail,
  MessageCircle,
  Phone,
  StickyNote,
  Sparkles,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TYPE_META: Record<string, { icon: LucideIcon; tile: string; label: string }> = {
  call: { icon: Phone, tile: "bg-success/10 text-success", label: "Call" },
  whatsapp: { icon: MessageCircle, tile: "bg-success/10 text-success", label: "WhatsApp" },
  email: { icon: Mail, tile: "bg-accent text-primary", label: "Email" },
  note: { icon: StickyNote, tile: "bg-muted text-muted-foreground", label: "Note" },
  stage_change: { icon: ArrowRightLeft, tile: "bg-accent text-accent-foreground", label: "Stage" },
  assignment: { icon: UserCheck, tile: "bg-info/10 text-info", label: "Assignment" },
  followup: { icon: Bell, tile: "bg-warning/12 text-warning", label: "Follow-up" },
  created: { icon: Sparkles, tile: "bg-accent text-primary", label: "Created" },
};
const FALLBACK = { icon: CircleDot, tile: "bg-muted text-muted-foreground", label: "Activity" };

export interface TimelineEntry {
  id: string;
  type: string;
  title: ReactNode;
  created_at: string;
  /** Extra lines under the title (outcome, body, …). */
  children?: ReactNode;
}

export function ActivityTimeline({
  entries,
  empty,
}: {
  entries: TimelineEntry[];
  empty: ReactNode;
}) {
  if (entries.length === 0) return <div className="text-sm text-muted-foreground">{empty}</div>;
  return (
    <ol className="relative">
      {entries.map((e, i) => {
        const meta = TYPE_META[e.type] ?? FALLBACK;
        const Icon = meta.icon;
        const at = new Date(e.created_at);
        const last = i === entries.length - 1;
        return (
          <li key={e.id} className="relative grid grid-cols-[64px_36px_1fr] gap-3 pb-4 last:pb-0">
            <div className="pt-1.5 text-right leading-tight">
              <div className="text-[12px] font-medium tabular-nums text-foreground">
                {format(at, "h:mm a")}
              </div>
              <div className="text-[11px] text-muted-foreground">{format(at, "d MMM")}</div>
            </div>
            <div className="relative flex justify-center">
              {!last && (
                <span className="absolute bottom-[-16px] top-10 w-px bg-border" aria-hidden />
              )}
              <span
                className={cn(
                  "relative z-[1] grid size-9 place-items-center rounded-xl shadow-[var(--shadow-xs)] ring-1 ring-border/70",
                  meta.tile,
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
            </div>
            <div className="min-w-0 rounded-xl border border-border/80 bg-card px-3.5 py-2.5 shadow-[var(--shadow-xs)] transition-shadow duration-150 hover:shadow-[var(--shadow-soft)]">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium leading-snug">{e.title}</div>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {meta.label}
                </span>
              </div>
              {e.children}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A lead_activities row, as the lead detail page already loads it. */
export interface LeadActivityRow {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  created_at: string;
  payload?: { outcome?: string; durationMin?: number | null } | null;
}

/** The lead detail Timeline tab: same rows, fields and order as before. */
export function LeadActivityTimeline({ activities }: { activities: LeadActivityRow[] }) {
  return (
    <ActivityTimeline
      empty="No activity yet."
      entries={activities.map((a) => {
        const outcome =
          (a.type === "call" || a.type === "whatsapp") && a.payload?.outcome ? a.payload : null;
        return {
          id: a.id,
          type: a.type,
          title: a.title,
          created_at: a.created_at,
          children: (
            <>
              {outcome && (
                <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                  {a.type === "call" ? (
                    <Phone className="h-3.5 w-3.5" />
                  ) : (
                    <MessageCircle className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {outcome.outcome}
                    {a.type === "call" &&
                      outcome.durationMin != null &&
                      ` · ${outcome.durationMin} min`}
                  </span>
                </div>
              )}
              {a.body && (
                <div className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                  {a.body}
                </div>
              )}
              <div className="mt-1 text-[11px] text-muted-foreground">
                {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
              </div>
            </>
          ),
        };
      })}
    />
  );
}
