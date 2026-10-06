import { createFileRoute } from "@tanstack/react-router";
import { guardRoles } from "@/lib/route-guard";
import { B2BDocumentationPage } from "@/components/b2b/documentation";

// Thin route: the partner onboarding checklist board (KPI tiles + per-firm
// checklist with progress %) lives in src/components/b2b/documentation.tsx so
// it stays code-split, matching the other B2B routes.
export const Route = createFileRoute("/_authenticated/b2b/documentation")({
  head: () => ({ meta: [{ title: "B2B Documentation — EaseMyOffice CRM" }] }),
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "b2b"]);
  },
  component: B2BDocumentationRoute,
});

function B2BDocumentationRoute() {
  return <B2BDocumentationPage />;
}
