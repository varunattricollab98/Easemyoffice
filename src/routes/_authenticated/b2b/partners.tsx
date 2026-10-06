import { createFileRoute } from "@tanstack/react-router";
import { guardRoles } from "@/lib/route-guard";
import { ActivePartnersPage } from "@/components/b2b/partner-performance";

// Thin route: Active Partners reuses the shared performance table (filtered to
// onboarded/active firms) in src/components/b2b/partner-performance.tsx, kept
// out of the route file so it stays code-split.
export const Route = createFileRoute("/_authenticated/b2b/partners")({
  head: () => ({ meta: [{ title: "Active Partners — EaseMyOffice CRM" }] }),
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "b2b"]);
  },
  component: ActivePartnersRoute,
});

function ActivePartnersRoute() {
  return <ActivePartnersPage />;
}
