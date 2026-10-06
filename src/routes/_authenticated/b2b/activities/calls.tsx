import { createFileRoute } from "@tanstack/react-router";
import { Phone } from "lucide-react";
import { guardRoles } from "@/lib/route-guard";
import { ActivityFeed } from "@/components/b2b/activity-feed";

export const Route = createFileRoute("/_authenticated/b2b/activities/calls")({
  head: () => ({ meta: [{ title: "B2B Calls — EaseMyOffice CRM" }] }),
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "b2b"]);
  },
  component: CallsPage,
});

function CallsPage() {
  return (
    <ActivityFeed
      title="Calls"
      description="Every call logged against a CA firm or B2B lead."
      icon={Phone}
      fixedType="call"
    />
  );
}
