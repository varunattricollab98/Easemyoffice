-- Hardware fingerprint per attendance device (screen, timezone, CPU, GPU,
-- model hash sent by the browser). When a browser's storage is cleared it
-- gets a new device_key; the punch function then finds the same fingerprint
-- for the same employee and keeps that device's approved/blocked status
-- instead of asking the admin to approve it again. Optional: the punch
-- function works without this column (no re-linking). Safe to re-run.
ALTER TABLE public.attendance_devices ADD COLUMN IF NOT EXISTS fingerprint text;
CREATE INDEX IF NOT EXISTS idx_attendance_devices_fingerprint
  ON public.attendance_devices (employee_id, fingerprint)
  WHERE fingerprint IS NOT NULL;
