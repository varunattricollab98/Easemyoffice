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
import { ArrowLeft, Phone, Mail, MessageCircle, Calendar, Plus, Check, Trash2, Send, Loader2 } from "lucide-react";
import { INTERESTS, INTENT_FLAGS, SERVICES, SOURCES, STAGES, calcScore, deriveInterest, labelFor } from "@/lib/crm";
import { useAuth } from "@/lib/auth";
import { useState, useEffect } from "react";
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
          <Button variant="outline" size="sm" onClick={() => { window.location.href = `tel:${lead.mobile}`; logActivity("call", "Called " + lead.client_name); }}><Phone className="h-4 w-4 mr-1" /> Call</Button>
          <Button variant="outline" size="sm" onClick={() => { window.location.href = `https://wa.me/${lead.mobile.replace(/\D/g,"")}`; logActivity("whatsapp", "Opened WhatsApp"); }}><MessageCircle className="h-4 w-4 mr-1" /> WhatsApp</Button>
          {lead.email && <Button variant="outline" size="sm" onClick={() => setEmailOpen(true)}><Mail className="h-4 w-4 mr-1" /> Email</Button>}
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
              <Select value={lead.stage} onValueChange={(v) => updateLead.mutate({ stage: v })}>
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
          <FollowUpComposer leadId={id} />
          <Card><CardContent className="p-4 space-y-2">
            {(followups ?? []).length === 0 && <div className="text-sm text-muted-foreground">No follow-ups scheduled.</div>}
            {followups?.map((f: any) => {
              const overdue = f.status === "pending" && new Date(f.due_at) < new Date();
              return (
                <div key={f.id} className="flex items-center gap-3 p-2.5 rounded-md border">
                  <Calendar className={`h-4 w-4 ${overdue ? "text-destructive" : "text-muted-foreground"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{f.action}</div>
                    <div className="text-xs text-muted-foreground">{format(new Date(f.due_at), "PPp")} · {f.status}</div>
                  </div>
                  {f.status === "pending" && (
                    <Button size="sm" variant="outline" onClick={async () => {
                      await supabase.from("follow_ups").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", f.id);
                      qc.invalidateQueries();
                      toast.success("Marked done");
                    }}><Check className="h-4 w-4" /></Button>
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

function textToHtml(text: string) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e293b;line-height:1.6;white-space:normal">${esc.replace(/\n/g, "<br>")}</div>`;
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send email to client</DialogTitle>
          <DialogDescription>To: {lead.email}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
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
          <div className="space-y-1.5">
            <Label className="text-xs">Message</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} placeholder="Write your message…" />
            <div className="text-xs text-muted-foreground">Replies from the client will go to {user?.email || "your email"}.</div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
          <Button onClick={send} disabled={sending}>
            {sending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Sending…</> : <><Send className="h-4 w-4 mr-1" /> Send email</>}
          </Button>
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

function FollowUpComposer({ leadId }: { leadId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [action, setAction] = useState("");
  const [due, setDue] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setMinutes(0); d.setSeconds(0);
    return d.toISOString().slice(0, 16);
  });
  return (
    <Card><CardContent className="p-3 grid sm:grid-cols-[1fr_220px_auto] gap-2">
      <Input placeholder="Next action (e.g. Call to confirm KYC)" value={action} onChange={(e) => setAction(e.target.value)} />
      <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
      <Button onClick={async () => {
        if (!action.trim()) return toast.error("Please enter an action first (e.g. Call to confirm KYC)");
        if (!user) return toast.error("You must be signed in to schedule a follow-up");
        if (!due) return toast.error("Please pick a date and time");
        const { error } = await supabase.from("follow_ups").insert({ lead_id: leadId, owner_id: user.id, action: action.trim(), due_at: new Date(due).toISOString() });
        if (error) return toast.error(error.message);
        setAction("");
        qc.invalidateQueries();
        toast.success("Follow-up scheduled");
      }}><Plus className="h-4 w-4 mr-1" /> Schedule</Button>
    </CardContent></Card>
  );
}
