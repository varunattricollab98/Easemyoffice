import { createFileRoute } from "@tanstack/react-router";
import { guardRoles } from "@/lib/route-guard";
import { B2BSourceAnalytics } from "@/components/b2b/analytics/source";

// Thin route — the recharts-heavy body lives in src/components/b2b/analytics so
// it is code-split out of the entry chunk. Source Analytics reads the
// configurable b2b_sources table. admin + b2b; RLS scopes the rows.
export const Route = createFileRoute("/_authenticated/b2b/analytics/source")({
  head: () => ({ meta: [{ title: "Source Analytics — EaseMyOffice CRM" }] }),
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "b2b"]);
  },
  component: B2BSourceAnalytics,
});
