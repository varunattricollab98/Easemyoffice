import { createFileRoute } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { guardRoles } from "@/lib/route-guard";
import { ActivityFeed } from "@/components/b2b/activity-feed";

export const Route = createFileRoute("/_authenticated/b2b/activities/history")({
  head: () => ({ meta: [{ title: "Activity History — EaseMyOffice CRM" }] }),
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "b2b"]);
  },
  component: ActivityHistoryPage,
});

function ActivityHistoryPage() {
  return (
    <ActivityFeed
      title="Activity History"
      description="Full chronological feed across firms and leads. Filter by type and date."
      icon={Activity}
      showTypeFilter
    />
  );
}
