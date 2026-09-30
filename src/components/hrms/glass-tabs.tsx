// Frosted-glass segmented control, same look as the Fresh/Renewal tabs on
// Bookings: selected and hovered states differ in background, shadow depth and
// weight so they are distinguishable at a glance.

import { cn } from "@/lib/utils";
import { GLASS_TRACK, glassTabClass } from "@/components/hrms/glass-tab-styles";

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
    <div className={GLASS_TRACK} role="group" aria-label={ariaLabel}>
      {tabs.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            aria-pressed={active}
            className={glassTabClass(active)}
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
