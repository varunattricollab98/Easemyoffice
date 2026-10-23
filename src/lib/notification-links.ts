// Where a notification row should take the user when clicked.
//
// Rows carry lead_id / task_id when they point at one record; everything else
// (leave requests, WFH, attendance, documentation, calls) is routed by
// notifications.type. Shared by the Notifications page and the desktop-alert
// URL so both open the same place.

export interface NotificationLinkInput {
  type?: string | null;
  lead_id?: string | null;
  task_id?: string | null;
}

export interface NotificationLink {
  to: string;
  params?: Record<string, string>;
  /** Plain URL, for desktop notifications. */
  url: string;
}

const BY_TYPE: Record<string, string> = {
  // Admin approvals
  hr_leave_request: "/hrms/approvals",
  hr_remote_request: "/hrms/approvals",
  hr_attendance_request: "/hrms/approvals",
  hr_shared_device: "/hrms/attendance",
  hr_spoof_suspect: "/hrms/attendance",
  // Employee: decision on their own request, and the forgot-to-log-out nudge
  hr_logout_reminder: "/attendance",
  hr_leave_decision: "/attendance",
  hr_remote_decision: "/attendance",
  hr_attendance_decision: "/attendance",
  // CRM
  doc_assigned: "/documentation",
  call: "/calls",
  missed_call: "/calls",
  missed_call_unclaimed: "/calls",
  new_lead_unclaimed: "/inbox",
  follow_up: "/follow-ups",
  task: "/tasks",
  task_assigned: "/tasks",
  task_done: "/tasks",
};

export function notificationLink(n: NotificationLinkInput): NotificationLink | undefined {
  if (n.lead_id) return { to: "/leads/$id", params: { id: n.lead_id }, url: `/leads/${n.lead_id}` };
  if (n.task_id) return { to: "/tasks", url: "/tasks" };
  const type = n.type ?? "";
  const path = BY_TYPE[type] ?? (type.startsWith("hr_") ? "/attendance" : undefined);
  return path ? { to: path, url: path } : undefined;
}
