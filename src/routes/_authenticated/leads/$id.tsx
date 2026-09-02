import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, Phone, Mail, MessageCircle, Calendar, Plus, Check, Trash2, Send, Loader2, XCircle, Maximize2, Minimize2, AlarmClock, FileText } from "lucide-react";
import { RichTextEditor, htmlToText } from "@/components/ui/rich-text-editor";
import { cn } from "@/lib/utils";
import { INTERESTS, INTENT_FLAGS, SERVICES, SOURCES, STAGES, calcScore, deriveInterest, labelFor } from "@/lib/crm";
import { useAuth } from "@/lib/auth";
import { handleStageChange, stopAllFollowUps, triggerStageReminder } from "@/lib/stage-reminders";
import { FollowupConfigDialog } from "@/components/followup-config-dialog";
import { SendQuotationDialog } from "@/components/send-quotation-dialog";
import { EmailStatusRow } from "@/components/email-status-row";
import type { EmailConfig } from "@/components/followup-config-dialog";
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/leads/$id")({
  head: () => ({ meta: [{ title: "Lead — EaseMyOffice CRM" }] }),
  component: LeadDetailPage,
});

function LeadDetailPage() {
  const { id } = Route.useParams();
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [emailOpen, setEmailOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [quotationDialogOpen, setQuotationDialogOpen] = useState(false);
  const [reasonStage, setReasonStage] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [followupConfigOpen, setFollowupConfigOpen] = useState(false);
  const [followupPrevStage, setFollowupPrevStage] = useState<string>("");

  const { data: lead, isLoading } = useQuery({
    queryKey: ["lead", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("leads").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: activities } = useQuery({
    queryKey: ["activities", id],
    queryFn: async () => {
      const { data } = await supabase.from("lead_activities").select("*").eq("lead_id", id).order("created_at", { ascending: false }).limit(100);
      return data ?? [];
    },
  });

  const { data: followups } = useQuery({
    queryKey: ["followups", id],
    queryFn: async () => {
      const { data } = await supabase.from("follow_ups").select("*").eq("lead_id", id).order("due_at", { ascending: true });
      return data ?? [];
    },
  });

  // Fetch reminders linked to this lead for unified follow-up + email display
  const { data: leadReminders } = useQuery({
    queryKey: ["lead-reminders", id],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data } = await supabase
        .from("reminders")
        .select("id, lead_id, subject, status, send_at, sent_at, repeat_interval_days, repeat_until, occurrences_sent")
        .eq("lead_id", id)
        .in("status", ["scheduled", "paused", "sent", "failed"]);
      return (data ?? []) as Array<{
        id: string;
        lead_id: string | null;
        subject: string;
        status: string;
        send_at: string;
        sent_at: string | null;
        repeat_interval_days: number;
        repeat_until: string | null;
        occurrences_sent: number;
      }>;
    },
  });

  // Emails actually sent to this lead, recorded by the send-client-email /
  // process-reminders edge functions in public.email_log. email_log is not in
  // the generated Supabase types, so the query is cast to keep tsc happy.
  const { data: emailLog } = useQuery({
    queryKey: ["email-log", id],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("email_log")
        .select("id, subject, sent_at, status")
        .eq("lead_id", id)
        .order("sent_at", { ascending: false })
        .limit(50);
      return (data ?? []) as Array<{
        id: string;
        subject: string | null;
        sent_at: string;
        status: string;
      }>;
    },
  });

  // Derived reminder states for display
  const activeReminder = useMemo(() => (leadReminders ?? []).find((r) => r.status === "scheduled"), [leadReminders]);
  const pausedReminder = useMemo(() => (leadReminders ?? []).find((r) => r.status === "paused"), [leadReminders]);
  const sentReminders = useMemo(() => (leadReminders ?? []).filter((r) => r.status === "sent"), [leadReminders]);
  const hasScheduledReminders = !!activeReminder;

  const { data: assignableUsers } = useQuery({
    queryKey: ["assignable-users"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").order("full_name", { ascending: true });
      return data ?? [];
    },
  });

  const updateLead = useMutation({
    mutationFn: async (patch: any) => {
      const { error } = await supabase.from("leads").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["lead", id] }); toast.success("Updated"); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteLead = useMutation({
    mutationFn: async () => {
      // Follow-ups and timeline activities are removed automatically via the
      // database's ON DELETE CASCADE on their lead_id foreign keys.
      const { error } = await supabase.from("leads").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      toast.success("Lead deleted");
      navigate({ to: "/leads" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const logActivity = async (type: string, title: string, body?: string) => {
    if (!user) return;
    await supabase.from("lead_activities").insert({ lead_id: id, actor_id: user.id, type: type as any, title, body });
    qc.invalidateQueries({ queryKey: ["activities", id] });
  };

  if (isLoading || !lead) return <div className="p-8 text-muted-foreground">Loading…</div>;

  const interestMeta = INTERESTS.find((i) => i.id === lead.interest);
  const stageMeta = STAGES.find((s) => s.id === lead.stage);
  const flags = (lead.intent_flags ?? {}) as Record<string, boolean>;

  const toggleFlag = (key: string) => {
    const next = { ...flags, [key]: !flags[key] };
    const score = calcScore(next);
    const interest = deriveInterest(score);
    updateLead.mutate({ intent_flags: next, score, interest });
  };

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm"><Link to="/leads"><ArrowLeft className="h-4 w-4 mr-1" /> Leads</Link></Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { window.location.href = `tel:${lead.mobile}`; logActivity("call", `Called ${lead.client_name}`, `Phone: ${lead.mobile}`); }}><Phone className="h-4 w-4 mr-1" /> Call</Button>
          <Button variant="outline" size="sm" onClick={() => { window.location.href = `https://wa.me/${lead.mobile.replace(/\D/g,"")}`; logActivity("whatsapp", `WhatsApp to ${lead.client_name}`, `Phone: ${lead.mobile}`); }}><MessageCircle className="h-4 w-4 mr-1" /> WhatsApp</Button>
          {lead.email && <Button variant="outline" size="sm" onClick={() => setEmailOpen(true)}><Mail className="h-4 w-4 mr-1" /> Email</Button>}
          {lead.email && <Button variant="outline" size="sm" onClick={() => setQuotationDialogOpen(true)}><FileText className="h-4 w-4 mr-1" /> Send Quotation</Button>}
          {lead.email && <Button variant="outline" size="sm" onClick={() => setReminderOpen(true)}><AlarmClock className="h-4 w-4 mr-1" /> Schedule Reminder</Button>}
          {isAdmin && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" title="Delete lead (admin only)">
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes <span className="font-medium">{lead.client_name}</span> ({lead.lead_code}) along with its
                    timeline and follow-ups. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => deleteLead.mutate()}
                  >
                    Delete lead
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs text-muted-foreground">{lead.lead_code}</div>
                <CardTitle className="text-2xl">{lead.client_name}</CardTitle>
                <div className="text-sm text-muted-foreground">{lead.company_name}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {interestMeta && <Badge className={interestMeta.className}>{interestMeta.emoji} {interestMeta.label}</Badge>}
                {stageMeta && <Badge variant="secondary"><span className={`h-2 w-2 rounded-full ${stageMeta.color} mr-1.5`} />{stageMeta.label}</Badge>}
                <Badge variant="outline">Score {lead.score}</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-3 text-sm">
            <Info label="Mobile" value={lead.mobile} />
            <Info label="Alt mobile" value={lead.alt_mobile} />
            <Info label="Email" value={lead.email} />
            <Info label="Service" value={labelFor(SERVICES, lead.service_required)} />
            <Info label="Source" value={labelFor(SOURCES, lead.source)} />
            <Info label="Budget" value={lead.budget ? `₹${Number(lead.budget).toLocaleString("en-IN")}` : "—"} />
            <Info label="Location" value={[lead.city, lead.state].filter(Boolean).join(", ") || "—"} />
            <Info label="Next follow-up" value={lead.next_follow_up_at ? format(new Date(lead.next_follow_up_at), "PPp") : "—"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Quick actions</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Stage</Label>
              <Select
                value={lead.stage}
                onValueChange={(v) => {
                  if (v === "lost" || v === "not_interested") {
                    setReasonText(lead.lost_reason ?? "");
                    setReasonStage(v);
                  } else {
                    const stageLabel = STAGES.find((s) => s.id === v)?.label ?? v;
                    const prevStage = lead.stage;
                    const isFollowupTarget = v === "followups";
                    updateLead.mutate({ stage: v }, {
                      onSuccess: async () => {
                        logActivity("stage_change", `Stage changed to ${stageLabel}`);
                        if (user) {
                          if (isFollowupTarget) {
                            // Open the config dialog for email reminders
                            setFollowupPrevStage(prevStage);
                            // Create follow-up task with defaults immediately
                            const result = await handleStageChange({
                              leadId: id,
                              oldStage: prevStage,
                              newStage: v,
                              clientName: lead.client_name,
                              clientEmail: lead.email,
                              userId: user.id,
                            });
                            if (result.followUpsStopped > 0 || result.remindersStopped > 0) {
                              toast.info(`Auto-stopped ${result.followUpsStopped} follow-up(s) and ${result.remindersStopped} reminder(s)`);
                            }
                            if (result.warning) toast.warning(result.warning, { duration: 6000 });
                            setFollowupConfigOpen(true);
                            qc.invalidateQueries();
                          } else {
                            const result = await handleStageChange({
                              leadId: id,
                              oldStage: prevStage,
                              newStage: v,
                              clientName: lead.client_name,
                              clientEmail: lead.email,
                              userId: user.id,
                            });
                            if (result.followUpsStopped > 0 || result.remindersStopped > 0) {
                              toast.info(`Auto-stopped ${result.followUpsStopped} follow-up(s) and ${result.remindersStopped} reminder(s)`);
                            }
                            if (result.warning) toast.warning(result.warning, { duration: 6000 });
                            qc.invalidateQueries();
                          }
                        }
                      },
                    });
                  }
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Interest</Label>
              <Select value={lead.interest} onValueChange={(v) => updateLead.mutate({ interest: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INTERESTS.map((i) => <SelectItem key={i.id} value={i.id}>{i.emoji} {i.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Assigned to</Label>
              <Select
                value={lead.assigned_to ?? "unassigned"}
                onValueChange={(v) => updateLead.mutate({ assigned_to: v === "unassigned" ? null : v })}
              >
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {(assignableUsers ?? []).map((u: any) => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name || u.email || "User"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>

      <ExtendedDetails lead={lead} />

      <Tabs defaultValue="timeline">
        <TabsList>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="followups">Follow-ups</TabsTrigger>
          <TabsTrigger value="intent">Intent & Score</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="space-y-3">
          <EmailLogSummary emails={emailLog ?? []} />
          <NoteComposer onSubmit={(text) => logActivity("note", "Note added", text)} />
          <Card><CardContent className="p-4 space-y-3">
            {(activities ?? []).length === 0 && <div className="text-sm text-muted-foreground">No activity yet.</div>}
            {activities?.map((a: any) => (
              <div key={a.id} className="flex gap-3">
                <div className="size-2 rounded-full bg-primary mt-2" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{a.title}</div>
                  {a.body && <div className="text-sm text-muted-foreground whitespace-pre-wrap">{a.body}</div>}
                  <div className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(a.created_at), { addSuffix: true })} · {a.type}</div>
                </div>
              </div>
            ))}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="followups" className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <FollowUpComposer
              leadId={id}
              onFollowUpCreated={() => {
                // If lead has email and is in followup stage, open email config dialog
                const isFollowupStage = lead.stage === "followups";
                if (isFollowupStage && lead.email) {
                  setFollowupConfigOpen(true);
                }
              }}
            />
            <div className="flex items-center gap-2 shrink-0">
              {(lead.stage === "followups") && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setFollowupConfigOpen(true)}
                >
                  <Mail className="h-4 w-4 mr-1" /> {hasScheduledReminders ? "Reconfigure Emails" : "Add Email Sequence"}
                </Button>
              )}
              {(followups ?? []).some((f: any) => f.status === "pending") && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive shrink-0"
                  onClick={async () => {
                    const { stoppedFollowUps, stoppedReminders } = await stopAllFollowUps(id);
                    qc.invalidateQueries();
                    logActivity("followup", "Stopped all follow-ups", `Cancelled ${stoppedFollowUps} follow-up(s) and ${stoppedReminders} email reminder(s)`);
                    toast.success("All follow-ups stopped");
                  }}
                >
                  <XCircle className="h-4 w-4 mr-1" /> {hasScheduledReminders ? "Stop All (Task + Emails)" : "Stop Follow-ups"}
                </Button>
              )}
            </div>
          </div>
          <Card><CardContent className="p-4 space-y-2">
            {(followups ?? []).length === 0 && <div className="text-sm text-muted-foreground">No follow-ups scheduled.</div>}
            {followups?.map((f: any) => {
              const overdue = f.status === "pending" && new Date(f.due_at) < new Date();
              const isPending = f.status === "pending";
              return (
                <div key={f.id} className="flex flex-col gap-2 p-2.5 rounded-md border">
                  {/* Main task row */}
                  <div className="flex items-center gap-3">
                    <Calendar className={`h-4 w-4 ${overdue ? "text-destructive" : "text-muted-foreground"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{f.action}</div>
                      <div className="text-xs text-muted-foreground">{format(new Date(f.due_at), "PPp")} · {f.status}</div>
                    </div>
                    {f.status === "pending" && (
                      <Button size="sm" variant="outline" onClick={async () => {
                        await supabase.from("follow_ups").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", f.id);
                        logActivity("followup", "Follow-up completed", f.action);
                        qc.invalidateQueries();
                        toast.success("Marked done");
                      }}><Check className="h-4 w-4" /></Button>
                    )}
                  </div>
                  {/* Email reminder status row - only shown for pending follow-ups */}
                  {isPending && (
                    <EmailStatusRow
                      activeReminder={activeReminder}
                      pausedReminder={pausedReminder}
                      sentReminders={sentReminders}
                      leadReminders={leadReminders ?? []}
                    />
                  )}
                </div>
              );
            })}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="intent">
          <Card><CardContent className="p-4 grid sm:grid-cols-2 gap-3">
            {INTENT_FLAGS.map((f) => (
              <label key={f.key} className="flex items-center gap-3 rounded-md border p-3 hover:bg-accent/40 cursor-pointer">
                <Checkbox checked={!!flags[f.key]} onCheckedChange={() => toggleFlag(f.key)} />
                <div className="flex-1">
                  <div className="text-sm font-medium">{f.label}</div>
                  <div className="text-xs text-muted-foreground">+{f.weight} score</div>
                </div>
              </label>
            ))}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="notes">
          <Card><CardContent className="p-4 space-y-3">
            <Textarea defaultValue={lead.notes ?? ""} rows={6} onBlur={(e) => updateLead.mutate({ notes: e.currentTarget.value })} placeholder="Permanent notes about this lead…" />
            <div className="text-xs text-muted-foreground">Auto-saves on blur.</div>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {lead.email && (
        <EmailComposeDialog
          lead={lead}
          open={emailOpen}
          onOpenChange={setEmailOpen}
          onSent={(subject) => logActivity("email", `Emailed ${lead.email}`, subject)}
        />
      )}

      {lead.email && (
        <ScheduleReminderDialog
          lead={lead}
          open={reminderOpen}
          onOpenChange={setReminderOpen}
          userId={user?.id ?? ""}
          onScheduled={(subject) => logActivity("reminder", `Scheduled reminder for ${lead.email}`, subject)}
        />
      )}

      {lead.email && (
        <SendQuotationDialog
          open={quotationDialogOpen}
          onOpenChange={setQuotationDialogOpen}
          clientName={lead.client_name || ""}
          clientEmail={lead.email}
          defaultState={lead.state || ""}
          defaultCity={lead.city || ""}
          leadId={lead.id}
          onSent={(subject) => logActivity("email", `Sent quotation to ${lead.email}`, subject)}
        />
      )}

      <Dialog open={!!reasonStage} onOpenChange={(o) => { if (!o) setReasonStage(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reason required</DialogTitle>
            <DialogDescription>
              Please note why this lead is marked{" "}
              <span className="font-medium text-foreground">{reasonStage === "lost" ? "Lost" : "Not interested"}</span>. This is mandatory.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            rows={3}
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            placeholder="e.g. Chose a competitor · budget too high · wrong fit · no response…"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReasonStage(null)}>Cancel</Button>
            <Button
              disabled={!reasonText.trim() || updateLead.isPending}
              onClick={() => {
                const stage = reasonStage!;
                const prevStage2 = lead.stage;
                updateLead.mutate({ stage, lost_reason: reasonText.trim() }, {
                  onSuccess: async () => {
                    if (user) {
                      const result = await handleStageChange({
                        leadId: id,
                        oldStage: prevStage2,
                        newStage: stage,
                        clientName: lead.client_name,
                        clientEmail: lead.email,
                        userId: user.id,
                      });
                      if (result.followUpsStopped > 0 || result.remindersStopped > 0) {
                        toast.info(`Auto-stopped ${result.followUpsStopped} follow-up(s) and ${result.remindersStopped} reminder(s)`);
                      }
                      qc.invalidateQueries();
                    }
                  },
                });
                logActivity("stage_change", `Marked ${stage === "lost" ? "Lost" : "Not interested"}`, reasonText.trim());
                setReasonStage(null);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {lead && (
        <FollowupConfigDialog
          open={followupConfigOpen}
          onOpenChange={setFollowupConfigOpen}
          leadId={id}
          clientName={lead.client_name}
          clientEmail={lead.email}
          userId={user?.id ?? ""}
          onConfirm={async (config: EmailConfig) => {
            // User chose custom settings - triggerStageReminder handles cancellation internally
            if (user && lead.email) {
              // Invalidate lead query to get fresh data before calling triggerStageReminder
              await qc.invalidateQueries({ queryKey: ["lead", id] });
              const created = await triggerStageReminder({
                leadId: id,
                newStage: lead.stage,
                clientName: lead.client_name,
                clientEmail: lead.email,
                userId: user.id,
                emailConfig: {
                  snippetId: config.snippetId,
                  intervalDays: config.intervalDays,
                  stopDays: config.stopDays,
                  sendAt: config.sendAt,
                },
              });
              if (created) {
                toast.success("Email reminders configured successfully");
              } else {
                toast.error("Could not create email reminder. The lead may have moved out of the followups stage or the trigger is disabled.");
              }
              qc.invalidateQueries();
            }
          }}
          onCancel={() => {
            // User cancelled - defaults already applied
          }}
        />
      )}
    </div>
  );
}

const EMAIL_TEMPLATES = [
  { id: "quotation", label: "Quotation" },
  { id: "welcome", label: "Welcome / Intro" },
  { id: "followup", label: "Follow-up" },
  { id: "documents", label: "Documents required" },
  { id: "payment", label: "Payment reminder" },
  { id: "thankyou", label: "Thank you" },
  { id: "custom", label: "Blank (write my own)" },
] as const;

function buildTemplate(id: string, lead: any, senderName: string) {
  const name = lead.client_name || "there";
  const service = labelFor(SERVICES, lead.service_required);
  const sign = `\n\nWarm regards,\n${senderName || "Team EaseMyOffice"}\nEaseMyOffice`;
  switch (id) {
    case "quotation":
      return {
        subject: `Quotation for ${service} — EaseMyOffice`,
        body: `Dear ${name},\n\nThank you for your interest in our ${service} service. As discussed, here is our quotation:\n\n• Service: ${service}\n• Price: [enter amount]\n• Inclusions: [enter what's included]\n• Validity: 15 days\n\nPlease let me know if you have any questions — we'd be glad to help you get started.${sign}`,
      };
    case "welcome":
      return {
        subject: `Welcome to EaseMyOffice, ${name}!`,
        body: `Dear ${name},\n\nThank you for choosing EaseMyOffice for your ${service} requirement. We're excited to work with you.\n\nI'll be your point of contact throughout the process. Feel free to reach out any time with questions.${sign}`,
      };
    case "followup":
      return {
        subject: `Following up — ${service}`,
        body: `Dear ${name},\n\nI hope you're doing well. I wanted to follow up regarding your ${service} enquiry. Please let me know if you'd like to move ahead or if there's anything I can clarify.\n\nHappy to help however I can.${sign}`,
      };
    case "documents":
      return {
        subject: `Documents required for ${service}`,
        body: `Dear ${name},\n\nTo proceed with your ${service}, please share the following documents:\n\n• [Document 1]\n• [Document 2]\n• [Document 3]\n\nYou can simply reply to this email with the files attached. Once received, we'll begin processing right away.${sign}`,
      };
    case "payment":
      return {
        subject: `Payment details for ${service}`,
        body: `Dear ${name},\n\nThank you for confirming your ${service} order. Please find the payment details below:\n\n• Amount: [enter amount]\n• Payment link / account: [enter details]\n\nOnce the payment is completed, kindly share the confirmation so we can proceed.${sign}`,
      };
    case "thankyou":
      return {
        subject: `Thank you, ${name}`,
        body: `Dear ${name},\n\nThank you for your time today. It was a pleasure speaking with you about your ${service} requirement. Please don't hesitate to reach out if you need anything further.${sign}`,
      };
    default:
      return { subject: "", body: `Dear ${name},\n\n${sign}` };
  }
}

const COMPOSE_EXPANDED_KEY = "lead:email-compose:expanded";

function textToHtml(text: string) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e293b;line-height:1.6;white-space:normal">${esc.replace(/\n/g, "<br>")}</div>`;
}

type EmailLogEntry = { id: string; subject: string | null; sent_at: string; status: string };

// Read-only summary of emails actually delivered to this lead (public.email_log).
// Mirrors the Badge + Mail-icon styling of EmailStatusRow for visual consistency.
function EmailLogSummary({ emails }: { emails: EmailLogEntry[] }) {
  const sent = emails.filter((e) => e.status === "sent");
  if (sent.length === 0) return null;
  const last = sent[0]; // query is ordered sent_at DESC
  const recent = sent.slice(0, 5);
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="secondary" className="gap-1 text-xs font-normal">
            <Mail className="h-3 w-3 text-blue-500" />
            {sent.length} email{sent.length === 1 ? "" : "s"} sent
          </Badge>
          <span className="text-muted-foreground">
            &middot; last sent {formatDistanceToNow(new Date(last.sent_at), { addSuffix: true })}
          </span>
        </div>
        <ul className="space-y-1 pl-1">
          {recent.map((e) => (
            <li key={e.id} className="flex items-center gap-2 text-xs text-muted-foreground">
              <Mail className="h-3 w-3 shrink-0" />
              <span className="truncate" title={e.subject ?? undefined}>{e.subject || "(no subject)"}</span>
              <span className="shrink-0">&middot; {format(new Date(e.sent_at), "dd MMM")}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function EmailComposeDialog({
  lead, open, onOpenChange, onSent,
}: {
  lead: any; open: boolean; onOpenChange: (v: boolean) => void; onSent: (subject: string) => void;
}) {
  const { profile, user } = useAuth();
  const senderName = profile?.full_name ?? "";
  const [templateId, setTemplateId] = useState<string>("quotation");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  // Remembered across sessions: anyone who prefers composing full-screen almost
  // certainly wants it that way every time.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    try {
      setExpanded(localStorage.getItem(COMPOSE_EXPANDED_KEY) === "1");
    } catch {
      /* private mode / storage disabled — just use the default */
    }
  }, []);
  const toggleExpanded = () => {
    setExpanded((v) => {
      const next = !v;
      try {
        localStorage.setItem(COMPOSE_EXPANDED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // Load the selected template's content into the subject/body fields.
  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = buildTemplate(id, lead, senderName);
    setSubject(t.subject);
    setBody(t.body);
  };

  // Pre-fill with the Quotation template each time the dialog is opened.
  useEffect(() => {
    if (open) {
      const t = buildTemplate("quotation", lead, senderName);
      setTemplateId("quotation");
      setSubject(t.subject);
      setBody(t.body);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const send = async () => {
    if (!subject.trim()) return toast.error("Please add a subject");
    if (!body.trim()) return toast.error("Please write the email body");
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-client-email", {
        body: {
          to: lead.email,
          subject: subject.trim(),
          html: textToHtml(body),
          text: body,
          replyTo: user?.email,
          // Link the send in email_log (the edge function writes the row).
          lead_id: lead.id,
          created_by: user?.id,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || "Failed to send email");
      toast.success(`Email sent to ${lead.email}`);
      onSent(subject.trim());
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Could not send email");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* DialogContent is a `grid` by default, which can't give the textarea a
          growable track. Switching to a fixed-height flex column lets the header
          and footer stay put while the message field takes whatever is left —
          that's what makes the expanded mode actually usable. */}
      <DialogContent
        className={cn(
          "flex flex-col gap-0 p-0",
          expanded
            ? "h-[94vh] w-[96vw] max-w-6xl"
            : "max-h-[88vh] w-[calc(100vw-2rem)] sm:max-w-2xl",
        )}
      >
        <DialogHeader className="shrink-0 space-y-1.5 border-b px-6 py-4 pr-24">
          <DialogTitle>Send email to client</DialogTitle>
          <DialogDescription>To: {lead.email}</DialogDescription>
        </DialogHeader>

        {/* Sits left of DialogContent's own close button, which is at right-4. */}
        <button
          type="button"
          onClick={toggleExpanded}
          className="absolute right-12 top-4 rounded-sm p-0.5 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-pressed={expanded}
          aria-label={expanded ? "Exit full screen" : "Expand to full screen"}
          title={expanded ? "Exit full screen" : "Expand to full screen"}
        >
          {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>

        {/* min-h-0 is what allows this flex child to shrink instead of forcing the
            dialog taller than its own max height. */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <Label className="text-xs">Template</Label>
              <Select value={templateId} onValueChange={applyTemplate}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EMAIL_TEMPLATES.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject" />
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col space-y-1.5">
            <Label className="text-xs">Message</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message…"
              className={cn(
                "resize-none leading-relaxed",
                // Grow to fill when expanded; otherwise a fixed comfortable
                // height that still shows the sign-off without scrolling.
                expanded ? "min-h-0 flex-1" : "h-[42vh] min-h-[260px]",
              )}
            />
          </div>
        </div>

        <DialogFooter className="shrink-0 items-center gap-2 border-t px-6 py-4 sm:justify-between">
          <span className="text-xs text-muted-foreground sm:mr-auto">
            Replies from the client will go to {user?.email || "your email"}.
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
            <Button onClick={send} disabled={sending}>
              {sending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Sending…</> : <><Send className="h-4 w-4 mr-1" /> Send email</>}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value || "—"}</div>
    </div>
  );
}

function ExtendedDetails({ lead }: { lead: any }) {
  const revenue = lead.revenue != null && lead.revenue !== "" ? `₹${Number(lead.revenue).toLocaleString("en-IN")}` : null;
  const fields: [string, any][] = [
    ["Lead ID", lead.external_lead_id],
    ["Date Received", lead.received_date],
    ["Assigned To", lead.assigned_agent],
    ["Lead Status", lead.lead_status],
    ["Lead Outcome", lead.lead_outcome],
    ["Call Outcome", lead.call_outcome],
    ["Lost Reason", lead.lost_reason],
    ["Converted Date", lead.converted_date],
    ["Revenue", revenue],
    ["Last Follow-up", lead.last_follow_up],
    ["Next Follow-up", lead.next_follow_up],
    ["Follow-up 3", lead.follow_up_3],
    ["Latest Remark", lead.latest_remark],
    ["Remark Updated On", lead.remark_updated_on],
    ["Last Synced", lead.last_synced],
  ];
  const shown = fields.filter(([, v]) => v != null && String(v).trim() !== "");
  if (shown.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Sales & pipeline details</CardTitle></CardHeader>
      <CardContent className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
        {shown.map(([label, value]) => (
          <div key={label}>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="font-medium whitespace-pre-wrap break-words">{String(value)}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function NoteComposer({ onSubmit }: { onSubmit: (text: string) => Promise<void> | void }) {
  const [val, setVal] = useState("");
  return (
    <Card><CardContent className="p-3 flex gap-2">
      <Input placeholder="Quick note…" value={val} onChange={(e) => setVal(e.target.value)} />
      <Button onClick={async () => { if (!val.trim()) return; await onSubmit(val.trim()); setVal(""); }}>Add</Button>
    </CardContent></Card>
  );
}

function FollowUpComposer({ leadId, onFollowUpCreated }: { leadId: string; onFollowUpCreated?: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [action, setAction] = useState("");
  const [due, setDue] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setMinutes(0); d.setSeconds(0);
    return d.toISOString().slice(0, 16);
  });

  const createFollowUp = async (openEmailConfig: boolean) => {
    if (!action.trim()) return toast.error("Please enter an action first (e.g. Call to confirm KYC)");
    if (!user) return toast.error("You must be signed in to schedule a follow-up");
    if (!due) return toast.error("Please pick a date and time");
    const { error } = await supabase.from("follow_ups").insert({ lead_id: leadId, owner_id: user.id, action: action.trim(), due_at: new Date(due).toISOString() });
    if (error) return toast.error(error.message);
    // Log the follow-up creation as an activity on the lead's timeline
    await supabase.from("lead_activities").insert({ lead_id: leadId, actor_id: user.id, type: "followup" as any, title: "Follow-up scheduled", body: `${action.trim()} — due ${new Date(due).toLocaleDateString()}` });
    setAction("");
    qc.invalidateQueries();
    toast.success("Follow-up scheduled");
    // Open email config dialog if requested
    if (openEmailConfig) onFollowUpCreated?.();
  };

  return (
    <Card><CardContent className="p-3 space-y-2">
      <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-center">
        <Input placeholder="Next action (e.g. Call to confirm KYC)" value={action} onChange={(e) => setAction(e.target.value)} />
        <DateTimePicker value={due} onChange={setDue} />
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => createFollowUp(false)}>
          <Plus className="h-4 w-4 mr-1" /> Schedule Task Only
        </Button>
        <Button size="sm" onClick={() => createFollowUp(true)}>
          <Mail className="h-4 w-4 mr-1" /> Schedule + Email Client
        </Button>
      </div>
    </CardContent></Card>
  );
}

// ── Schedule Reminder Dialog ──

const SCHEDULE_REMINDER_TEMPLATES = [
  { id: "quotation", label: "Quotation" },
  { id: "welcome", label: "Welcome / Intro" },
  { id: "followup", label: "Follow-up" },
  { id: "documents", label: "Documents required" },
  { id: "payment", label: "Payment reminder" },
  { id: "thankyou", label: "Thank you" },
  { id: "custom", label: "Blank (write my own)" },
] as const;

function buildScheduleTemplate(id: string, clientName: string) {
  const name = clientName.trim() || "there";
  const sign = `<br><br>Warm regards,<br>Team EaseMyOffice<br><span style="color:#6b7280;font-size:13px">EaseMyOffice</span>`;
  const wrap = (html: string) =>
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e293b;line-height:1.6">${html}</div>`;

  switch (id) {
    case "quotation":
      return { subject: "Quotation for your service - EaseMyOffice", body_html: wrap(`Dear ${name},<br><br>Thank you for your interest in our services. As discussed, here is our quotation:<br><br><ul style="margin:8px 0;padding-left:20px"><li><b>Service:</b> [enter service]</li><li><b>Price:</b> [enter amount]</li><li><b>Inclusions:</b> [enter details]</li><li><b>Validity:</b> 15 days</li></ul><br>Please let me know if you have any questions.${sign}`) };
    case "welcome":
      return { subject: `Welcome to EaseMyOffice, ${name}!`, body_html: wrap(`Dear ${name},<br><br>Thank you for choosing EaseMyOffice. We are excited to work with you.<br><br>I will be your point of contact throughout the process. Feel free to reach out any time with questions.${sign}`) };
    case "followup":
      return { subject: "Following up - EaseMyOffice", body_html: wrap(`Dear ${name},<br><br>I hope you are doing well. I wanted to follow up regarding your recent enquiry. Please let me know if you would like to move ahead or if there is anything I can clarify.<br><br>Happy to help however I can.${sign}`) };
    case "documents":
      return { subject: "Documents required - EaseMyOffice", body_html: wrap(`Dear ${name},<br><br>To proceed with your request, please share the following documents:<br><br><ul style="margin:8px 0;padding-left:20px"><li>[Document 1]</li><li>[Document 2]</li><li>[Document 3]</li></ul><br>You can simply reply to this email with the files attached.${sign}`) };
    case "payment":
      return { subject: "Payment reminder - EaseMyOffice", body_html: wrap(`Dear ${name},<br><br>This is a friendly reminder regarding the pending payment. Please find the details below:<br><br><ul style="margin:8px 0;padding-left:20px"><li><b>Amount:</b> [enter amount]</li><li><b>Payment link / account:</b> [enter details]</li></ul><br>Once the payment is completed, kindly share the confirmation so we can proceed.${sign}`) };
    case "thankyou":
      return { subject: `Thank you, ${name}`, body_html: wrap(`Dear ${name},<br><br>Thank you for your time. It was a pleasure speaking with you. Please do not hesitate to reach out if you need anything further.${sign}`) };
    default:
      return { subject: "", body_html: wrap(`Dear ${name},<br><br>${sign}`) };
  }
}

function defaultReminderSendAt() {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function ScheduleReminderDialog({
  lead, open, onOpenChange, userId, onScheduled,
}: {
  lead: any; open: boolean; onOpenChange: (v: boolean) => void; userId: string; onScheduled: (subject: string) => void;
}) {
  const { roles } = useAuth();
  const qc = useQueryClient();
  const isRenewalUser = roles.includes("renewals") && !roles.includes("sales") && !roles.includes("bd");
  const reminderFromEmail = isRenewalUser ? "EaseMyOffice Renewals <renewals@easemyoffice.in>" : null;

  const [templateId, setTemplateId] = useState<string>("followup");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [sendAt, setSendAt] = useState(defaultReminderSendAt);
  const [repeat, setRepeat] = useState(false);
  const [intervalDays, setIntervalDays] = useState("7");
  const [stopDays, setStopDays] = useState("30");
  const [submitting, setSubmitting] = useState(false);

  // Expand toggle — remembered so "full screen" preference sticks.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    try { setExpanded(localStorage.getItem("lead:schedule-reminder:expanded") === "1"); } catch { /* */ }
  }, []);
  const toggleExpanded = () => {
    setExpanded((v) => {
      const next = !v;
      try { localStorage.setItem("lead:schedule-reminder:expanded", next ? "1" : "0"); } catch { /* */ }
      return next;
    });
  };

  // Apply template when selected
  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = buildScheduleTemplate(id, lead.client_name);
    setSubject(t.subject);
    setMessage(t.body_html);
    setEditorKey((k) => k + 1);
  };

  // Pre-fill when dialog opens
  useEffect(() => {
    if (open) {
      const t = buildScheduleTemplate("followup", lead.client_name);
      setTemplateId("followup");
      setSubject(t.subject);
      setMessage(t.body_html);
      setEditorKey((k) => k + 1);
      setSendAt(defaultReminderSendAt());
      setRepeat(false);
      setIntervalDays("7");
      setStopDays("30");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSchedule = async () => {
    if (!subject.trim()) return toast.error("Subject is required.");
    if (!htmlToText(message).trim()) return toast.error("Message is required.");
    if (!sendAt) return toast.error("Pick a date & time to send.");

    setSubmitting(true);
    try {
      const start = new Date(sendAt);
      let interval = 0;
      let until: string | null = null;
      if (repeat) {
        interval = Math.max(1, parseInt(intervalDays, 10) || 7);
        const stopD = Math.max(1, parseInt(stopDays, 10) || 30);
        until = new Date(start.getTime() + stopD * 86400000).toISOString();
      }

      const { error } = await supabase.from("reminders").insert({
        to_email: lead.email.trim(),
        client_name: lead.client_name?.trim() || "",
        subject: subject.trim(),
        message,
        is_html: true,
        send_at: start.toISOString(),
        status: "scheduled",
        repeat_interval_days: interval,
        repeat_until: until,
        created_by: userId,
        assigned_to: userId,
        from_email: reminderFromEmail,
        lead_id: lead.id,
      });
      if (error) throw new Error(error.message);

      toast.success("Reminder scheduled");
      onScheduled(subject.trim());
      qc.invalidateQueries({ queryKey: ["reminders"] });
      qc.invalidateQueries({ queryKey: ["lead-reminders", lead.id] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Could not schedule reminder");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 p-0",
          expanded
            ? "h-[94vh] w-[96vw] max-w-6xl"
            : "max-h-[90vh] w-[calc(100vw-2rem)] sm:max-w-2xl",
        )}
      >
        <DialogHeader className="shrink-0 space-y-1.5 border-b px-6 py-4 pr-24">
          <DialogTitle className="flex items-center gap-2">
            <AlarmClock className="h-5 w-5" /> Schedule Reminder
          </DialogTitle>
          <DialogDescription>
            Schedule an email reminder to {lead.email}
          </DialogDescription>
        </DialogHeader>

        {/* Expand toggle — next to the close X */}
        <button
          type="button"
          onClick={toggleExpanded}
          className="absolute right-12 top-4 rounded-sm p-0.5 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-pressed={expanded}
          aria-label={expanded ? "Exit full screen" : "Expand to full screen"}
          title={expanded ? "Exit full screen" : "Expand to full screen"}
        >
          {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4 space-y-4">
          {/* Template selector */}
          <div className="space-y-1.5">
            <Label className="text-xs">Template</Label>
            <Select value={templateId} onValueChange={applyTemplate}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCHEDULE_REMINDER_TEMPLATES.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Subject */}
          <div className="space-y-1.5">
            <Label className="text-xs">Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject" />
          </div>

          {/* Message body */}
          <div className={cn("space-y-1.5", expanded && "flex min-h-0 flex-1 flex-col")}>
            <Label className="text-xs">Message</Label>
            <RichTextEditor key={editorKey} html={message} onChange={setMessage} minHeight={expanded ? 400 : 200} />
          </div>

          {/* Send at */}
          <div className="space-y-1.5">
            <Label className="text-xs">Send at</Label>
            <DateTimePicker value={sendAt} onChange={setSendAt} />
          </div>

          {/* Repeat config */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={repeat} onCheckedChange={(v) => setRepeat(!!v)} />
              <span className="text-sm">Repeat this reminder</span>
            </label>
            {repeat && (
              <div className="space-y-3 pl-6">
                <div className="space-y-1.5">
                  <Label className="text-xs">Frequency</Label>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { label: "Every day", value: "1" },
                      { label: "Alternate day", value: "2" },
                      { label: "Weekly", value: "7" },
                    ] as const).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setIntervalDays(opt.value)}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                          intervalDays === opt.value
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-card hover:bg-accent hover:text-accent-foreground",
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5 max-w-[200px]">
                  <Label className="text-xs">Stop after (days)</Label>
                  <Input type="number" min="1" placeholder="e.g. 30" value={stopDays} onChange={(e) => setStopDays(e.target.value)} />
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSchedule} disabled={submitting}>
            {submitting ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Scheduling...</> : <><AlarmClock className="h-4 w-4 mr-1" /> Schedule Reminder</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
