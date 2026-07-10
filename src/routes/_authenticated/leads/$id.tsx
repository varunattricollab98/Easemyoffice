import { createFileRoute, Link } from "@tanstack/react-router";
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
import { ArrowLeft, Phone, Mail, MessageCircle, Calendar, Plus, Check } from "lucide-react";
import { INTERESTS, INTENT_FLAGS, SERVICES, SOURCES, STAGES, calcScore, deriveInterest, labelFor } from "@/lib/crm";
import { useAuth } from "@/lib/auth";
import { useState } from "react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/leads/$id")({
  head: () => ({ meta: [{ title: "Lead — EaseMyOffice CRM" }] }),
  component: LeadDetailPage,
});

function LeadDetailPage() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const qc = useQueryClient();

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

  const updateLead = useMutation({
    mutationFn: async (patch: any) => {
      const { error } = await supabase.from("leads").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["lead", id] }); toast.success("Updated"); },
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
          {lead.email && <Button variant="outline" size="sm" onClick={() => { window.location.href = `mailto:${lead.email}`; logActivity("email", "Emailed " + lead.email); }}><Mail className="h-4 w-4 mr-1" /> Email</Button>}
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
          </CardContent>
        </Card>
      </div>

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
    </div>
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
