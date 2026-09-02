import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RichTextEditor, htmlToText } from "@/components/ui/rich-text-editor";
import { toast } from "sonner";
import { Settings2, Mail, Save, Plus, Pencil, Trash2 } from "lucide-react";
import { useState, useEffect } from "react";

export const Route = createFileRoute("/_authenticated/admin/email-automation")({
  head: () => ({ meta: [{ title: "Email Automation Settings — EaseMyOffice CRM" }] }),
  component: EmailAutomationPage,
});

type Snippet = { id: string; name: string; subject: string; body_html: string; created_by: string | null };
type StageConfig = {
  stage: string;
  label: string;
  description: string;
  defaultInterval: number;
  defaultStopDays: number;
};

const STAGES: StageConfig[] = [
  { stage: "follow_up", label: "Follow-up", description: "Daily reminder when lead moves to follow-up", defaultInterval: 1, defaultStopDays: 7 },
  { stage: "followups", label: "Followups", description: "Daily reminder when lead moves to followups stage", defaultInterval: 1, defaultStopDays: 7 },
  { stage: "not_interested", label: "Not Interested", description: "Weekly revival email to re-engage the client", defaultInterval: 7, defaultStopDays: 56 },
  { stage: "lost", label: "Lost Lead", description: "One-time goodwill/thank-you email (next day)", defaultInterval: 0, defaultStopDays: 0 },
];

// Settings are stored in a simple key-value table (`crm_settings`).
// If it doesn't exist yet, the page works with defaults and shows a setup note.
const SETTINGS_KEY = "email_automation_config";

type AutoConfig = Record<string, { enabled: boolean; snippet_id: string; interval_days: number; stop_days: number }>;

function defaultConfig(): AutoConfig {
  const cfg: AutoConfig = {};
  for (const s of STAGES) {
    cfg[s.stage] = { enabled: true, snippet_id: "", interval_days: s.defaultInterval, stop_days: s.defaultStopDays };
  }
  return cfg;
}

