import { Link, useRouter } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

// App-wide error UI. Wired as the root route's `errorComponent`, so any
// uncaught error thrown during rendering or a route loader shows this friendly
// screen (with a Retry that re-invalidates the router) instead of a blank page.
export function DefaultCatchBoundary({ error }: ErrorComponentProps) {
  const router = useRouter();

  // Surface the details in the console for debugging without exposing a stack
  // trace to end users.
  if (typeof console !== "undefined") {
    console.error("[DefaultCatchBoundary]", error);
  }

  const message =
    error instanceof Error && error.message
      ? error.message
      : "An unexpected error occurred.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-4xl font-bold text-foreground">Something went wrong</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          We hit an unexpected error. You can retry, or head back to the
          dashboard.
        </p>
        <pre className="mt-4 max-h-40 overflow-auto rounded-md bg-muted/50 p-3 text-left text-xs text-muted-foreground">
          {message}
        </pre>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => router.invalidate()}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Retry
          </button>
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
