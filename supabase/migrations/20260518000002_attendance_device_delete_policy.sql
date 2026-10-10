-- HRMS: allow admins to DELETE a registered device.
--
-- WHY
--   The Phase 2 migration (20260516000006_hrms_phase2_attendance.sql) grants
--   admins UPDATE on attendance_devices (approve / revoke) but no DELETE policy.
--   The admin Attendance -> Devices tab now offers a "Delete device" action
--   that removes a registration entirely (distinct from "Block"/revoke). Under
--   RLS a browser DELETE is silently blocked until this policy exists, so the
--   UI degrades gracefully — the mutation surfaces an error toast — until this
--   migration is applied.
--
--   OWNER-APPLIED: like every migration in this repo, this is run manually by
--   the owner after merge. Deleting a device only removes the registration;
--   attendance history is untouched (attendance rows keep device_key as plain
--   text, with no foreign key to attendance_devices).
--
-- Safe to re-run: the policy is dropped before it is created.

DROP POLICY IF EXISTS attendance_devices_admin_delete ON public.attendance_devices;
CREATE POLICY attendance_devices_admin_delete ON public.attendance_devices FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));
