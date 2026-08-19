import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell, Check, XCircle, Settings2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import { FollowUpsSkeleton } from "@/components/skeletons";
import { usePagePerf } from "@/lib/perf";
import { subscribeRealtime } from "@/lib/realtime-manager";
import { stopAllFollowUps, triggerStageReminder } from "@/lib/stage-reminders";
import { FollowupConfigDialog, type EmailConfig } from "@/components/followup-config-dialog";
import { EmailStatusRow, type Reminder } from "@/components/email-status-row";
import { useAuth } from "@/lib/auth";

type FollowUpSearch = { filter?: "overdue" | "today" | "upcoming" };

export const Route = createFileRoute("/_authenticated/follow-ups")({
  head: () => ({ meta: [{ title: "Follow-ups — EaseMyOffice CRM" }] }),
  validateSearch: (s: Record<string, unknown>): FollowUpSearch => ({
    filter: s.filter === "overdue" || s.filter === "today" || s.filter === "upcoming"
      ? s.filter : undefined,
  }),
  component: FollowUpsPage,
});

type FU = {
  id: string; action: string; due_at: string; status: string;
  lead_id: string | null;
  leads: { id: string; lead_code: string; client_name: string; email: string | null; stage: string } | null;
};



function FollowUpsPage() {
  const qc = useQueryClient();
  const search = Route.useSearch();
  const { user } = useAuth();

  // State for config dialog
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [configLead, setConfigLead] = useState<{ id: string; clientName: string; email: string | null } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["all-followups"],
    queryFn: async () => {
      const { data } = await supabase
        .from("follow_ups")
        .select("id, action, due_at, status, lead_id, leads:lead_id(id, lead_code, client_name, email, stage)")
        .order("due_at", { ascending: true })
        .limit(300);
      return (data ?? []) as unknown as FU[];
    },
  });

  // Get all lead_ids from follow-ups to fetch associated reminders
  const leadIds = useMemo(() => {
    if (!data) return [];
    const ids = new Set<string>();
    for (const fu of data) {
      if (fu.lead_id) ids.add(fu.lead_id);
    }
    return Array.from(ids);
  }, [data]);

  // Fetch reminders linked to the same leads (batched in chunks of 50 to avoid URL-length limits)
  const { data: reminders } = useQuery({
    queryKey: ["followup-reminders", leadIds],
    enabled: leadIds.length > 0,
    refetchInterval: 30000,
    queryFn: async () => {
      const chunkSize = 50;
      const chunks: string[][] = [];
      for (let i = 0; i < leadIds.length; i += chunkSize) {
        chunks.push(leadIds.slice(i, i + chunkSize));
      }
      const results = await Promise.all(
        chunks.map((chunk) =>
          supabase
            .from("reminders")
            .select("id, lead_id, subject, status, send_at, sent_at, repeat_interval_days, repeat_until, occurrences_sent")
            .in("lead_id", chunk)
            .in("status", ["scheduled", "paused", "sent", "failed"])
        )
      );
      const allData: Reminder[] = [];
      for (const result of results) {
        if (result.data) allData.push(...(result.data as unknown as Reminder[]));
      }
      return allData;
    },
  });

  // Build a map of lead_id -> reminders for quick lookup
  const remindersByLead = useMemo(() => {
    const map = new Map<string, Reminder[]>();
    if (!reminders) return map;
    for (const r of reminders) {
      if (!r.lead_id) continue;
      const existing = map.get(r.lead_id) ?? [];
      existing.push(r);
      map.set(r.lead_id, existing);
    }
    return map;
  }, [reminders]);

  // Live updates: refresh on any follow_ups or leads change
  useEffect(() => {
    const unsub = subscribeRealtime("followups", ["follow_ups", "leads"], () => {
      qc.invalidateQueries({ queryKey: ["all-followups"] });
      qc.invalidateQueries({ queryKey: ["followup-reminders"] });
    });
    return unsub;
  }, [qc]);

  usePagePerf("Follow-ups", isLoading);

  const now = new Date();
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const overdue = (data ?? []).filter((f) => f.status === "pending" && new Date(f.due_at) < now);
  const today = (data ?? []).filter((f) => f.status === "pending" && new Date(f.due_at) >= now && new Date(f.due_at) <= todayEnd);
  const upcoming = (data ?? []).filter((f) => f.status === "pending" && new Date(f.due_at) > todayEnd);

  const markDone = async (id: string, leadId: string | null) => {
    await supabase.from("follow_ups").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", id);
    qc.invalidateQueries();

    // Check if there's still a scheduled reminder for this lead
    if (leadId) {
      const leadReminders = remindersByLead.get(leadId) ?? [];
      const activeReminder = leadReminders.find((r) => r.status === "scheduled");
      if (activeReminder) {
        toast.success("Marked done - email sequence still active", {
          description: "The scheduled email reminders for this lead are still running. Stop them from the follow-up card if needed.",
          duration: 5000,
        });
        return;
      }
    }
    toast.success("Done");
  };

  const stopFollowUp = async (leadId: string, clientName: string) => {
    const { stoppedFollowUps, stoppedReminders } = await stopAllFollowUps(leadId);
    qc.invalidateQueries();
    toast.success(
      `Stopped follow-ups for ${clientName}` +
      (stoppedReminders > 0 ? ` (${stoppedReminders} email reminder${stoppedReminders > 1 ? "s" : ""} also cancelled)` : ""),
    );
  };

  const openConfigDialog = (leadId: string, clientName: string, email: string | null) => {
    setConfigLead({ id: leadId, clientName, email });
    setConfigDialogOpen(true);
  };

  const handleEmailConfig = async (config: EmailConfig) => {
    if (!configLead || !user?.id) return;
    await triggerStageReminder({
      leadId: configLead.id,
      newStage: "followups",
      clientName: configLead.clientName,
      clientEmail: configLead.email,
      userId: user.id,
      emailConfig: {
        snippetId: config.snippetId,
        intervalDays: config.intervalDays,
        stopDays: config.stopDays,
        sendAt: config.sendAt,
      },
    });
    qc.invalidateQueries();
    toast.success("Email reminder configured");
  };

  const Section = ({ id, title, items, tone }: { id: "overdue" | "today" | "upcoming"; title: string; items: FU[]; tone: string }) => {
    if (search.filter && search.filter !== id) return null;
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className={`h-4 w-4 ${tone}`} />{title}
            <span className="text-muted-foreground">· {items.length}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {items.length === 0 && <div className="text-sm text-muted-foreground">Nothing here.</div>}
          {items.map((f) => {
            const leadReminders = f.lead_id ? (remindersByLead.get(f.lead_id) ?? []) : [];
            const activeReminder = leadReminders.find((r) => r.status === "scheduled");
            const pausedReminder = leadReminders.find((r) => r.status === "paused");
            const sentReminders = leadReminders.filter((r) => r.status === "sent");
            const isFollowupStage = f.leads?.stage === "followups";

            return (
              <div key={f.id} className="flex flex-col gap-2 p-4 rounded-xl border hover:shadow-md hover:scale-[1.01] transition-all duration-200 ease-out">
                {/* Main row: task info + actions */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <Link to="/leads/$id" params={{ id: f.leads?.id ?? "" }} className="text-sm font-medium hover:underline">
                      {f.action}
                    </Link>
                    <div className="text-[11px] text-muted-foreground/70">
                      {f.leads?.client_name} · {format(new Date(f.due_at), "PPp")}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="transition-all duration-200 ease-out" onClick={() => markDone(f.id, f.lead_id)} title="Mark done">
                    <Check className="h-4 w-4" />
                  </Button>
                  {isFollowupStage && f.status === "pending" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="transition-all duration-200 ease-out"
                      onClick={() => openConfigDialog(f.leads?.id ?? "", f.leads?.client_name ?? "client", f.leads?.email ?? null)}
                      title="Configure email reminders"
                    >
                      <Settings2 className="h-4 w-4" />
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="text-destructive hover:text-destructive transition-all duration-200 ease-out" onClick={() => stopFollowUp(f.leads?.id ?? "", f.leads?.client_name ?? "client")} title="Stop all follow-ups for this lead">
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>

                {/* Email reminder status row */}
                <EmailStatusRow
                  activeReminder={activeReminder}
                  pausedReminder={pausedReminder}
                  sentReminders={sentReminders}
                  leadReminders={leadReminders}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="p-5 md:p-10 space-y-4 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-bold">Follow-ups</h1>
        {search.filter && (
          <Button variant="outline" size="sm" className="transition-all duration-200 ease-out" asChild>
            <Link to="/follow-ups">Clear filter</Link>
          </Button>
        )}
      </div>
      {isLoading && !data ? (
        <FollowUpsSkeleton />
      ) : (
        <>
          <Section id="overdue" title="Overdue" items={overdue} tone="text-destructive" />
          <Section id="today" title="Today" items={today} tone="text-amber-500" />
          <Section id="upcoming" title="Upcoming" items={upcoming} tone="text-muted-foreground" />
        </>
      )}

      {/* Config dialog */}
      {configLead && (
        <FollowupConfigDialog
          open={configDialogOpen}
          onOpenChange={setConfigDialogOpen}
          leadId={configLead.id}
          clientName={configLead.clientName}
          clientEmail={configLead.email}
          userId={user?.id ?? ""}
          onConfirm={handleEmailConfig}
        />
      )}
    </div>
  );
}