function EmailAutomationPage() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [config, setConfig] = useState<AutoConfig>(defaultConfig());
  const [loaded, setLoaded] = useState(false);

  // Inline snippet manager — create/edit email templates without leaving this page.
  const [snipOpen, setSnipOpen] = useState(false);
  const [snipForm, setSnipForm] = useState<{ id?: string; name: string; subject: string; body_html: string }>({ name: "", subject: "", body_html: "" });
  const [snipEditorKey, setSnipEditorKey] = useState(0);

  // Load snippets for the dropdown.
  const { data: snippets = [] } = useQuery({
    queryKey: ["email-snippets"],
    queryFn: async () => {
      const { data } = await supabase.from("email_snippets").select("id, name, subject, body_html, created_by").order("name");
      return (data ?? []) as Snippet[];
    },
  });

  // Load saved config from crm_settings (if exists).
  const { data: savedConfig } = useQuery({
    queryKey: ["crm-settings", SETTINGS_KEY],
    queryFn: async () => {
      const { data } = await supabase.from("crm_settings").select("value").eq("key", SETTINGS_KEY).maybeSingle();
      return data?.value as AutoConfig | null;
    },
  });

  useEffect(() => {
    if (savedConfig) { setConfig(savedConfig); setLoaded(true); }
    else if (!loaded) { setConfig(defaultConfig()); setLoaded(true); }
  }, [savedConfig]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("crm_settings").upsert({ key: SETTINGS_KEY, value: config }, { onConflict: "key" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Settings saved"); qc.invalidateQueries({ queryKey: ["crm-settings"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Inline snippet CRUD (shares the ["email-snippets"] query key with the
  // Reminders page, so saving here instantly refreshes the stage dropdowns). ──
  function resetSnipForm() {
    setSnipForm({ name: "", subject: "", body_html: "" });
    setSnipEditorKey((k) => k + 1);
  }

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
      resetSnipForm();
      qc.invalidateQueries({ queryKey: ["email-snippets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteSnippet = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("email_snippets").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Snippet deleted"); resetSnipForm(); qc.invalidateQueries({ queryKey: ["email-snippets"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateStage = (stage: string, patch: Partial<AutoConfig[string]>) =>
    setConfig((c) => ({ ...c, [stage]: { ...c[stage], ...patch } }));

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2"><Settings2 className="h-6 w-6 text-primary" /> Email Automation</h1>
          <p className="text-sm text-muted-foreground">Configure which emails are auto-triggered when a lead's pipeline stage changes.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => { resetSnipForm(); setSnipOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> New template
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            <Save className="h-4 w-4 mr-1" /> {save.isPending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </div>

      {snippets.length === 0 && (
        <Card className="p-4 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <div className="text-sm">
            <b>No snippets created yet.</b> Click <b>New template</b> above to create an email template right here, then assign it to each stage below.
            You can also manage snippets from <b>Reminders → Snippets</b>. Without a snippet, the system uses built-in default templates.
          </div>
        </Card>
      )}

      {snipOpen && (
        <Card className="p-4 space-y-4 border-primary/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />
              <span className="font-semibold">{snipForm.id ? "Edit email template" : "New email template"}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { resetSnipForm(); setSnipOpen(false); }}>Close</Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Template name *</Label>
              <Input className="mt-1" placeholder="e.g. Follow-up reminder" value={snipForm.name} onChange={(e) => setSnipForm((s) => ({ ...s, name: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Default subject</Label>
              <Input className="mt-1" placeholder="Optional" value={snipForm.subject} onChange={(e) => setSnipForm((s) => ({ ...s, subject: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Body (formatting, colours &amp; pasted templates supported)</Label>
            <div className="mt-1">
              <RichTextEditor key={`snip-${snipEditorKey}`} html={snipForm.body_html} onChange={(v) => setSnipForm((s) => ({ ...s, body_html: v }))} minHeight={180} maxHeight={320} placeholder="Write the template content…" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            {snipForm.id && <Button variant="outline" size="sm" onClick={resetSnipForm}>Clear / new</Button>}
            <Button size="sm" disabled={saveSnippet.isPending} onClick={() => saveSnippet.mutate()}>{snipForm.id ? "Update template" : "Save template"}</Button>
          </div>

          <div className="border-t pt-3 space-y-2">
            <div className="text-sm font-medium">Saved templates ({snippets.length})</div>
            {snippets.length === 0 && <p className="text-sm text-muted-foreground">No templates yet. Fill the form above and save one — it becomes selectable for each stage below.</p>}
            {snippets.map((s) => {
              const canEdit = isAdmin || s.created_by === user?.id;
              return (
                <div key={s.id} className="flex items-center justify-between rounded border px-3 py-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{s.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{s.subject || htmlToText(s.body_html).slice(0, 80)}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canEdit && <button type="button" title="Edit" className="text-muted-foreground hover:text-foreground" onClick={() => { setSnipForm({ id: s.id, name: s.name, subject: s.subject, body_html: s.body_html }); setSnipEditorKey((k) => k + 1); }}><Pencil className="h-4 w-4" /></button>}
                    {canEdit && <button type="button" title="Delete" className="text-rose-600 hover:text-rose-700" onClick={() => deleteSnippet.mutate(s.id)}><Trash2 className="h-4 w-4" /></button>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="space-y-4">
        {STAGES.map((s) => {
          const cfg = config[s.stage] ?? { enabled: true, snippet_id: "", interval_days: s.defaultInterval, stop_days: s.defaultStopDays };
          const snippet = snippets.find((sn) => sn.id === cfg.snippet_id);
          return (
            <Card key={s.stage} className={`p-4 space-y-3 ${!cfg.enabled ? "opacity-60" : ""}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-primary" />
                    <span className="font-semibold">{s.label}</span>
                    <Badge variant="secondary" className="text-xs">
                      {s.defaultInterval === 0 ? "One-time" : s.defaultInterval === 1 ? "Daily" : s.defaultInterval === 7 ? "Weekly" : `Every ${s.defaultInterval}d`}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={cfg.enabled} onChange={(e) => updateStage(s.stage, { enabled: e.target.checked })} />
                  <span className="text-sm">Enabled</span>
                </label>
              </div>

              {cfg.enabled && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t">
                  <div>
                    <Label className="text-xs">Email template (snippet)</Label>
                    <select
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm mt-1"
                      value={cfg.snippet_id}
                      onChange={(e) => updateStage(s.stage, { snippet_id: e.target.value })}
                    >
                      <option value="">— Use default template —</option>
                      {snippets.map((sn) => <option key={sn.id} value={sn.id}>{sn.name}</option>)}
                    </select>
                    {snippet && <p className="text-[11px] text-muted-foreground mt-1">Subject: {snippet.subject || "(from snippet)"}</p>}
                  </div>
                  {s.defaultInterval > 0 && (
                    <>
                      <div>
                        <Label className="text-xs">Send every (days)</Label>
                        <Input type="number" min={1} className="mt-1" value={cfg.interval_days} onChange={(e) => updateStage(s.stage, { interval_days: parseInt(e.target.value) || s.defaultInterval })} />
                      </div>
                      <div>
                        <Label className="text-xs">Stop after (days)</Label>
                        <Input type="number" min={1} className="mt-1" value={cfg.stop_days} onChange={(e) => updateStage(s.stage, { stop_days: parseInt(e.target.value) || s.defaultStopDays })} />
                      </div>
                    </>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Card className="p-4 bg-muted/30">
        <div className="text-xs text-muted-foreground space-y-1">
          <p><b>How it works:</b> When a salesperson moves a lead to one of the above stages (via pipeline drag, lead detail, or bulk action), the system auto-creates a scheduled reminder using the assigned snippet. The salesperson can then pause, stop, or edit it from the Reminders tab.</p>
          <p><b>No snippet selected?</b> The system uses a built-in default template (professional follow-up / revival / thank-you).</p>
        </div>
      </Card>
    </div>
  );
}
