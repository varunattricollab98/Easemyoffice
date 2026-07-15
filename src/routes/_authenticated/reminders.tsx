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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { RichTextEditor, htmlToText } from "@/components/ui/rich-text-editor";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { toast } from "sonner";
import { AlarmClock, Plus, Send, X, Mail, Repeat, Pause, Play, Paperclip, FileText, Trash2, Pencil, BookmarkPlus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/reminders")({
  head: () => ({ meta: [{ title: "Reminders — EaseMyOffice CRM" }] }),
  component: RemindersPage,
});

type Attachment = { name: string; path: string; size?: number };
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
  is_html: boolean;
  attachments: Attachment[];
};
type Snippet = { id: string; name: string; subject: string; body_html: string; created_by: string | null };

function repeatLabel(days: number) {
  if (!days || days <= 0) return "One-time";
  if (days === 1) return "Every day";
  if (days === 2) return "Alternate days";
  if (days === 7) return "Weekly";
  return `Every ${days} days`;
}

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
// Accept one or more comma-separated emails; all must be valid.
const validRecipients = (v: string) => {
  const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(isEmail);
};
const fmt = (d: string) => { try { return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return d; } };
const BUCKET = "reminder-attachments";

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

function localInput(offsetMs: number) {
  const d = new Date(Date.now() + offsetMs);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
function defaultSendAt() { return localInput(24 * 60 * 60 * 1000); }        // +1 day
function defaultStopAt() { return localInput(8 * 24 * 60 * 60 * 1000); }    // +8 days

// Build the sign-URL list so Resend can fetch each attachment.
async function signedAttachments(atts: Attachment[]) {
  const out: { filename: string; path: string }[] = [];
  for (const a of atts ?? []) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(a.path, 3600);
    if (data?.signedUrl) out.push({ filename: a.name, path: data.signedUrl });
  }
  return out;
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

const EMPTY_FORM = { to_email: "", client_name: "", subject: "", message: "", send_at: defaultSendAt(), repeat: false, interval_days: "1", stop_mode: "days" as "days" | "date", stop_days: "7", stop_at: defaultStopAt() };

function RemindersPage() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"scheduled" | "succeeded" | "paused" | "all">("scheduled");
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);

  const [form, setForm] = useState({ ...EMPTY_FORM });
  const set = (k: keyof typeof form, v: string | boolean) => setForm((s) => ({ ...s, [k]: v }));
  const [editorKey, setEditorKey] = useState(0); // bump to push new HTML into the editor
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  // Snippet manager
  const [snipMgr, setSnipMgr] = useState(false);
  const [snipForm, setSnipForm] = useState<{ id?: string; name: string; subject: string; body_html: string }>({ name: "", subject: "", body_html: "" });
  const [snipEditorKey, setSnipEditorKey] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const { data: reminders = [], isLoading } = useQuery({
    queryKey: ["reminders"],
    queryFn: async () => {
      const { data, error } = await supabase.from("reminders").select("*").order("send_at", { ascending: true }).limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Reminder[];
    },
  });

  const { data: snippets = [] } = useQuery({
    queryKey: ["email-snippets"],
    queryFn: async () => {
      const { data, error } = await supabase.from("email_snippets").select("*").order("name", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Snippet[];
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

  function resetForm() {
    setForm({ ...EMPTY_FORM, send_at: defaultSendAt(), stop_at: defaultStopAt() });
    setAttachments([]);
    setEditorKey((k) => k + 1);
  }

  function insertSnippet(s: Snippet) {
    setForm((f) => ({
      ...f,
      subject: f.subject.trim() ? f.subject : s.subject || f.subject,
      message: (f.message || "") + (s.body_html || ""),
    }));
    setEditorKey((k) => k + 1);
    toast.success(`Inserted "${s.name}"`);
  }

  async function onPickFiles(files: FileList | null) {
    if (!files || !user) return;
    setUploading(true);
    try {
      const added: Attachment[] = [];
      for (const file of Array.from(files)) {
        if (file.size > 15 * 1024 * 1024) { toast.error(`${file.name} is over 15MB — too large to attach.`); continue; }
        const path = `${user.id}/${crypto.randomUUID()}/${file.name}`;
        const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
        if (error) { toast.error(`Upload failed: ${error.message}`); continue; }
        added.push({ name: file.name, path, size: file.size });
      }
      if (added.length) setAttachments((a) => [...a, ...added]);
    } finally {
      setUploading(false);
    }
  }

  async function removeAttachment(path: string) {
    await supabase.storage.from(BUCKET).remove([path]);
    setAttachments((a) => a.filter((x) => x.path !== path));
  }

  const create = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      if (!validRecipients(form.to_email)) throw new Error("Enter valid client email(s). Separate multiple with commas.");
      if (!form.subject.trim()) throw new Error("Subject is required.");
      if (!htmlToText(form.message).trim()) throw new Error("Message is required.");
      if (!form.send_at) throw new Error("Pick a date & time to send.");

      const start = new Date(form.send_at);
      let interval = 0;
      let until: string | null = null;
      if (form.repeat) {
        interval = Math.max(1, parseInt(form.interval_days, 10) || 1);
        if (form.stop_mode === "date") {
          if (!form.stop_at) throw new Error("Pick a stop date.");
          const untilDate = new Date(form.stop_at);
          if (untilDate <= start) throw new Error("Stop date must be after the first send.");
          until = untilDate.toISOString();
        } else {
          const stopDays = Math.max(1, parseInt(form.stop_days, 10) || 1);
          if (stopDays < interval) throw new Error("\"Stop after\" days should be at least the send interval.");
          until = new Date(start.getTime() + stopDays * 86400000).toISOString();
        }
      }

      const { error } = await supabase.from("reminders").insert({
        to_email: form.to_email.trim(),
        client_name: form.client_name.trim(),
        subject: form.subject.trim(),
        message: form.message,
        is_html: true,
        attachments,
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
      resetForm();
      qc.invalidateQueries({ queryKey: ["reminders"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Send the composed email immediately (and log it as sent).
  const sendNowCompose = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      if (!validRecipients(form.to_email)) throw new Error("Enter valid client email(s). Separate multiple with commas.");
      if (!form.subject.trim()) throw new Error("Subject is required.");
      if (!htmlToText(form.message).trim()) throw new Error("Message is required.");
      const atts = await signedAttachments(attachments);
      const { data, error } = await supabase.functions.invoke("send-client-email", { body: { to: form.to_email.trim(), subject: form.subject.trim(), html: form.message, attachments: atts } });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || "Could not send email");
      const now = new Date().toISOString();
      await supabase.from("reminders").insert({
        to_email: form.to_email.trim(), client_name: form.client_name.trim(), subject: form.subject.trim(),
        message: form.message, is_html: true, attachments, send_at: now, status: "sent", sent_at: now,
        created_by: user.id, assigned_to: user.id,
      });
    },
    onSuccess: () => { toast.success("Email sent"); setOpen(false); resetForm(); qc.invalidateQueries({ queryKey: ["reminders"] }); },
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

  // Admin: permanently delete reminders (single or bulk).
  const del = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from("reminders").delete().in("id", ids);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, ids) => {
      toast.success(`Deleted ${ids.length} reminder${ids.length > 1 ? "s" : ""}`);
      setSelected(new Set());
      setConfirmIds(null);
      qc.invalidateQueries({ queryKey: ["reminders"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleSelect = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.id));
  const toggleSelectAll = () =>
    setSelected((prev) => {
      if (allShownSelected) { const n = new Set(prev); shown.forEach((r) => n.delete(r.id)); return n; }
      const n = new Set(prev); shown.forEach((r) => n.add(r.id)); return n;
    });

  const sendNow = useMutation({
    mutationFn: async (r: Reminder) => {
      const html = r.is_html
        ? r.message
        : `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;white-space:pre-wrap;color:#0f172a">${r.message.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`;
      const atts = await signedAttachments(r.attachments || []);
      const { data, error } = await supabase.functions.invoke("send-client-email", { body: { to: r.to_email, subject: r.subject, html, attachments: atts } });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || "Could not send email");
      const patch = r.repeat_interval_days > 0
        ? { occurrences_sent: (r.occurrences_sent ?? 0) + 1, error: null }
        : { status: "sent", sent_at: new Date().toISOString(), occurrences_sent: (r.occurrences_sent ?? 0) + 1, error: null };
      const { error: uErr } = await supabase.from("reminders").update(patch).eq("id", r.id);
      if (uErr) throw new Error(uErr.message);
    },
    onSuccess: () => { toast.success("Reminder sent"); qc.invalidateQueries({ queryKey: ["reminders"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Snippet CRUD ──
  const saveSnippet = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      if (!snipForm.name.trim()) throw new Error("Snippet name is required.");
      if (snipForm.id) {
        const { error } = await supabase.from("email_snippets").update({ name: snipForm.name.trim(), subject: snipForm.subject, body_html: snipForm.body_html }).eq("id", snipForm.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from("email_snippets").insert({ name: snipForm.name.trim(), subject: snipForm.subject, body_html: snipForm.body_html, created_by: user.id });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success(snipForm.id ? "Snippet updated" : "Snippet saved");
      setSnipForm({ name: "", subject: "", body_html: "" });
      setSnipEditorKey((k) => k + 1);
      qc.invalidateQueries({ queryKey: ["email-snippets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteSnippet = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("email_snippets").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Snippet deleted"); qc.invalidateQueries({ queryKey: ["email-snippets"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const colCount = isAdmin ? 6 : 5;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2"><AlarmClock className="h-6 w-6 text-primary" /> Reminders</h1>
          <p className="text-sm text-muted-foreground">Schedule automatic email reminders to clients. They send on their own at the chosen time.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setSnipMgr(true)}><BookmarkPlus className="h-4 w-4 mr-1" /> Snippets</Button>
          <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> Schedule reminder</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          {(["scheduled", "succeeded", "paused", "all"] as const).map((t) => (
            <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => { setTab(t); setSelected(new Set()); }} className="capitalize">
              {t} <span className="ml-1 opacity-70">({tabCount(t)})</span>
            </Button>
          ))}
        </CardContent>
      </Card>

      {isAdmin && selected.size > 0 && (
        <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button variant="destructive" size="sm" onClick={() => setConfirmIds([...selected])}>
              <Trash2 className="h-4 w-4 mr-1" /> Delete selected
            </Button>
          </div>
        </div>
      )}

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {isAdmin && (
                <TableHead className="w-10">
                  <input type="checkbox" className="h-4 w-4 accent-primary align-middle" checked={allShownSelected} onChange={toggleSelectAll} title="Select all" />
                </TableHead>
              )}
              <TableHead>Client</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Send at</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={colCount} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
            {!isLoading && shown.length === 0 && <TableRow><TableCell colSpan={colCount} className="text-center py-8 text-muted-foreground">No reminders here. Click "Schedule reminder" to add one.</TableCell></TableRow>}
            {shown.map((r) => {
              const canManage = isAdmin || r.created_by === user?.id;
              const preview = r.is_html ? htmlToText(r.message) : r.message;
              const attCount = (r.attachments || []).length;
              return (
                <TableRow key={r.id} className={selected.has(r.id) ? "bg-primary/5" : ""}>
                  {isAdmin && (
                    <TableCell className="w-10">
                      <input type="checkbox" className="h-4 w-4 accent-primary align-middle" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="font-medium">{r.client_name || r.to_email}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="h-3 w-3" />{r.to_email}</div>
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <div className="truncate">{r.subject}</div>
                    <div className="text-xs text-muted-foreground truncate">{preview}</div>
                    {attCount > 0 && <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><Paperclip className="h-3 w-3" />{attCount} attachment{attCount > 1 ? "s" : ""}</div>}
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
                    {isAdmin && (
                      <Button size="sm" variant="ghost" className="text-rose-600 hover:text-rose-700 mt-1" disabled={del.isPending} onClick={() => setConfirmIds([r.id])}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Schedule dialog */}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-2xl p-0 flex flex-col max-h-[90vh] gap-0">
          <DialogHeader className="p-5 pb-3 shrink-0 border-b">
            <DialogTitle>Schedule a client reminder</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 overflow-y-auto px-5 py-4 flex-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Client Email(s) *</Label>
                <Input placeholder="client@example.com, another@example.com" value={form.to_email} onChange={(e) => set("to_email", e.target.value)} />
                <p className="text-[11px] text-muted-foreground mt-1">Multiple emails? Separate them with commas.</p>
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

            {/* Message + snippet insert */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs">Message *</Label>
                <div className="flex items-center gap-2">
                  <select
                    className="h-7 rounded-md border bg-background px-2 text-xs"
                    value=""
                    onChange={(e) => { const s = snippets.find((x) => x.id === e.target.value); if (s) insertSnippet(s); e.currentTarget.value = ""; }}
                  >
                    <option value="">Insert snippet…</option>
                    {snippets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => setSnipMgr(true)}>Manage</button>
                </div>
              </div>
              <RichTextEditor key={editorKey} html={form.message} onChange={(v) => set("message", v)} minHeight={200} maxHeight={280} placeholder="Write the email… paste a formatted quotation and it keeps its colours & layout." />
              <p className="text-[11px] text-muted-foreground mt-1">Tip: paste a formatted quotation directly — formatting is preserved. Spell-check works via your browser (e.g. Grammarly).</p>
            </div>

            {/* Attachments */}
            <div>
              <Label className="text-xs">Attachments (invoices, etc.)</Label>
              <div className="mt-1 space-y-2">
                {attachments.map((a) => (
                  <div key={a.path} className="flex items-center justify-between rounded border px-2 py-1.5 text-sm bg-muted/30">
                    <span className="flex items-center gap-2 truncate"><FileText className="h-4 w-4 text-muted-foreground shrink-0" />{a.name}{a.size ? <span className="text-xs text-muted-foreground">({Math.round(a.size / 1024)} KB)</span> : null}</span>
                    <button type="button" className="text-rose-600 hover:text-rose-700 shrink-0" onClick={() => removeAttachment(a.path)}><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
                <label className="inline-flex items-center gap-2 text-sm cursor-pointer rounded-md border px-3 py-1.5 hover:bg-accent">
                  <Paperclip className="h-4 w-4" /> {uploading ? "Uploading…" : "Attach file"}
                  <input type="file" multiple className="hidden" disabled={uploading} onChange={(e) => { onPickFiles(e.target.files); e.currentTarget.value = ""; }} />
                </label>
              </div>
            </div>

            <div>
              <Label className="text-xs">{form.repeat ? "First send at *" : "Send at *"}</Label>
              <DateTimePicker value={form.send_at} onChange={(v) => set("send_at", v)} />
              <p className="text-[11px] text-muted-foreground mt-1">The reminder sends automatically at this time (checked every minute).</p>
            </div>

            {/* Recurring options */}
            <div className="rounded-lg border p-3 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={form.repeat} onChange={(e) => set("repeat", e.target.checked)} />
                <span className="text-sm font-medium">Repeat this reminder</span>
              </label>
              {form.repeat && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Send every (days)</Label>
                      <Input type="number" min={1} value={form.interval_days} onChange={(e) => set("interval_days", e.target.value)} />
                      <p className="text-[11px] text-muted-foreground mt-1">1 = daily · 2 = alternate days · 7 = weekly</p>
                    </div>
                    <div>
                      <Label className="text-xs">Stop condition</Label>
                      <select
                        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                        value={form.stop_mode}
                        onChange={(e) => set("stop_mode", e.target.value as "days" | "date")}
                      >
                        <option value="days">After a number of days</option>
                        <option value="date">On a specific date</option>
                      </select>
                    </div>
                  </div>

                  {form.stop_mode === "days" ? (
                    <div>
                      <Label className="text-xs">Stop after (days)</Label>
                      <Input type="number" min={1} value={form.stop_days} onChange={(e) => set("stop_days", e.target.value)} />
                      <p className="text-[11px] text-muted-foreground mt-1">No more reminders sent after this many days from the first send.</p>
                    </div>
                  ) : (
                    <div>
                      <Label className="text-xs">Stop on</Label>
                      <DateTimePicker value={form.stop_at} onChange={(v) => set("stop_at", v)} />
                      <p className="text-[11px] text-muted-foreground mt-1">No more reminders sent after this date &amp; time.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t p-4 gap-2">
            <Button variant="outline" onClick={() => { setOpen(false); resetForm(); }}>Cancel</Button>
            <Button variant="secondary" disabled={sendNowCompose.isPending || uploading} onClick={() => sendNowCompose.mutate()}>
              <Send className="h-4 w-4 mr-1" /> {sendNowCompose.isPending ? "Sending…" : "Send now"}
            </Button>
            <Button disabled={create.isPending || uploading} onClick={() => create.mutate()}>{create.isPending ? "Scheduling…" : "Schedule reminder"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Snippet manager dialog */}
      <Dialog open={snipMgr} onOpenChange={setSnipMgr}>
        <DialogContent className="max-w-2xl p-0 flex flex-col max-h-[90vh] gap-0">
          <DialogHeader className="p-5 pb-3 shrink-0 border-b">
            <DialogTitle>{snipForm.id ? "Edit snippet" : "New snippet"}</DialogTitle>
          </DialogHeader>

          <div className="overflow-y-auto px-5 py-4 flex-1 space-y-4">
            {/* add / edit form with full rich editor */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Snippet name *</Label>
                  <Input placeholder="e.g. Renewal reminder" value={snipForm.name} onChange={(e) => setSnipForm((s) => ({ ...s, name: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Default subject</Label>
                  <Input placeholder="Optional" value={snipForm.subject} onChange={(e) => setSnipForm((s) => ({ ...s, subject: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Body (formatting, colours &amp; pasted quotations supported)</Label>
                <RichTextEditor key={`snip-${snipEditorKey}`} html={snipForm.body_html} onChange={(v) => setSnipForm((s) => ({ ...s, body_html: v }))} minHeight={180} maxHeight={300} placeholder="Write the snippet content…" />
              </div>
              <div className="flex justify-end gap-2">
                {snipForm.id && <Button variant="outline" size="sm" onClick={() => { setSnipForm({ name: "", subject: "", body_html: "" }); setSnipEditorKey((k) => k + 1); }}>Clear / new</Button>}
                <Button size="sm" disabled={saveSnippet.isPending} onClick={() => saveSnippet.mutate()}>{snipForm.id ? "Update snippet" : "Save snippet"}</Button>
              </div>
            </div>

            {/* existing snippets */}
            <div className="border-t pt-3 space-y-2">
              <div className="text-sm font-medium">Saved snippets ({snippets.length})</div>
              {snippets.length === 0 && <p className="text-sm text-muted-foreground">No snippets yet. Fill the form above and save one — your team can reuse it.</p>}
              {snippets.map((s) => {
                const canEdit = isAdmin || s.created_by === user?.id;
                return (
                  <div key={s.id} className="flex items-center justify-between rounded border px-3 py-2">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{s.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{s.subject || htmlToText(s.body_html).slice(0, 80)}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {open && <Button size="sm" variant="outline" onClick={() => { insertSnippet(s); setSnipMgr(false); }}>Insert</Button>}
                      {canEdit && <button type="button" title="Edit" className="text-muted-foreground hover:text-foreground" onClick={() => { setSnipForm({ id: s.id, name: s.name, subject: s.subject, body_html: s.body_html }); setSnipEditorKey((k) => k + 1); }}><Pencil className="h-4 w-4" /></button>}
                      {canEdit && <button type="button" title="Delete" className="text-rose-600 hover:text-rose-700" onClick={() => deleteSnippet.mutate(s.id)}><Trash2 className="h-4 w-4" /></button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t p-4">
            <Button variant="outline" onClick={() => setSnipMgr(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!confirmIds} onOpenChange={(v) => { if (!v) setConfirmIds(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmIds?.length === 1 ? "this reminder" : `${confirmIds?.length} reminders`}?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes {confirmIds?.length === 1 ? "it" : "them"} from the system. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={del.isPending} onClick={() => confirmIds && del.mutate(confirmIds)}>
              {del.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
