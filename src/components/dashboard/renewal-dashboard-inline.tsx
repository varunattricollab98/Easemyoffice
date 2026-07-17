// Re-exports the Renewal Dashboard content for inline use in the unified dashboard.
// This avoids duplicating the component — the route page and the dashboard switcher
// both render the same RenewalDashboard function.
export { RenewalDashboard as RenewalDashboardInline } from "@/routes/_authenticated/renewals/index";
