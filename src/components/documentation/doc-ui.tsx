import type { ReactNode } from "react";
import { AlarmClock, CheckCircle2, Clock, Timer } from "lucide-react";
import {
  stageDef,
  tatLabel,
  tatState,
  WAITING_ON_LABEL,
  type DocStage,
  type DocTaskCore,
  type TatState,
  type WaitingOn,
} from "@/lib/documentation";
import { cn } from "@/lib/utils";

export function StageDot({ stage, className }: { stage: DocStage; className?: string }) {
  return (
    <span
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", stageDef(stage).color, className)}
    />
  );
}

export function StageBadge({ stage }: { stage: DocStage }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-background/60 px-2 py-0.5 text-xs font-medium">
      <StageDot stage={stage} />
      {stageDef(stage).label}
    </span>
  );
}

const TAT_STYLE: Record<TatState, string> = {
  on_track: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20",
  due_soon: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/25",
  overdue: "bg-red-500/10 text-red-700 dark:text-red-300 ring-red-500/25",
  met: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20",
  missed: "bg-red-500/10 text-red-700 dark:text-red-300 ring-red-500/20",
};

const TAT_ICON: Record<TatState, typeof Clock> = {
  on_track: Clock,
  due_soon: Timer,
  overdue: AlarmClock,
  met: CheckCircle2,
  missed: AlarmClock,
};

export function TatChip({
  task,
  now,
  className,
}: {
  task: DocTaskCore;
  now: number;
  className?: string;
}) {
  const state = tatState(task, now);
  const Icon = TAT_ICON[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ring-1",
        TAT_STYLE[state],
        className,
      )}
      title={`TAT due ${new Date(task.due_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`}
    >
      <Icon className={cn("h-3 w-3", state === "overdue" && "animate-pulse")} />
      {tatLabel(task, now)}
    </span>
  );
}

const WAITING_STYLE: Record<WaitingOn, string> = {
  team: "text-sky-700 dark:text-sky-300 bg-sky-500/10",
  client: "text-violet-700 dark:text-violet-300 bg-violet-500/10",
  sp: "text-orange-700 dark:text-orange-300 bg-orange-500/10",
  done: "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10",
};

export function WaitingOnChip({
  waitingOn,
  className,
}: {
  waitingOn: WaitingOn;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        WAITING_STYLE[waitingOn],
        className,
      )}
    >
      {waitingOn === "done" ? "Done" : `Waiting: ${WAITING_ON_LABEL[waitingOn]}`}
    </span>
  );
}

export function Initials({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  const parts = (name ?? "?").trim().split(/\s+/);
  const text = (
    (parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")
  ).toUpperCase();
  return (
    <span
      title={name ?? undefined}
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary",
        className,
      )}
    >
      {text}
    </span>
  );
}

/** Frosted-glass segmented control, same look as the Bookings Fresh/Renewal tabs. */
export function GlassSegmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: ReactNode; count?: number }[];
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex max-w-full overflow-x-auto rounded-full border border-black/[0.06] bg-white/60 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_3px_rgba(0,0,0,0.04)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_3px_rgba(0,0,0,0.3)]"
    >
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-1.5 text-sm",
              "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.97]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              active
                ? "bg-gradient-to-b from-white to-white/85 font-semibold text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.07),0_6px_16px_-6px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.04] dark:from-white/[0.14] dark:to-white/[0.08] dark:ring-white/10"
                : "text-muted-foreground hover:bg-white/70 hover:text-foreground dark:hover:bg-white/[0.07]",
            )}
          >
            {o.label}
            {o.count != null && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px] tabular-nums",
                  active ? "bg-primary/10 text-primary" : "bg-black/[0.04] dark:bg-white/[0.06]",
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function KpiTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: typeof Clock;
  tone?: "default" | "good" | "warn" | "bad";
  onClick?: () => void;
}) {
  const toneCls = {
    default: "text-foreground",
    good: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    bad: "text-red-600 dark:text-red-400",
  }[tone];
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn("surface-card p-4 text-left", onClick && "tile-link cursor-pointer")}
    >
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className={cn("mt-2 text-2xl font-bold tabular-nums", toneCls)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </Comp>
  );
}
