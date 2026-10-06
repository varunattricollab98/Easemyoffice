import { createFileRoute } from "@tanstack/react-router";
import { CalendarCheck } from "lucide-react";
import { guardRoles } from "@/lib/route-guard";
import { ActivityFeed } from "@/components/b2b/activity-feed";

export const Route = createFileRoute("/_authenticated/b2b/activities/meetings")({
  head: () => ({ meta: [{ title: "B2B Meetings — EaseMyOffice CRM" }] }),
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "b2b"]);
  },
  component: MeetingsPage,
});

function MeetingsPage() {
  return (
    <ActivityFeed
      title="Meetings"
      description="Every meeting logged against a CA firm or B2B lead."
      icon={CalendarCheck}
      fixedType="meeting"
    />
  );
}
