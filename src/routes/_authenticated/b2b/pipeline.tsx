import { createFileRoute } from "@tanstack/react-router";
import { guardRoles } from "@/lib/route-guard";
import { PartnershipPipelineBoard } from "@/components/b2b/partnership-pipeline";

// Thin route: the drag-and-drop board (and the dnd-kit it imports) lives in
// src/components/b2b/partnership-pipeline.tsx. Exporting a heavy component from
// a route file keeps it out of code-splitting and bloats the entry chunk, so
// the route only renders the extracted board — mirroring firm-360.tsx.
export const Route = createFileRoute("/_authenticated/b2b/pipeline")({
  head: () => ({ meta: [{ title: "Partnership Pipeline — EaseMyOffice CRM" }] }),
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "b2b"]);
  },
  component: PartnershipPipelineRoute,
});

function PartnershipPipelineRoute() {
  return <PartnershipPipelineBoard />;
}
