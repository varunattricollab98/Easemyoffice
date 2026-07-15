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

// Default email templates (used when no snippet is assigned in admin settings).
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

type AutoConfig = Record<string, { enabled: boolean; snippet_id: string; interval_days: number; stop_days: number }>;

// Cache the admin config for 60s so repeated stage changes in the same session don't re-fetch each time.
let _configCache: { data: AutoConfig | null; ts: number } = { data: null, ts: 0 };
async function getAutoConfig(): Promise<AutoConfig | null> {
  if (Date.now() - _configCache.ts < 60000 && _configCache.data !== undefined) return _configCache.data;
  const { data } = await supabase.from("crm_settings").select("value").eq("key", "email_automation_config").maybeSingle();
  _configCache = { data: (data?.value as AutoConfig) ?? null, ts: Date.now() };
  return _configCache.data;
}

// Load a snippet by ID.
async function getSnippet(id: string) {
  if (!id) return null;
  const { data } = await supabase.from("email_snippets").select("subject, body_html").eq("id", id).maybeSingle();
  return data;
}

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

  // Load admin config (if set) to check enabled/disabled + custom snippet + interval.
  const adminCfg = await getAutoConfig();
  const stageCfg = adminCfg?.[newStage];

  // If admin explicitly disabled this stage trigger, do nothing.
  if (stageCfg && stageCfg.enabled === false) return;

  const tpl = TEMPLATES[newStage];
  if (!tpl) return;

  // Determine interval and stopDays (admin override or default).
  const interval = stageCfg?.interval_days ?? tpl.interval;
  const stopDays = stageCfg?.stop_days ?? tpl.stopDays;

  // Determine subject + message (from snippet or default template).
  let subject = tpl.subject;
  let message = tpl.message;
  let isHtml = false;

  if (stageCfg?.snippet_id) {
    const snippet = await getSnippet(stageCfg.snippet_id);
    if (snippet) {
      subject = snippet.subject || subject;
      message = snippet.body_html || message;
      isHtml = true;
    }
  }

  const name = clientName || "there";
  subject = subject.replace(/\{\{name\}\}/g, name);
  message = message.replace(/\{\{name\}\}/g, name);

  // Calculate send_at: for lost = next day; for follow-up/not-interested = 1 hour from now
  const DAY = 86400000;
  const sendAt = newStage === "lost"
    ? new Date(Date.now() + DAY).toISOString()
    : new Date(Date.now() + 60 * 60000).toISOString(); // 1 hour

  const repeatUntil = stopDays > 0
    ? new Date(Date.now() + stopDays * DAY).toISOString()
    : null;

  // Cancel any existing scheduled stage-reminders for this lead (avoid duplicates).
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
    is_html: isHtml,
    attachments: [],
    send_at: sendAt,
    status: "scheduled",
    repeat_interval_days: interval,
    repeat_until: repeatUntil,
    lead_id: leadId,
    created_by: userId,
    assigned_to: userId,
  });
}
