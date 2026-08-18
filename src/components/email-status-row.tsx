/**
 * Shared EmailStatusRow component that displays the email reminder status
 * for a follow-up card. Used by both the Follow-ups page and the Lead detail page.
 */
import { Badge } from "@/components/ui/badge";
import { Mail, MailX, Pause, Clock } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { getFrequencyLabel } from "@/lib/email-utils";

export type Reminder = {
  id: string;
  lead_id: string | null;
  subject: string;
  status: string;
  send_at: string;
  sent_at: string | null;
  repeat_interval_days: number;
  repeat_until: string | null;
  occurrences_sent: number;
};

export function EmailStatusRow({
  activeReminder,
  pausedReminder,
  sentReminders,
  leadReminders,
}: {
  activeReminder: Reminder | undefined;
  pausedReminder: Reminder | undefined;
  sentReminders: Reminder[];
  leadReminders: Reminder[];
}) {
  // No reminders at all
  if (leadReminders.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground pl-1">
        <MailX className="h-3.5 w-3.5" />
        <span>No email configured</span>
      </div>
    );
  }

  // Active scheduled reminder
  if (activeReminder) {
    const nextSend = new Date(activeReminder.send_at);
    const countdown = formatDistanceToNow(nextSend, { addSuffix: true });
    const freq = getFrequencyLabel(activeReminder.repeat_interval_days, activeReminder.repeat_until);

    return (
      <div className="flex flex-wrap items-center gap-2 text-xs pl-1">
        <Badge variant="secondary" className="gap-1 text-xs font-normal">
          <Mail className="h-3 w-3 text-green-600" />
          Scheduled
        </Badge>
        <span className="text-muted-foreground truncate max-w-[180px]" title={activeReminder.subject}>
          {activeReminder.subject.length > 30 ? activeReminder.subject.slice(0, 30) + "..." : activeReminder.subject}
        </span>
        {freq && <span className="text-muted-foreground">&middot; {freq}</span>}
        {activeReminder.occurrences_sent > 0 && (
          <span className="text-muted-foreground">&middot; {activeReminder.occurrences_sent} sent</span>
        )}
        <span className="flex items-center gap-1 text-muted-foreground">
          <Clock className="h-3 w-3" />
          Next: {format(nextSend, "dd MMM, h:mm a")} ({countdown})
        </span>
      </div>
    );
  }

  // Paused reminder
  if (pausedReminder) {
    return (
      <div className="flex items-center gap-2 text-xs pl-1">
        <Badge variant="secondary" className="gap-1 text-xs font-normal">
          <Pause className="h-3 w-3 text-amber-500" />
          Email paused
        </Badge>
        <span className="text-muted-foreground truncate max-w-[180px]">
          {pausedReminder.subject.length > 30 ? pausedReminder.subject.slice(0, 30) + "..." : pausedReminder.subject}
        </span>
        {pausedReminder.occurrences_sent > 0 && (
          <span className="text-muted-foreground">&middot; {pausedReminder.occurrences_sent} sent</span>
        )}
      </div>
    );
  }

  // Only sent reminders (completed sequence)
  if (sentReminders.length > 0) {
    const totalSent = sentReminders.reduce((sum, r) => sum + r.occurrences_sent, 0);
    return (
      <div className="flex items-center gap-2 text-xs pl-1">
        <Badge variant="secondary" className="gap-1 text-xs font-normal">
          <Mail className="h-3 w-3 text-blue-500" />
          Email sent ({totalSent}x)
        </Badge>
      </div>
    );
  }

  // Failed reminders
  return (
    <div className="flex items-center gap-2 text-xs pl-1">
      <Badge variant="destructive" className="gap-1 text-xs font-normal">
        <MailX className="h-3 w-3" />
        Email failed
      </Badge>
    </div>
  );
}
