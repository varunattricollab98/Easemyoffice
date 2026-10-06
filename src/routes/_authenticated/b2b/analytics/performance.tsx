import { createFileRoute } from "@tanstack/react-router";
import { guardRoles } from "@/lib/route-guard";
import { B2BPerformanceAnalytics } from "@/components/b2b/analytics/performance";

// Thin route — the recharts-heavy body lives in src/components/b2b/analytics so
// it is code-split out of the entry chunk. admin + b2b; RLS scopes the rows.
export const Route = createFileRoute("/_authenticated/b2b/analytics/performance")({
  head: () => ({ meta: [{ title: "B2B Performance — EaseMyOffice CRM" }] }),
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "b2b"]);
  },
  component: B2BPerformanceAnalytics,
});
