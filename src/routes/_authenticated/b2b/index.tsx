import { createFileRoute } from "@tanstack/react-router";
import { guardRoles } from "@/lib/route-guard";
import { B2BDashboard } from "@/components/b2b/dashboard";

// B2B department landing page. Thin route — the heavy dashboard body (KPI grid,
// funnel, activity section, employee leaderboard, partner health, source table)
// lives in src/components/b2b/dashboard.tsx so route-based code splitting keeps
// it (and the recharts the analytics screens pull in) out of the entry chunk.
// Guards to admin + b2b; RLS stays the real boundary (b2b users see their own
// rows, admins see everything).
export const Route = createFileRoute("/_authenticated/b2b/")({
  head: () => ({ meta: [{ title: "B2B Dashboard — EaseMyOffice CRM" }] }),
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "b2b"]);
  },
  component: B2BDashboard,
});
