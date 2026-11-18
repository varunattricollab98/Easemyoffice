-- Prevent anonymous and direct client RPC access to SECURITY DEFINER dashboard
-- aggregates. The dashboard query factories already fall back to RLS-scoped
-- client-side aggregation when these RPC calls fail, so normal dashboard use
-- continues without exposing organization-wide aggregates through RPC.
--
-- These functions are intentionally unavailable to browser roles until their
-- caller-identity and role-scope checks are implemented and tested.

REVOKE ALL ON FUNCTION public.dashboard_stats_agg(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dashboard_stats_agg(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.dashboard_stats_agg(uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public.dashboard_trend_30d(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dashboard_trend_30d(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.dashboard_trend_30d(uuid) FROM authenticated;
