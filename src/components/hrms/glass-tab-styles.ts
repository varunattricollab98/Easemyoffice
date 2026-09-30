// Class names for the frosted-glass segmented control (Bookings Fresh/Renewal
// look), shared by button tabs and link tabs.

import { cn } from "@/lib/utils";

export const GLASS_TRACK =
  "inline-flex max-w-full overflow-x-auto rounded-full border border-black/[0.06] bg-white/60 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_3px_rgba(0,0,0,0.04)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_3px_rgba(0,0,0,0.3)]";

export const glassTabClass = (active: boolean) =>
  cn(
    "group relative inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-1.5 text-sm",
    "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.97]",
    active
      ? "bg-gradient-to-b from-white to-white/85 font-semibold text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.07),0_6px_16px_-6px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.04] dark:from-white/[0.14] dark:to-white/[0.08] dark:ring-white/10"
      : "text-muted-foreground hover:bg-white/70 hover:text-foreground hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:hover:bg-white/[0.07]",
  );
