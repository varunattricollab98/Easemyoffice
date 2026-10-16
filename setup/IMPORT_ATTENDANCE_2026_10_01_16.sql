-- One-off import: attendance sheet 1–16 Oct 2026 (Anchal, Hardik, Kishan, Neha, Pooja, Sarthak).
--
-- Writes rows exactly like the admin manual entry (hr-requests writeManualAttendance):
-- same schedule, late, window, status and overtime rules, entry_source = 'admin_bulk'.
--   Present          -> attendance row (login + logout, or login only = "Logout missing")
--   Work from home   -> attendance row with work_mode = 'remote', remote_status = 'approved'
--   Leave            -> approved leave_requests row (paid/unpaid is derived by the app)
--   Holiday / Sunday -> nothing (Oct 2 is added as the Gandhi Jayanti company holiday)
-- Remarks from the sheet are stored in attendance.remarks / leave_requests.reason.
-- Existing rows are never overwritten (real CRM punches win). Today's (16 Oct) rows stay
-- open so staff can press LOGOUT in the CRM as usual. Whole script is one transaction:
-- if an employee name does not match exactly one employee, nothing is written.

ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS remarks text;

INSERT INTO public.holidays (name, date, holiday_type, active)
VALUES ('Gandhi Jayanti', '2026-10-02', 'company', true)
ON CONFLICT (date, name) DO NOTHING;

DO $$
DECLARE
  c record;
  emp record;
  defaults jsonb := '[{"mode":"off","start":"10:00","end":"17:00","required_minutes":0},
    {"mode":"flexible","start":"09:00","end":"19:30","required_minutes":540},
    {"mode":"flexible","start":"09:00","end":"19:30","required_minutes":540},
    {"mode":"flexible","start":"09:00","end":"19:30","required_minutes":540},
    {"mode":"flexible","start":"09:00","end":"19:30","required_minutes":540},
    {"mode":"flexible","start":"09:00","end":"19:30","required_minutes":540},
    {"mode":"fixed","start":"10:00","end":"17:00","required_minutes":420}]';
  schedules jsonb;
  grace int;
  half int;
  admin_id uuid;
  s jsonb;
  v_mode text;
  w_start time;
  w_end time;
  req int;
  span int;
  d0 timestamptz;
  t_in timestamptz;
  t_out timestamptz;
  login_min int;
  late int;
  worked int;
  win int;
  st text;
  ot int;
  is_today boolean;
  cnt int;
  n_att int := 0;
  n_leave int := 0;
  n_kept int := 0;
  n_before_join int := 0;
  missing text;
