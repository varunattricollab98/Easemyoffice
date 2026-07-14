import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { AlarmClock, Plus, Send, X, Mail } from "lucide-react";

export const Route = createFileRoute("/_authenticated/reminders")({
  head: () => ({ meta: [{ title: "Reminders — EaseMyOffice CRM" }] }),
  component: RemindersPage,
});

type Reminder = {
  id: string;
  client_name: string | null;
  to_email: string;
  subject: string;
  message: string;
  send_at: string;
  status: "scheduled" | "sent" | "cancelled" | "failed";
  sent_at: string | null;
  error: string | null;
  created_by: string | null;
};

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const fmt = (d: string) => { try { return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return d; } };

// value for <input type="datetime-local"> defaulting to +1 day from now
function defaultSendAt() {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function StatusBadge({ s }: { s: Reminder["status"] }) {
  const map: Record<Reminder["status"], string> = {
    scheduled: "bg-blue-100 text-blue-800 border-blue-300",
    sent: "bg-emerald-100 text-emerald-800 border-emerald-300",
    cancelled: "bg-slate-100 text-slate-700 border-slate-300",
    failed: "bg-rose-100 text-rose-800 border-rose-300",
  };
  return <Badge variant="outline" className={`${map[s]} capitalize`}>{s}</Badge>;
}

function RemindersPage() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"upcoming" | "all">("upcoming");

  const [form, setForm] = useState({ to_email: "", client_name: "", subject: "", message: "", send_at: defaultSendAt() });
  const set = (k: keyof typeof form, v: string) => setForm((s) => ({ ...s, [k]: v }));

  const { data: reminders = [], isLoading } = useQuery({
    queryKey: ["reminders"],
    queryFn: async () => {
      const { data, error } = await supabase.from("reminders").select("*").order("send_at", { ascending: true }).limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Reminder[];
    },
  });

  const shown = useMemo(
    () => (tab === "upcoming" ? reminders.filter((r) => r.status === "scheduled") : reminders),
    [reminders, tab],
  );

  const create = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      if (!isEmail(form.to_email)) throw new Error("Enter a valid client email address.");
      if (!form.subject.trim()) throw new Error("Subject is required.");
      if (!form.message.trim()) throw new Error("Message is required.");
      if (!form.send_at) throw new Error("Pick a date & time to send.");
      const { error } = await supabase.from("reminders").insert({
        to_email: form.to_email.trim(),
        client_name: form.client_name.trim(),
        subject: form.subject.trim(),
        message: form.message,
        send_at: new Date(form.send_at).toISOString(),
        status: "scheduled",
        created_by: user.id,
        assigned_to: user.id,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Reminder scheduled");
      setOpen(false);
      setForm({ to_email: "", client_name: "", subject: "", message: "", send_at: defaultSendAt() });
      qc.invalidateQueries({ queryKey: ["reminders"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("reminders").update({ status: "cancelled" }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Reminder cancelled"); qc.invalidateQueries({ queryKey: ["reminders"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Manual "Send now" — uses the existing send-client-email function, then marks it sent.
  const sendNow = useMutation({
    mutationFn: async (r: Reminder) => {
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#0f172a">${r.message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</div>`;
      const { data, error } = await supabase.functions.invoke("send-client-email", { body: { to: r.to_email, subject: r.subject, html, text: r.message } });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || "Could not send email");
      const { error: uErr } = await supabase.from("reminders").update({ status: "sent", sent_at: new Date().toISOString(), error: null }).eq("id", r.id);
      if (uErr) throw new Error(uErr.message);
    },
    onSuccess: () => { toast.success("Reminder sent"); qc.invalidateQueries({ queryKey: ["reminders"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2"><AlarmClock className="h-6 w-6 text-primary" /> Reminders</h1>
          <p className="text-sm text-muted-foreground">Schedule automatic email reminders to clients. They send on their own at the chosen time.</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> Schedule reminder</Button>
      </div>

      <Card>
        <CardContent className="p-3 flex items-center gap-2">
          {(["upcoming", "all"] as const).map((t) => (
            <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)} className="capitalize">
              {t} {t === "upcoming" && <span className="ml-1 opacity-70">({reminders.filter((r) => r.status === "scheduled").length})</span>}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Send at</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
            {!isLoading && shown.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No reminders {tab === "upcoming" ? "scheduled" : "yet"}. Click "Schedule reminder" to add one.</TableCell></TableRow>}
            {shown.map((r) => {
              const canManage = isAdmin || r.created_by === user?.id;
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">{r.client_name || r.to_email}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="h-3 w-3" />{r.to_email}</div>
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <div className="truncate">{r.subject}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.message}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>{fmt(r.send_at)}</div>
                    {r.status === "scheduled" && <div className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(r.send_at), { addSuffix: true })}</div>}
                    {r.status === "failed" && r.error && <div className="text-xs text-rose-600 truncate max-w-[220px]" title={r.error}>{r.error}</div>}
                  </TableCell>
                  <TableCell><StatusBadge s={r.status} /></TableCell>
                  <TableCell className="text-right">
                    {canManage && (r.status === "scheduled" || r.status === "failed") ? (
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="outline" disabled={sendNow.isPending} onClick={() => sendNow.mutate(r)}>
                          <Send className="h-3.5 w-3.5 mr-1" /> Send now
                        </Button>
                        <Button size="sm" variant="ghost" className="text-rose-600 hover:text-rose-700" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)}>
                          <X className="h-3.5 w-3.5 mr-1" /> Cancel
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">{r.status === "sent" && r.sent_at ? `Sent ${fmt(r.sent_at)}` : "—"}</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Schedule dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Schedule a client reminder</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Client Email *</Label>
                <Input type="email" placeholder="client@example.com" value={form.to_email} onChange={(e) => set("to_email", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Client Name</Label>
                <Input placeholder="Optional" value={form.client_name} onChange={(e) => set("client_name", e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Subject *</Label>
              <Input placeholder="e.g. Your virtual office renewal is due" value={form.subject} onChange={(e) => set("subject", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Message *</Label>
              <Textarea rows={5} placeholder="Write the reminder the client will receive…" value={form.message} onChange={(e) => set("message", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Send at *</Label>
              <Input type="datetime-local" value={form.send_at} onChange={(e) => set("send_at", e.target.value)} />
              <p className="text-[11px] text-muted-foreground mt-1">The reminder sends automatically at this time (checked every few minutes).</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Scheduling…" : "Schedule reminder"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
