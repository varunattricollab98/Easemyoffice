import { createFileRoute } from "@tanstack/react-router";
import { RenewalDashboard } from "@/components/renewals/renewal-dashboard";

export const Route = createFileRoute("/_authenticated/renewals/")({
  head: () => ({ meta: [{ title: "Renewal Dashboard — EaseMyOffice CRM" }] }),
  component: RenewalDashboard,
});
