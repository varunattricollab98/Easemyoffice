import { createFileRoute } from "@tanstack/react-router";
import { guardRoles } from "@/lib/route-guard";
import { Firm360Page } from "@/components/b2b/firm-360";

// The firm 360 is a large component (header, performance strip, five tabs with
// their own dialogs) so its body lives in src/components/b2b/firm-360.tsx and
// this route file stays a thin loader — exporting the heavy component from the
// route file would keep it in the entry chunk instead of being code-split.
export const Route = createFileRoute("/_authenticated/b2b/firms/$id")({
  head: () => ({ meta: [{ title: "CA Firm — EaseMyOffice CRM" }] }),
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "b2b"]);
  },
  component: FirmDetailRoute,
});

function FirmDetailRoute() {
  const { id } = Route.useParams();
  return <Firm360Page id={id} />;
}
