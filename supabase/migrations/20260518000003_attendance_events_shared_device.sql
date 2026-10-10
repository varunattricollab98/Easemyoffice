-- HRMS: record WHO a shared device is also registered to on the audit row.
--
-- WHY
--   The attendance-punch edge function now detects, live at punch time, when a
--   device_key is already registered to a DIFFERENT employee (cross-employee
--   sharing). The attempt is flagged in attendance_events.reason with a
--   'shared_device' token and admins are alerted — the punch is never blocked.
--   This optional column lets the audit row also point at the OTHER owner so
--   the Security tab / exports can resolve the name, not just the token.
--
--   GRACEFUL DEGRADATION: the edge function writes this column via a SEPARATE
--   best-effort update (never in the main INSERT), so punches keep working
--   exactly as before until this migration is applied. The 'shared_device'
--   reason token and the admin alert do not depend on this column.
--
--   OWNER-APPLIED: like every migration in this repo, run manually by the owner
--   after merge. ON DELETE SET NULL mirrors attendance_events.employee_id so
--   removing an employee never breaks the audit trail.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.attendance_events
  ADD COLUMN IF NOT EXISTS shared_with_employee_id uuid
    REFERENCES public.employees(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.attendance_events.shared_with_employee_id IS
  'When a punch used a device also registered to another employee, the other employee''s id (cross-employee shared-device detection). Nullable; set best-effort by the attendance-punch edge function.';
