import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
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
import { AlarmClock, Plus, Send, X, Mail, Repeat, Pause, Play } from "lucide-react";

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
  status: "scheduled" | "sent" | "cancelled" | "failed" | "paused";
  sent_at: string | null;
  error: string | null;
  created_by: string | null;
  repeat_interval_days: number;
  repeat_until: string | null;
  occurrences_sent: number;
};

// human label for a repeat interval
function repeatLabel(days: number) {
  if (!days || days <= 0) return "One-time";
  if (days === 1) return "Every day";
  if (days === 2) return "Alternate days";
  if (days === 7) return "Weekly";
  return `Every ${days} days`;
}

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const fmt = (d: string) => { try { return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return d; } };

// Live countdown label, e.g. "in 2 minutes" / "in 1 minute" / "sending now…".
// `_tick` is only here to force a re-render every minute.
function countdown(sendAt: string, _tick: number) {
  const diff = new Date(sendAt).getTime() - Date.now();
  if (diff <= 0) return "sending now…";
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "less than a minute left";
  if (mins < 60) return `in ${mins} minute${mins === 1 ? "" : "s"}`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs} hour${hrs === 1 ? "" : "s"}`;
  const days = Math.round(hrs / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

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
    paused: "bg-amber-100 text-amber-800 border-amber-300",
  };
  const label = s === "sent" ? "succeeded" : s;
  return <Badge variant="outline" className={`${map[s]} capitalize`}>{label}</Badge>;
}

function RemindersPage() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"scheduled" | "succeeded" | "paused" | "all">("scheduled");
  const [tick, setTick] = useState(0);

  // Re-render every 30s so the countdown ("in 2 minutes") stays live.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const [form, setForm] = useState({ to_email: "", client_name: "", subject: "", message: "", send_at: defaultSendAt(), repeat: false, interval_days: "1", stop_days: "7" });
  const set = (k: keyof typeof form, v: string | boolean) => setForm((s) => ({ ...s, [k]: v }));

  const { data: reminders = [], isLoading } = useQuery({
    queryKey: ["reminders"],
    queryFn: async () => {
      const { data, error } = await supabase.from("reminders").select("*").order("send_at", { ascending: true }).limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Reminder[];
    },
  });

  const shown = useMemo(() => {
    if (tab === "scheduled") return reminders.filter((r) => r.status === "scheduled");
    if (tab === "succeeded") return reminders.filter((r) => r.status === "sent");
    if (tab === "paused") return reminders.filter((r) => r.status === "paused");
    return reminders;
  }, [reminders, tab]);

  const tabCount = (t: typeof tab) => {
    if (t === "scheduled") return reminders.filter((r) => r.status === "scheduled").length;
    if (t === "succeeded") return reminders.filter((r) => r.status === "sent").length;
    if (t === "paused") return reminders.filter((r) => r.status === "paused").length;
    return reminders.length;
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      if (!isEmail(form.to_email)) throw new Error("Enter a valid client email address.");
      if (!form.subject.trim()) throw new Error("Subject is required.");
      if (!form.message.trim()) throw new Error("Message is required.");
      if (!form.send_at) throw new Error("Pick a date & time to send.");

      const start = new Date(form.send_at);
      let interval = 0;
      let until: string | null = null;
      if (form.repeat) {
        interval = Math.max(1, parseInt(form.interval_days, 10) || 1);
        const stopDays = Math.max(1, parseInt(form.stop_days, 10) || 1);
        if (stopDays < interval) throw new Error("\"Stop after\" days should be at least the send interval.");
        until = new Date(start.getTime() + stopDays * 86400000).toISOString();
      }

      const { error } = await supabase.from("reminders").insert({
        to_email: form.to_email.trim(),
        client_name: form.client_name.trim(),
        subject: form.subject.trim(),
        message: form.message,
        send_at: start.toISOString(),
        status: "scheduled",
        repeat_interval_days: interval,
        repeat_until: until,
        created_by: user.id,
        assigned_to: user.id,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Reminder scheduled");
      setOpen(false);
      setForm({ to_email: "", client_name: "", subject: "", message: "", send_at: defaultSendAt(), repeat: false, interval_days: "1", stop_days: "7" });
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

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "paused" | "scheduled" }) => {
      const { error } = await supabase.from("reminders").update({ status }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => { toast.success(v.status === "paused" ? "Reminder paused" : "Reminder resumed"); qc.invalidateQueries({ queryKey: ["reminders"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Manual "Send now" — uses the existing send-client-email function, then marks it sent.
  const sendNow = useMutation({
    mutationFn: async (r: Reminder) => {
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#0f172a">${r.message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</div>`;
      const { data, error } = await supabase.functions.invoke("send-client-email", { body: { to: r.to_email, subject: r.subject, html, text: r.message } });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || "Could not send email");
      // For a repeating reminder, sending now is just an extra copy — keep it
      // scheduled so the recurring series continues. One-time ones are marked sent.
      const patch = r.repeat_interval_days > 0
        ? { occurrences_sent: (r.occurrences_sent ?? 0) + 1, error: null }
        : { status: "sent", sent_at: new Date().toISOString(), occurrences_sent: (r.occurrences_sent ?? 0) + 1, error: null };
      const { error: uErr } = await supabase.from("reminders").update(patch).eq("id", r.id);
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
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          {(["scheduled", "succeeded", "paused", "all"] as const).map((t) => (
            <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)} className="capitalize">
              {t} <span className="ml-1 opacity-70">({tabCount(t)})</span>
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
                    <div>{r.repeat_interval_days > 0 && r.status === "scheduled" ? <span className="text-muted-foreground">Next: </span> : null}{fmt(r.send_at)}</div>
                    {r.status === "scheduled" && <div className="text-xs font-medium text-blue-600">{countdown(r.send_at, tick)}</div>}
                    {r.status === "paused" && <div className="text-xs text-amber-600">Paused</div>}
                    {r.repeat_interval_days > 0 && (
                      <div className="text-xs text-violet-600 flex items-center gap-1 mt-0.5">
                        <Repeat className="h-3 w-3" />
                        {repeatLabel(r.repeat_interval_days)}{r.repeat_until ? ` · until ${fmt(r.repeat_until)}` : ""}
                        {r.occurrences_sent > 0 ? ` · sent ${r.occurrences_sent}x` : ""}
                      </div>
                    )}
                    {r.status === "failed" && r.error && <div className="text-xs text-rose-600 truncate max-w-[220px]" title={r.error}>{r.error}</div>}
                  </TableCell>
                  <TableCell><StatusBadge s={r.status} /></TableCell>
                  <TableCell className="text-right">
                    {canManage && (r.status === "scheduled" || r.status === "failed" || r.status === "paused") ? (
                      <div className="flex justify-end gap-1.5 flex-wrap">
                        <Button size="sm" variant="outline" disabled={sendNow.isPending} onClick={() => sendNow.mutate(r)}>
                          <Send className="h-3.5 w-3.5 mr-1" /> Send now
                        </Button>
                        {r.status === "paused" ? (
                          <Button size="sm" variant="ghost" className="text-emerald-600 hover:text-emerald-700" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: "scheduled" })}>
                            <Play className="h-3.5 w-3.5 mr-1" /> Resume
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" className="text-amber-600 hover:text-amber-700" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: "paused" })}>
                            <Pause className="h-3.5 w-3.5 mr-1" /> Pause
                          </Button>
                        )}
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
              <Label className="text-xs">{form.repeat ? "First send at *" : "Send at *"}</Label>
              <Input type="datetime-local" value={form.send_at} onChange={(e) => set("send_at", e.target.value)} />
              <p className="text-[11px] text-muted-foreground mt-1">The reminder sends automatically at this time (checked every few minutes).</p>
            </div>

            {/* Recurring reminder options */}
            <div className="rounded-lg border p-3 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={form.repeat} onChange={(e) => set("repeat", e.target.checked)} />
                <span className="text-sm font-medium">Repeat this reminder</span>
              </label>
              {form.repeat && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Send every (days)</Label>
                    <Input type="number" min={1} value={form.interval_days} onChange={(e) => set("interval_days", e.target.value)} />
                    <p className="text-[11px] text-muted-foreground mt-1">1 = daily · 2 = alternate days · 7 = weekly</p>
                  </div>
                  <div>
                    <Label className="text-xs">Stop after (days)</Label>
                    <Input type="number" min={1} value={form.stop_days} onChange={(e) => set("stop_days", e.target.value)} />
                    <p className="text-[11px] text-muted-foreground mt-1">No more reminders sent after this many days.</p>
                  </div>
                </div>
              )}
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
