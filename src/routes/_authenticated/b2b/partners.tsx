import { createFileRoute } from "@tanstack/react-router";
import { guardRoles } from "@/lib/route-guard";
import { ActivePartnersPage } from "@/components/b2b/partner-performance";

// Optional ?status= to pre-apply a partner-health filter — used by the admin
// command-center "Active CA Partners" drill-down (?status=active). Optional with
// a sane default so direct navigation to /b2b/partners is unchanged.
type PartnersSearch = { status?: string };

export const Route = createFileRoute("/_authenticated/b2b/partners")({
  head: () => ({ meta: [{ title: "Active Partners — EaseMyOffice CRM" }] }),
  validateSearch: (s: Record<string, unknown>): PartnersSearch => ({
    status: typeof s.status === "string" ? s.status : undefined,
  }),
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "b2b"]);
  },
  component: ActivePartnersRoute,
});

// Thin route: Active Partners reuses the shared performance table (filtered to
// onboarded/active firms) in src/components/b2b/partner-performance.tsx, kept
// out of the route file so it stays code-split.
function ActivePartnersRoute() {
  const { status } = Route.useSearch();
  // "active" is the health id this page is about; pass it straight through so the
  // health dropdown lands pre-selected. Any other health id is honoured too.
  return <ActivePartnersPage initialHealth={status} />;
}
