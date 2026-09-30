import { createFileRoute, redirect } from "@tanstack/react-router";

// The hub opens on Attendance — the section the admin checks daily.
export const Route = createFileRoute("/_authenticated/hrms/")({
  beforeLoad: () => {
    throw redirect({ to: "/hrms/attendance" });
  },
});
