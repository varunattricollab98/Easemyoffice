// Auto-trigger client email reminders when a lead's stage changes.
// Called from pipeline drag, lead detail stage dropdown, and bulk stage change.
//
// Rules:
//   → follow_up / followups  → daily reminder for 7 days (salesperson can pause/stop/edit)
//   → not_interested         → weekly revival email for 8 weeks
//   → lost                   → one goodwill email, next day
//
// Creates a row in the `reminders` table (which the existing scheduler sends).

import { supabase } from "@/integrations/supabase/client";

// Default email templates (can be overridden later via snippets/settings).
const TEMPLATES: Record<string, { subject: string; message: string; interval: number; stopDays: number }> = {
  follow_up: {
    subject: "Following up on your enquiry — EaseMyOffice",
    message: `Hi {{name}},\n\nJust checking in regarding your recent enquiry with us. We'd love to help you find the perfect virtual office solution.\n\nIf you have any questions or would like to schedule a quick call, feel free to reply to this email.\n\nLooking forward to hearing from you!\n\nBest regards,\nTeam EaseMyOffice`,
    interval: 1, // daily
    stopDays: 7,
  },
  followups: {
    subject: "Following up on your enquiry — EaseMyOffice",
    message: `Hi {{name}},\n\nJust checking in regarding your recent enquiry with us. We'd love to help you find the perfect virtual office solution.\n\nIf you have any questions or would like to schedule a quick call, feel free to reply to this email.\n\nLooking forward to hearing from you!\n\nBest regards,\nTeam EaseMyOffice`,
    interval: 1,
    stopDays: 7,
  },
  not_interested: {
    subject: "We'd love another chance — EaseMyOffice",
    message: `Hi {{name}},\n\nWe understand our services may not have been the right fit at the time. However, we've been working on new plans and offers that might interest you.\n\nWould you be open to a quick conversation? No pressure — we just want to make sure you have the best options available.\n\nWarm regards,\nTeam EaseMyOffice`,
    interval: 7, // weekly
    stopDays: 56, // 8 weeks
  },
  lost: {
    subject: "Thank you for considering EaseMyOffice",
    message: `Hi {{name}},\n\nWe sincerely appreciate you considering EaseMyOffice for your business needs. While we weren't able to work together this time, we wish you all the best.\n\nIf your requirements change in the future, we'd be happy to assist. Our doors are always open.\n\nWishing you continued success!\n\nWarm regards,\nTeam EaseMyOffice`,
    interval: 0, // one-time
    stopDays: 0,
  },
};

// Stages that trigger auto-reminders.
const TRIGGER_STAGES = new Set(Object.keys(TEMPLATES));

export async function triggerStageReminder({
  leadId,
  newStage,
  clientName,
  clientEmail,
  userId,
}: {
  leadId: string;
  newStage: string;
  clientName: string;
  clientEmail?: string | null;
  userId: string;
}) {
  if (!TRIGGER_STAGES.has(newStage)) return;
  if (!clientEmail) return; // can't send without an email

  const tpl = TEMPLATES[newStage];
  if (!tpl) return;

  const name = clientName || "there";
  const subject = tpl.subject;
  const message = tpl.message.replace(/\{\{name\}\}/g, name);

  // Calculate send_at: for lost = next day; for follow-up/not-interested = 1 hour from now
  // (so the first email doesn't fire immediately — gives the salesperson time to pause if needed).
  const DAY = 86400000;
  const sendAt = newStage === "lost"
    ? new Date(Date.now() + DAY).toISOString()
    : new Date(Date.now() + 60 * 60000).toISOString(); // 1 hour

  const repeatUntil = tpl.stopDays > 0
    ? new Date(Date.now() + tpl.stopDays * DAY).toISOString()
    : null;

  // Cancel any existing scheduled stage-reminders for this lead (avoid duplicates
  // if someone drags the same lead back and forth).
  await supabase
    .from("reminders")
    .update({ status: "cancelled" })
    .eq("lead_id", leadId)
    .eq("status", "scheduled");

  // Create the new reminder.
  await supabase.from("reminders").insert({
    to_email: clientEmail,
    client_name: clientName,
    subject,
    message,
    is_html: false,
    attachments: [],
    send_at: sendAt,
    status: "scheduled",
    repeat_interval_days: tpl.interval,
    repeat_until: repeatUntil,
    lead_id: leadId,
    created_by: userId,
    assigned_to: userId,
  });
}
