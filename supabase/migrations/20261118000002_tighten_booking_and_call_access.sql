-- Remove the live broad policy that allowed every authenticated user to
-- update every booking. The narrower bookings_update and
-- bookings_update_renewal policies remain in force.
DROP POLICY IF EXISTS bookings_update_team ON public.bookings;

-- TeleCMI events contain personal phone numbers and unfiltered webhook payloads.
-- Limit row access to admins, the matched agent, or staff who can access the
-- linked lead. RLS policies are permissive, so remove the old blanket policy.
DROP POLICY IF EXISTS telecmi_calls_select_auth ON public.telecmi_call_events;
DROP POLICY IF EXISTS "telecmi_calls_select_auth" ON public.telecmi_call_events;
CREATE POLICY telecmi_calls_select_scoped
ON public.telecmi_call_events
FOR SELECT TO authenticated
USING (
  public.is_admin(auth.uid())
  OR matched_agent_id = auth.uid()
  OR (
    matched_lead_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.leads l
      WHERE l.id = telecmi_call_events.matched_lead_id
        AND (
          l.assigned_to = auth.uid()
          OR l.created_by = auth.uid()
        )
    )
  )
);

-- Replace direct table reads used for dashboard call totals with a narrow,
-- authenticated aggregate RPC that returns counts only (never phone numbers,
-- agent details, or raw webhook payloads).
CREATE OR REPLACE FUNCTION public.telecmi_call_counts_today(p_start timestamptz)
RETURNS TABLE(answered bigint, missed bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN QUERY
  SELECT
    count(*) FILTER (WHERE status = 'answered')::bigint,
    count(*) FILTER (WHERE status = 'missed')::bigint
  FROM public.telecmi_call_events
  WHERE created_at >= p_start;
END;
$$;

REVOKE ALL ON FUNCTION public.telecmi_call_counts_today(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.telecmi_call_counts_today(timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.telecmi_call_counts_today(timestamptz) TO authenticated;
