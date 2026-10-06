import { createFileRoute } from "@tanstack/react-router";
import { guardRoles } from "@/lib/route-guard";
import { PartnerPerformancePage } from "@/components/b2b/partner-performance";

// Thin route: the sortable/filterable per-firm performance table (with live
// partner score + health from src/lib/b2b-scoring.ts) lives in
// src/components/b2b/partner-performance.tsx so it stays code-split.
export const Route = createFileRoute("/_authenticated/b2b/partner-performance")({
  head: () => ({ meta: [{ title: "Partner Performance — EaseMyOffice CRM" }] }),
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "b2b"]);
  },
  component: PartnerPerformanceRoute,
});

function PartnerPerformanceRoute() {
  return <PartnerPerformancePage />;
}
