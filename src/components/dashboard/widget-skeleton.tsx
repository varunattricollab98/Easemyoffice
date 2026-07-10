// Per-widget skeleton placeholder used as Suspense fallback while the lazy
// chunk is downloading, and inline while data is hydrating.
import { Skeleton } from "@/components/ui/skeleton";

export function WidgetSkeleton({ rows = 4, title = true }: { rows?: number; title?: boolean }) {
  return (
    <div className="surface-card p-4 h-full flex flex-col">
      {title && (
        <div className="flex items-center justify-between mb-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-10" />
        </div>
      )}
      <div className="space-y-2 flex-1">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}
