// Inline renewal dashboard on the main Dashboard (renewals users only).
// Lazy so everyone else never downloads it.
import { lazy } from "react";

export const RenewalDashboardInline = lazy(() =>
  import("@/components/renewals/renewal-dashboard").then((m) => ({ default: m.RenewalDashboard })),
);
