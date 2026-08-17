-- ─────────────────────────────────────────────────────────────────────────
-- ADD_DASHBOARD_RPC.sql
-- Server-side aggregation functions for the dashboard.
-- Replaces client-side counting of 5000 rows with fast DB-level GROUP BY.
-- Safe to run multiple times (CREATE OR REPLACE).
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Dashboard stats: counts by stage + hot/closures/assignedToday
--    Accepts an optional user_id for scope filtering (NULL = all / admin view).
CREATE OR REPLACE FUNCTION public.dashboard_stats_agg(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  by_stage jsonb;
  hot_count int;
  closures_count int;
  assigned_today_count int;
  start_of_month timestamptz;
  start_of_day timestamptz;
BEGIN
  start_of_month := date_trunc('month', now());
  start_of_day := date_trunc('day', now());

  -- Count leads grouped by stage (scoped)
  SELECT coalesce(jsonb_object_agg(stage, cnt), '{}'::jsonb)
  INTO by_stage
  FROM (
    SELECT stage, count(*)::int AS cnt
    FROM public.leads
    WHERE (p_user_id IS NULL OR assigned_to = p_user_id OR created_by = p_user_id)
    GROUP BY stage
  ) sub;

  -- Hot leads count
  SELECT count(*)::int INTO hot_count
  FROM public.leads
  WHERE interest = 'hot'
    AND (p_user_id IS NULL OR assigned_to = p_user_id OR created_by = p_user_id);

  -- Closures this month
  SELECT count(*)::int INTO closures_count
  FROM public.leads
  WHERE stage IN ('agreement_signed', 'completed')
    AND updated_at >= start_of_month
    AND (p_user_id IS NULL OR assigned_to = p_user_id OR created_by = p_user_id);

  -- Leads assigned/created today
  SELECT count(*)::int INTO assigned_today_count
  FROM public.leads
  WHERE created_at >= start_of_day
    AND (p_user_id IS NULL OR assigned_to = p_user_id OR created_by = p_user_id);

  result := jsonb_build_object(
    'byStage', by_stage,
    'hot', hot_count,
    'closures', closures_count,
    'assignedToday', assigned_today_count
  );

  RETURN result;
END;
$$;

-- 2. 30-day trend: per-day buckets of new leads and closures
CREATE OR REPLACE FUNCTION public.dashboard_trend_30d(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  trend_start timestamptz;
BEGIN
  trend_start := date_trunc('day', now() - interval '30 days');

  WITH days AS (
    SELECT generate_series(trend_start, date_trunc('day', now()), interval '1 day')::date AS d
  ),
  new_per_day AS (
    SELECT (created_at::date) AS d, count(*)::int AS cnt
    FROM public.leads
    WHERE created_at >= trend_start
      AND (p_user_id IS NULL OR assigned_to = p_user_id OR created_by = p_user_id)
    GROUP BY created_at::date
  ),
  close_per_day AS (
    SELECT (updated_at::date) AS d, count(*)::int AS cnt
    FROM public.leads
    WHERE stage IN ('agreement_signed', 'completed')
      AND updated_at >= trend_start
      AND (p_user_id IS NULL OR assigned_to = p_user_id OR created_by = p_user_id)
    GROUP BY updated_at::date
  )
  SELECT jsonb_build_object(
    'dates', coalesce(jsonb_agg(days.d ORDER BY days.d), '[]'::jsonb),
    'newLeads', coalesce(jsonb_agg(coalesce(n.cnt, 0) ORDER BY days.d), '[]'::jsonb),
    'closures', coalesce(jsonb_agg(coalesce(c.cnt, 0) ORDER BY days.d), '[]'::jsonb)
  )
  INTO result
  FROM days
  LEFT JOIN new_per_day n ON n.d = days.d
  LEFT JOIN close_per_day c ON c.d = days.d;

  RETURN result;
END;
$$;

-- Grant execute to authenticated users (RLS is handled by the scope param).
GRANT EXECUTE ON FUNCTION public.dashboard_stats_agg(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_trend_30d(uuid) TO authenticated;
