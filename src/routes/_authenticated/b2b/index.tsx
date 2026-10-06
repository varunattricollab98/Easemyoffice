import { createFileRoute } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { guardRoles } from "@/lib/route-guard";

// B2B department landing page — stub for now. Guards to admin + b2b; RLS stays
// the real boundary. The full dashboard (KPIs, pipeline, partner health) lands
// in later phases; this placeholder exists so the sidebar section has a target.
export const Route = createFileRoute("/_authenticated/b2b/")({
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "b2b"]);
  },
  component: B2BDashboard,
});

function B2BDashboard() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
          <Building2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">B2B</h1>
          <p className="text-sm text-muted-foreground">CA firm partnerships & referrals</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>B2B Dashboard</CardTitle>
          <CardDescription>
            This is the home of the B2B department. Accounts, leads, the partnership pipeline,
            referrals and analytics are being added here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}
