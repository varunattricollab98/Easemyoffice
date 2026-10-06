import { createFileRoute } from "@tanstack/react-router";
import { guardRoles } from "@/lib/route-guard";
import { ReferralsPage } from "@/components/b2b/referrals";

// Thin route: the referrals table and its create / push-to-sales / link-booking
// dialogs live in src/components/b2b/referrals.tsx so the heavy component stays
// code-split (not exported from the route file), mirroring pipeline.tsx.
export const Route = createFileRoute("/_authenticated/b2b/referrals")({
  head: () => ({ meta: [{ title: "Referrals — EaseMyOffice CRM" }] }),
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "b2b"]);
  },
  component: ReferralsRoute,
});

function ReferralsRoute() {
  return <ReferralsPage />;
}
