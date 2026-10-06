import { createFileRoute } from "@tanstack/react-router";
import { guardRoles } from "@/lib/route-guard";
import { B2BRenewalsPage } from "@/components/b2b/renewals";

// Thin route: the partner-relationship-health board (buckets + per-partner
// roll-up + inline follow-up) lives in src/components/b2b/renewals.tsx so it
// stays code-split, matching the other B2B routes.
export const Route = createFileRoute("/_authenticated/b2b/renewals")({
  head: () => ({ meta: [{ title: "B2B Renewals — EaseMyOffice CRM" }] }),
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "b2b"]);
  },
  component: B2BRenewalsRoute,
});

function B2BRenewalsRoute() {
  return <B2BRenewalsPage />;
}