BEGIN
  CREATE TEMP TABLE att_sheet (name text, d date, kind text, login time, logout time, remark text) ON COMMIT DROP;
  INSERT INTO att_sheet VALUES
    ('Anchal', '2026-10-01'::date, 'office', '09:58:47'::time, NULL::time, 'Logout not recorded in sheet'),
    ('Hardik', '2026-10-01'::date, 'office', '10:11:29'::time, '19:11:30'::time, NULL),
    ('Kishan', '2026-10-01'::date, 'office', '10:00:27'::time, '19:11:43'::time, NULL),
    ('Neha', '2026-10-01'::date, 'office', '09:02:50'::time, '17:56:45'::time, NULL),
    ('Pooja', '2026-10-01'::date, 'office', '10:21:45'::time, '18:52:32'::time, NULL),
    ('Sarthak', '2026-10-01'::date, 'office', '09:35:31'::time, NULL::time, 'Logout not recorded in sheet'),
    ('Anchal', '2026-10-03'::date, 'office', '09:57:49'::time, '17:08:21'::time, NULL),
    ('Hardik', '2026-10-03'::date, 'office', '10:17:22'::time, '17:20:04'::time, NULL),
    ('Kishan', '2026-10-03'::date, 'leave', NULL::time, NULL::time, 'On leave (attendance sheet)'),
    ('Neha', '2026-10-03'::date, 'office', '10:20:32'::time, '17:01:16'::time, NULL),
    ('Pooja', '2026-10-03'::date, 'office', '09:53:59'::time, '16:58:10'::time, NULL),
    ('Sarthak', '2026-10-03'::date, 'office', '10:06:55'::time, '17:10:02'::time, NULL),
    ('Anchal', '2026-10-05'::date, 'office', '09:59:57'::time, '18:50:17'::time, NULL),
    ('Hardik', '2026-10-05'::date, 'office', '10:12:56'::time, '18:05:59'::time, NULL),
    ('Kishan', '2026-10-05'::date, 'leave', NULL::time, NULL::time, 'On leave (attendance sheet)'),
    ('Neha', '2026-10-05'::date, 'office', '09:11:32'::time, '18:00:14'::time, NULL),
    ('Pooja', '2026-10-05'::date, 'office', '09:26:38'::time, '18:23:44'::time, NULL),
    ('Sarthak', '2026-10-05'::date, 'office', '10:09:57'::time, '18:50:27'::time, NULL),
    ('Anchal', '2026-10-06'::date, 'office', '10:07:22'::time, '18:41:45'::time, NULL),
    ('Hardik', '2026-10-06'::date, 'office', '10:15:25'::time, '19:12:12'::time, NULL),
    ('Kishan', '2026-10-06'::date, 'leave', NULL::time, NULL::time, 'On leave (attendance sheet)'),
    ('Neha', '2026-10-06'::date, 'office', '10:04:01'::time, '18:36:43'::time, 'I''ll be a little late.'),
    ('Pooja', '2026-10-06'::date, 'office', '09:25:29'::time, '16:37:30'::time, NULL),
    ('Sarthak', '2026-10-06'::date, 'office', '10:20:48'::time, NULL::time, 'Logout not recorded in sheet'),
    ('Anchal', '2026-10-07'::date, 'office', '10:03:48'::time, '18:41:00'::time, 'Sheet logout 06:41 read as 18:41 (PM)'),
    ('Hardik', '2026-10-07'::date, 'office', '10:18:53'::time, '19:09:25'::time, NULL),
    ('Kishan', '2026-10-07'::date, 'leave', NULL::time, NULL::time, 'On leave (attendance sheet)'),
    ('Neha', '2026-10-07'::date, 'office', '09:10:48'::time, '17:53:13'::time, NULL),
    ('Pooja', '2026-10-07'::date, 'office', '09:31:04'::time, '18:00:21'::time, NULL),
    ('Sarthak', '2026-10-07'::date, 'office', '10:18:43'::time, '18:57:11'::time, NULL),
    ('Anchal', '2026-10-08'::date, 'office', '10:02:36'::time, '18:36:00'::time, NULL),
    ('Hardik', '2026-10-08'::date, 'office', '10:39:28'::time, '18:58:07'::time, 'Will be late'),
    ('Kishan', '2026-10-08'::date, 'leave', NULL::time, NULL::time, 'On leave (attendance sheet)'),
    ('Neha', '2026-10-08'::date, 'office', '09:11:42'::time, '18:24:33'::time, NULL),
    ('Pooja', '2026-10-08'::date, 'office', '09:23:23'::time, '18:24:07'::time, NULL),
    ('Sarthak', '2026-10-08'::date, 'office', '10:43:27'::time, '18:50:01'::time, 'Will be a little late today'),
    ('Anchal', '2026-10-09'::date, 'office', '10:16:32'::time, '18:33:04'::time, 'Will be little late'),
    ('Hardik', '2026-10-09'::date, 'office', '10:26:35'::time, NULL::time, 'Logout not recorded in sheet'),
    ('Kishan', '2026-10-09'::date, 'leave', NULL::time, NULL::time, 'On leave (attendance sheet)'),
    ('Neha', '2026-10-09'::date, 'office', '09:12:36'::time, '18:18:40'::time, NULL),
    ('Pooja', '2026-10-09'::date, 'office', '09:56:24'::time, '18:35:47'::time, NULL),
    ('Sarthak', '2026-10-09'::date, 'office', '10:10:11'::time, '18:56:45'::time, NULL),
    ('Anchal', '2026-10-10'::date, 'office', '10:12:50'::time, '17:02:26'::time, NULL),
    ('Hardik', '2026-10-10'::date, 'office', '10:18:58'::time, '18:07:09'::time, NULL),
    ('Kishan', '2026-10-10'::date, 'leave', NULL::time, NULL::time, 'On leave (attendance sheet)'),
    ('Neha', '2026-10-10'::date, 'office', '10:15:29'::time, '16:57:26'::time, NULL),
    ('Pooja', '2026-10-10'::date, 'office', '09:56:06'::time, '16:50:07'::time, NULL),
    ('Sarthak', '2026-10-10'::date, 'office', '10:54:08'::time, '18:07:08'::time, NULL),
    ('Anchal', '2026-10-12'::date, 'office', '12:25:20'::time, '19:03:57'::time, NULL),
    ('Hardik', '2026-10-12'::date, 'office', '10:46:16'::time, '19:07:14'::time, NULL),
    ('Kishan', '2026-10-12'::date, 'office', '10:00:10'::time, '19:11:41'::time, NULL),
    ('Neha', '2026-10-12'::date, 'office', '09:47:12'::time, '19:08:15'::time, NULL),
    ('Pooja', '2026-10-12'::date, 'office', '10:00:49'::time, '17:12:01'::time, NULL),
    ('Sarthak', '2026-10-12'::date, 'office', '10:24:19'::time, '19:06:11'::time, NULL),
    ('Anchal', '2026-10-13'::date, 'office', '10:22:25'::time, '19:02:03'::time, NULL),
    ('Hardik', '2026-10-13'::date, 'office', '10:25:38'::time, '19:11:44'::time, NULL),
    ('Kishan', '2026-10-13'::date, 'office', '10:00:20'::time, '19:34:34'::time, NULL),
    ('Neha', '2026-10-13'::date, 'office', '09:15:52'::time, '17:54:44'::time, NULL),
    ('Pooja', '2026-10-13'::date, 'leave', NULL::time, NULL::time, 'I am not available today.'),
    ('Sarthak', '2026-10-13'::date, 'leave', NULL::time, NULL::time, 'I won''t be able to come today due to high fever.'),
    ('Anchal', '2026-10-14'::date, 'office', '10:07:59'::time, '19:55:28'::time, NULL),
    ('Hardik', '2026-10-14'::date, 'office', '10:50:00'::time, '19:08:46'::time, 'Will be a little late today'),
    ('Kishan', '2026-10-14'::date, 'office', '09:59:05'::time, '19:01:43'::time, NULL),
    ('Neha', '2026-10-14'::date, 'office', '09:07:52'::time, '17:51:40'::time, NULL),
    ('Pooja', '2026-10-14'::date, 'office', '09:46:54'::time, '18:30:51'::time, NULL),
    ('Sarthak', '2026-10-14'::date, 'wfh', '10:24:00'::time, '18:58:21'::time, 'Still have a fever, will be working from home'),
    ('Anchal', '2026-10-15'::date, 'office', '10:04:06'::time, '18:56:38'::time, NULL),
    ('Kishan', '2026-10-15'::date, 'office', '10:40:14'::time, '19:03:30'::time, NULL),
    ('Neha', '2026-10-15'::date, 'office', '09:09:48'::time, '17:52:33'::time, NULL),
    ('Pooja', '2026-10-15'::date, 'office', '09:44:27'::time, '18:36:16'::time, NULL),
    ('Sarthak', '2026-10-15'::date, 'office', '10:20:59'::time, '18:58:42'::time, NULL),
    ('Anchal', '2026-10-16'::date, 'office', '10:04:53'::time, NULL::time, NULL),
    ('Hardik', '2026-10-16'::date, 'wfh', '10:00:00'::time, NULL::time, 'Hi team, I will be working from home today.'),
    ('Kishan', '2026-10-16'::date, 'office', '09:09:39'::time, NULL::time, NULL),
    ('Neha', '2026-10-16'::date, 'office', '09:12:06'::time, NULL::time, NULL),
    ('Pooja', '2026-10-16'::date, 'office', '10:07:33'::time, NULL::time, NULL),
    ('Sarthak', '2026-10-16'::date, 'office', '10:11:17'::time, NULL::time, NULL);

  SELECT string_agg(DISTINCT a.name, ', ') INTO missing
  FROM att_sheet a
  WHERE (SELECT count(*) FROM public.employees e WHERE lower(trim(e.first_name)) = lower(a.name)) <> 1;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'No single employee found for: %. Nothing was imported.', missing;
  END IF;

  SELECT h.day_schedules, COALESCE(h.grace_minutes, 15), COALESCE(h.half_day_minutes, 240)
    INTO schedules, grace, half
  FROM public.hr_settings h LIMIT 1;
  grace := COALESCE(grace, 15);
  half := COALESCE(half, 240);

  SELECT ur.user_id INTO admin_id FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;

  FOR c IN SELECT * FROM att_sheet ORDER BY d, name LOOP
    SELECT * INTO emp FROM public.employees e WHERE lower(trim(e.first_name)) = lower(c.name);
    IF emp.joining_date IS NOT NULL AND c.d < emp.joining_date THEN
      n_before_join := n_before_join + 1;
      CONTINUE;
    END IF;

    IF c.kind = 'leave' THEN
      IF EXISTS (
        SELECT 1 FROM public.leave_requests l
        WHERE l.employee_id = emp.id AND l.status IN ('pending', 'approved')
          AND c.d BETWEEN l.from_date AND l.to_date
      ) THEN
        n_kept := n_kept + 1;
      ELSE
        INSERT INTO public.leave_requests
          (employee_id, from_date, to_date, half_day, days, reason, status, decided_by, decided_at, admin_note)
        VALUES
          (emp.id, c.d, c.d, false, 1, c.remark, 'approved', admin_id, now(),
           'Imported from attendance sheet (1–16 Oct 2026)');
        n_leave := n_leave + 1;
      END IF;
      CONTINUE;
    END IF;

    -- Day schedule, normalised like normalizeSchedules().
    s := schedules -> extract(dow FROM c.d)::int;
    IF s IS NULL OR COALESCE(s ->> 'mode', '') NOT IN ('off', 'flexible', 'fixed') THEN
      s := defaults -> extract(dow FROM c.d)::int;
    END IF;
    v_mode := s ->> 'mode';
    w_start := (s ->> 'start')::time;
    w_end := (s ->> 'end')::time;
    span := (extract(epoch FROM (w_end - w_start)) / 60)::int;
    IF v_mode = 'off' THEN
      req := 0;
    ELSIF v_mode = 'fixed' THEN
      req := span;
    ELSE
      req := LEAST(COALESCE(NULLIF((s ->> 'required_minutes')::int, 0), 540), span);
    END IF;

    d0 := (c.d::text || ' 00:00:00+05:30')::timestamptz;
    t_in := d0 + (c.login - time '00:00');
    login_min := floor(extract(epoch FROM (c.login - time '00:00')) / 60)::int;
    late := CASE
      WHEN v_mode = 'fixed' THEN
        CASE WHEN login_min - (extract(epoch FROM (w_start - time '00:00')) / 60)::int > grace
             THEN login_min - (extract(epoch FROM (w_start - time '00:00')) / 60)::int ELSE 0 END
      WHEN v_mode = 'flexible' THEN
        GREATEST(0, login_min - ((extract(epoch FROM (w_end - time '00:00')) / 60)::int - req))
      ELSE 0
    END;

    IF c.logout IS NOT NULL THEN
      t_out := d0 + (c.logout - time '00:00');
      worked := floor(extract(epoch FROM (t_out - t_in)) / 60)::int;
      win := CASE WHEN v_mode = 'off' THEN 0 ELSE GREATEST(0, floor(extract(epoch FROM (
               LEAST(t_out, d0 + (w_end - time '00:00')) - GREATEST(t_in, d0 + (w_start - time '00:00'))
             )) / 60)::int) END;
      IF v_mode = 'off' OR req <= 0 THEN
        st := 'present'; ot := worked;
      ELSIF win >= req THEN
        st := 'present'; ot := GREATEST(0, worked - req);
      ELSE
        st := CASE WHEN win >= half THEN 'short' ELSE 'half_day' END; ot := 0;
      END IF;
    ELSE
      t_out := NULL; worked := 0; win := 0; st := 'in_progress'; ot := 0;
    END IF;

    is_today := c.d = (now() AT TIME ZONE 'Asia/Kolkata')::date;

    INSERT INTO public.attendance (
      employee_id, work_date, first_login_at, last_logout_at, open_since, last_activity_at,
      worked_minutes, window_minutes, status, is_late, late_minutes, overtime_minutes,
      schedule_mode, window_start, window_end, required_minutes,
      work_mode, remote_status, remote_reason, remote_decided_by, remote_decided_at,
      entry_source, remarks
    ) VALUES (
      emp.id, c.d, t_in, t_out,
      CASE WHEN t_out IS NULL AND is_today THEN t_in END,
      CASE WHEN t_out IS NULL AND is_today THEN t_in END,
      worked, win, st, late > 0, late, ot,
      v_mode, w_start, w_end, req,
      CASE WHEN c.kind = 'wfh' THEN 'remote' ELSE 'office' END,
      CASE WHEN c.kind = 'wfh' THEN 'approved' END,
      CASE WHEN c.kind = 'wfh' THEN c.remark END,
      CASE WHEN c.kind = 'wfh' THEN admin_id END,
      CASE WHEN c.kind = 'wfh' THEN now() END,
      'admin_bulk', c.remark
    )
    ON CONFLICT (employee_id, work_date) DO NOTHING;
    GET DIAGNOSTICS cnt = ROW_COUNT;
    IF cnt = 0 THEN n_kept := n_kept + 1; ELSE n_att := n_att + 1; END IF;
  END LOOP;

  RAISE NOTICE 'Attendance rows added: %, leave days added: %, already in CRM (kept): %, before joining date (skipped): %',
    n_att, n_leave, n_kept, n_before_join;
END $$;
