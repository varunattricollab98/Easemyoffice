// Frosted-glass segmented control, same look as the Fresh/Renewal tabs on
// Bookings: selected and hovered states differ in background, shadow depth and
// weight so they are distinguishable at a glance.

import { cn } from "@/lib/utils";

export function GlassTabs<T extends string>({
  value,
  onChange,
  tabs,
  ariaLabel,
}: {
  value: T;
  onChange: (id: T) => void;
  tabs: { id: T; label: string; count?: number; alert?: boolean }[];
  ariaLabel: string;
}) {
  return (
    <div
      className="inline-flex max-w-full overflow-x-auto rounded-full border border-black/[0.06] bg-white/60 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_3px_rgba(0,0,0,0.04)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_3px_rgba(0,0,0,0.3)]"
      role="group"
      aria-label={ariaLabel}
    >
      {tabs.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            aria-pressed={active}
            className={cn(
              "group relative inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-1.5 text-sm",
              "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.97]",
              active
                ? "bg-gradient-to-b from-white to-white/85 font-semibold text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.07),0_6px_16px_-6px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.04] dark:from-white/[0.14] dark:to-white/[0.08] dark:ring-white/10"
                : "text-muted-foreground hover:bg-white/70 hover:text-foreground hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:hover:bg-white/[0.07]",
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px] tabular-nums transition-all duration-300",
                  t.alert && t.count > 0
                    ? "bg-rose-500/15 text-rose-600 ring-1 ring-rose-500/20 dark:text-rose-300"
                    : active
                      ? "bg-primary/12 text-primary ring-1 ring-primary/15"
                      : "bg-black/[0.05] text-muted-foreground group-hover:bg-black/[0.07] dark:bg-white/10 dark:group-hover:bg-white/[0.14]",
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
