import { createFileRoute, redirect } from "@tanstack/react-router";

// Convenience route — opens leads list with the dialog flag.
export const Route = createFileRoute("/_authenticated/leads/new")({
  beforeLoad: () => { throw redirect({ to: "/leads", search: { new: 1 } as any }); },
});
