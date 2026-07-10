import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Plus, Trash2, Send, Mail, Database, Radio, RotateCcw, Palette, Sun, Moon, Monitor,
  User as UserIcon, Sparkles, Save, Download, Upload, Check, Eye, Keyboard, Building2, LogOut, RefreshCw,
  HardDriveDownload, History, X, Search, BarChart3, Users as UsersIcon, Bell as BellIcon,
} from "lucide-react";
import { reseedDemoData, clearDemoData, useSimEnabled, setSimEnabled } from "@/lib/demo";
import { NotificationPrefs } from "@/components/notification-prefs";
import {
  useTheme, ACCENTS, BUILTIN_PRESETS, listSavedPresets, saveNamedPreset, deleteNamedPreset,
  applyPrefs, loadOrgDefault, saveOrgDefault, DEFAULTS, type SavedPreset, type Prefs,
  type ThemeMode, type Density, type Radius, type FontScale, type Contrast,
} from "@/lib/theme";
import {
  SHORTCUTS, getBinding, setBinding, prettyBinding, normalizeBinding, bindingFromEvent,
  readDisabledAll, writeDisabledAll, type ShortcutId,
} from "@/lib/shortcuts";
import {
  downloadBackup, restoreBackup, listSnapshots, saveSnapshot, deleteSnapshot,
  autoDailyEnabled, setAutoDaily, type Snapshot,
} from "@/lib/backup";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — EaseMyOffice CRM" }] }),
  component: SettingsPage,
});

const REPORT_TYPES = [
  { id: "overdue", label: "Overdue follow-ups" },
  { id: "pipeline", label: "Pipeline health" },
  { id: "productivity", label: "Team productivity" },
] as const;

type Subscription = {
  id: string; email: string; reports: string[];
  frequency: "daily" | "weekly"; enabled: boolean;
  last_sent_at: string | null;
};

function SettingsPage() {
  const { profile, user, signOut, isAdmin, refresh } = useAuth();
  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl md:text-3xl font-bold">Settings</h1>

      <ProfileCard profile={profile} email={user?.email ?? ""} onSaved={refresh} />
      <AppearanceCard />
      <AccessibilityPreviewCard />
      <ShortcutRemapCard />
      <KeyboardShortcutsCard />
      <BackupCard />
      <NotificationPrefs />

      {isAdmin && <OrgDefaultsCard />}
      {isAdmin && <DemoControls />}
      {isAdmin && <ReportSubscriptions />}

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><LogOut className="h-4 w-4" /> Account</CardTitle></CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => signOut()}>
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ProfileCard({ profile, email, onSaved }: { profile: any; email: string; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [dept, setDept] = useState(profile?.department ?? "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!profile?.id) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ full_name: name, phone, department: dept }).eq("id", profile.id);
    setSaving(false);
    if (error) toast.error(error.message); else { toast.success("Profile updated"); onSaved(); }
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><UserIcon className="h-4 w-4" /> Profile</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div><Label className="text-xs">Full name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label className="text-xs">Email</Label><Input value={email} disabled /></div>
        <div><Label className="text-xs">Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div><Label className="text-xs">Department</Label><Input value={dept} onChange={(e) => setDept(e.target.value)} /></div>
        <div className="md:col-span-2"><Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Save profile</Button></div>
      </CardContent>
    </Card>
  );
}

function AppearanceCard() {
  const t = useTheme();
  const [presets, setPresets] = useState<SavedPreset[]>(() => listSavedPresets());
  const [presetName, setPresetName] = useState("");
  const refreshPresets = () => setPresets(listSavedPresets());

  const handleSave = () => {
    const name = presetName.trim();
    if (!name) return toast.error("Name your preset first");
    saveNamedPreset(name, t.exportPreset());
    setPresetName(""); refreshPresets();
    toast.success(`Saved “${name}”`);
  };
  const handleDelete = (name: string) => { deleteNamedPreset(name); refreshPresets(); };
  const handleApplyPreset = (preset: string) => {
    if (t.importPreset(preset)) toast.success("Preset applied");
    else toast.error("Invalid preset");
  };
  const handleExport = async () => {
    await navigator.clipboard.writeText(t.exportPreset());
    toast.success("Preset copied to clipboard");
  };
  const handleImport = () => {
    const txt = prompt("Paste preset JSON");
    if (txt && t.importPreset(txt)) toast.success("Preset imported");
    else if (txt) toast.error("Invalid JSON");
  };
  const resetAll = () => {
    if (!confirm("Reset all appearance, density, contrast, and motion preferences to defaults?")) return;
    t.resetDefaults();
    toast.success("Restored defaults");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Palette className="h-4 w-4" /> Appearance</CardTitle>
        <CardDescription>Theme, accent, density, radius, font, motion & contrast.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <Label className="text-xs">Theme</Label>
          <div className="flex gap-2 mt-1">
            {([["light", Sun], ["dark", Moon], ["system", Monitor]] as const).map(([m, Icon]) => (
              <Button key={m} size="sm" variant={t.mode === m ? "default" : "outline"} onClick={() => t.setMode(m)}>
                <Icon className="h-4 w-4 mr-1.5" /> {m[0].toUpperCase() + m.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-xs">Accent color</Label>
          <div className="flex gap-2 mt-1 flex-wrap">
            {ACCENTS.map((a) => (
              <button key={a.id} onClick={() => t.setAccent(a.id)}
                className={`size-8 rounded-full border-2 transition-all relative ${t.accent === a.id ? "ring-2 ring-offset-2 ring-foreground border-background" : "border-transparent"}`}
                style={{ background: a.primary }} title={a.label} aria-label={a.label}>
                {t.accent === a.id && <Check className="size-4 text-white absolute inset-0 m-auto" />}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-xs">Layout density</Label>
          <div className="flex gap-2 mt-1">
            {(["compact", "comfortable", "cozy"] as const).map((d) => (
              <Button key={d} size="sm" variant={t.density === d ? "default" : "outline"} onClick={() => t.setDensity(d)}>
                {d[0].toUpperCase() + d.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-xs">Corner radius</Label>
          <div className="flex gap-2 mt-1 flex-wrap">
            {(["sharp", "default", "rounded", "pill"] as const).map((r) => (
              <Button key={r} size="sm" variant={t.radius === r ? "default" : "outline"} onClick={() => t.setRadius(r)}>
                {r[0].toUpperCase() + r.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-xs">Font size</Label>
          <div className="flex gap-2 mt-1">
            {(["sm", "md", "lg"] as const).map((f) => (
              <Button key={f} size="sm" variant={t.fontScale === f ? "default" : "outline"} onClick={() => t.setFontScale(f)}>
                {f === "sm" ? "Small" : f === "md" ? "Medium" : "Large"}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <div className="text-sm font-medium">Reduce motion</div>
              <div className="text-xs text-muted-foreground">Dampen animations.</div>
            </div>
            <Switch checked={t.reduceMotion} onCheckedChange={t.setReduceMotion} />
          </div>
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <div className="text-sm font-medium">High contrast</div>
              <div className="text-xs text-muted-foreground">Stronger borders & text.</div>
            </div>
            <Switch checked={t.contrast === "high"} onCheckedChange={(v) => t.setContrast(v ? "high" : "normal")} />
          </div>
        </div>

        <div>
          <Label className="text-xs flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Quick presets</Label>
          <div className="flex gap-2 mt-1 flex-wrap">
            {BUILTIN_PRESETS.map((p) => (
              <Button key={p.name} size="sm" variant="outline" onClick={() => t.importPreset(JSON.stringify(p.preset))}>
                {p.name}
              </Button>
            ))}
          </div>
        </div>

        <div className="border rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Saved presets</div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={handleExport} title="Copy current as JSON"><Download className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" onClick={handleImport} title="Import from JSON"><Upload className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
          <div className="flex gap-2">
            <Input placeholder="Preset name" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
            <Button size="sm" onClick={handleSave}><Save className="h-4 w-4 mr-1" /> Save</Button>
          </div>
          {presets.length === 0 ? (
            <div className="text-xs text-muted-foreground">No saved presets yet. Synced via the cloud after you sign in on any device.</div>
          ) : (
            <div className="space-y-1.5">
              {presets.map((p) => (
                <div key={p.name} className="flex items-center justify-between text-sm border rounded-md px-2 py-1.5">
                  <span className="truncate">{p.name}</span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => handleApplyPreset(p.preset)}>Apply</Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(p.name)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pt-2 border-t flex justify-between items-center">
          <div className="text-xs text-muted-foreground">Preferences sync across your devices.</div>
          <Button variant="outline" size="sm" onClick={resetAll}>
            <RotateCcw className="h-4 w-4 mr-1.5" /> Reset to defaults
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Accessibility Preview ----------
function AccessibilityPreviewCard() {
  const t = useTheme();
  const [draft, setDraft] = useState<Prefs>({
    mode: t.mode, accent: t.accent, density: t.density, radius: t.radius,
    fontScale: t.fontScale, reduceMotion: t.reduceMotion, contrast: t.contrast,
  });
  const previewRef = useRef<HTMLDivElement | null>(null);

  // Keep draft in sync when underlying values change externally
  useEffect(() => {
    setDraft({
      mode: t.mode, accent: t.accent, density: t.density, radius: t.radius,
      fontScale: t.fontScale, reduceMotion: t.reduceMotion, contrast: t.contrast,
    });
  }, [t.mode, t.accent, t.density, t.radius, t.fontScale, t.reduceMotion, t.contrast]);

  // Apply preview-only styles inside the preview frame
  useEffect(() => {
    if (previewRef.current) applyPrefs(draft, previewRef.current);
  }, [draft]);

  const apply = () => {
    t.apply(draft);
    toast.success("Preview applied");
  };
  const cancel = () => setDraft({
    mode: t.mode, accent: t.accent, density: t.density, radius: t.radius,
    fontScale: t.fontScale, reduceMotion: t.reduceMotion, contrast: t.contrast,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Eye className="h-4 w-4" /> Accessibility Preview</CardTitle>
        <CardDescription>Try font size, reduced motion, and contrast — preview before applying.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Font size</Label>
            <Select value={draft.fontScale} onValueChange={(v) => setDraft((d) => ({ ...d, fontScale: v as FontScale }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sm">Small</SelectItem>
                <SelectItem value="md">Medium</SelectItem>
                <SelectItem value="lg">Large</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between border rounded-lg px-3">
            <span className="text-sm">Reduce motion</span>
            <Switch checked={draft.reduceMotion} onCheckedChange={(v) => setDraft((d) => ({ ...d, reduceMotion: v }))} />
          </div>
          <div className="flex items-center justify-between border rounded-lg px-3">
            <span className="text-sm">High contrast</span>
            <Switch checked={draft.contrast === "high"} onCheckedChange={(v) => setDraft((d) => ({ ...d, contrast: v ? "high" : "normal" as Contrast }))} />
          </div>
        </div>

        <div ref={previewRef} className="rounded-xl border bg-background text-foreground overflow-hidden">
          <CRMPreview />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={cancel}>Discard</Button>
          <Button size="sm" onClick={apply}><Check className="h-4 w-4 mr-1" /> Apply changes</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Compact CRM-like preview surface that inherits the scoped theme variables.
function CRMPreview() {
  const rows = [
    { name: "Aarav Sharma", co: "Acme Ventures", stage: "Negotiation", amt: "₹42,000", st: "Hot" },
    { name: "Diya Malhotra", co: "Bluestone Labs", stage: "Quotation", amt: "₹18,500", st: "Warm" },
    { name: "Kabir Bhatia", co: "Crayon Retail", stage: "Documents", amt: "₹26,000", st: "Hot" },
    { name: "Saanvi Desai", co: "Dovetail Tech", stage: "New Lead", amt: "₹9,200", st: "Cold" },
  ];
  return (
    <div className="grid grid-cols-12 min-h-[280px]">
      <aside className="col-span-3 border-r bg-muted/30 p-3 space-y-1.5 hidden sm:block">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">CRM</div>
        {[
          { I: BarChart3, l: "Dashboard", a: true },
          { I: UsersIcon, l: "Leads" },
          { I: BellIcon, l: "Follow-ups" },
        ].map(({ I, l, a }) => (
          <div key={l} className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm ${a ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-muted"}`}>
            <I className="h-4 w-4" /> {l}
          </div>
        ))}
      </aside>
      <div className="col-span-12 sm:col-span-9 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-base font-semibold">Today's pipeline</h4>
          <Button size="sm">+ New Lead</Button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[["Open", "128"], ["Won this week", "₹3.2L"], ["Conversion", "24%"]].map(([k, v]) => (
            <div key={k} className="border rounded-lg p-2 bg-card">
              <div className="text-[11px] text-muted-foreground">{k}</div>
              <div className="text-base font-semibold">{v}</div>
            </div>
          ))}
        </div>
        <div className="border rounded-lg overflow-hidden">
          <div className="grid grid-cols-12 px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40">
            <div className="col-span-4">Client</div><div className="col-span-3">Company</div>
            <div className="col-span-3">Stage</div><div className="col-span-2 text-right">Value</div>
          </div>
          {rows.map((r) => (
            <div key={r.name} className="grid grid-cols-12 px-3 py-1.5 text-sm items-center border-t">
              <div className="col-span-4 truncate">{r.name}</div>
              <div className="col-span-3 truncate text-muted-foreground">{r.co}</div>
              <div className="col-span-3"><Badge variant="outline">{r.stage}</Badge></div>
              <div className="col-span-2 text-right font-medium">{r.amt}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Shortcut Remap (per-device) ----------
function ShortcutRemapCard() {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  const [, force] = useState(0);
  const [recordingId, setRecordingId] = useState<ShortcutId | null>(null);
  const [filter, setFilter] = useState("");
  const [allDisabled, setAllDisabled] = useState(() => readDisabledAll());

  useEffect(() => {
    if (!recordingId) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      const b = bindingFromEvent(e);
      if (!b) return;
      setBinding(recordingId, normalizeBinding(b));
      setRecordingId(null); force((n) => n + 1);
      toast.success("Shortcut updated");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recordingId]);

  const filtered = SHORTCUTS.filter((s) =>
    !filter.trim() || `${s.label} ${s.group}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Keyboard className="h-4 w-4" /> Shortcut bindings</CardTitle>
        <CardDescription>Remap or disable shortcuts. These settings are per device.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-3 p-3 border rounded-lg">
          <div>
            <div className="text-sm font-medium">Disable all shortcuts on this device</div>
            <div className="text-xs text-muted-foreground">Useful on shared keyboards or when typing-heavy.</div>
          </div>
          <Switch checked={allDisabled} onCheckedChange={(v) => { writeDisabledAll(v); setAllDisabled(v); }} />
        </div>

        <div className="relative">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search shortcuts" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>

        <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
          {filtered.map((s) => {
            const b = getBinding(s.id);
            const recording = recordingId === s.id;
            return (
              <div key={s.id} className="flex items-center gap-2 border rounded-md px-3 py-1.5 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="truncate">{s.label}</div>
                  <div className="text-[11px] text-muted-foreground capitalize">{s.group}</div>
                </div>
                <kbd className={`px-2 py-0.5 rounded font-mono text-xs ${b ? "bg-muted" : "bg-muted/40 text-muted-foreground line-through"}`}>
                  {recording ? "Press keys…" : prettyBinding(b, isMac)}
                </kbd>
                <Button size="sm" variant={recording ? "default" : "outline"} onClick={() => setRecordingId(recording ? null : s.id)}>
                  {recording ? "Cancel" : "Remap"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setBinding(s.id, b ? null : s.defaultBinding); force((n) => n + 1); }}>
                  {b ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setBinding(s.id, undefined); force((n) => n + 1); }} title="Reset to default">
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Backup / Restore ----------
function BackupCard() {
  const [snaps, setSnaps] = useState<Snapshot[]>(() => listSnapshots());
  const [auto, setAuto] = useState<boolean>(() => autoDailyEnabled());
  const fileRef = useRef<HTMLInputElement | null>(null);
  const refresh = () => setSnaps(listSnapshots());

  const onPickFile = async (f: File | null) => {
    if (!f) return;
    try { const txt = await f.text(); restoreBackup(txt); toast.success("Backup restored"); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><HardDriveDownload className="h-4 w-4" /> Backup &amp; restore</CardTitle>
        <CardDescription>One-click backup of your theme, accessibility &amp; shortcut preferences. Daily snapshots kept on this device.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => { downloadBackup(); toast.success("Backup downloaded"); }}>
            <Download className="h-4 w-4 mr-1.5" /> Download backup
          </Button>
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1.5" /> Restore from file
          </Button>
          <Button size="sm" variant="outline" onClick={() => { saveSnapshot(); refresh(); toast.success("Snapshot saved"); }}>
            <History className="h-4 w-4 mr-1.5" /> Save snapshot now
          </Button>
          <input ref={fileRef} type="file" accept="application/json" className="hidden"
            onChange={(e) => { onPickFile(e.target.files?.[0] ?? null); e.currentTarget.value = ""; }} />
        </div>

        <div className="flex items-center justify-between p-3 border rounded-lg">
          <div>
            <div className="text-sm font-medium">Auto-download daily backup</div>
            <div className="text-xs text-muted-foreground">When enabled, your browser downloads a fresh backup once every 24h.</div>
          </div>
          <Switch checked={auto} onCheckedChange={(v) => { setAutoDaily(v); setAuto(v); }} />
        </div>

        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Recent snapshots</div>
          {snaps.length === 0 ? (
            <div className="text-sm text-muted-foreground py-3 text-center border rounded-md">No snapshots yet.</div>
          ) : snaps.map((s) => (
            <div key={s.at} className="flex items-center justify-between border rounded-md px-3 py-1.5 text-sm">
              <span className="truncate">{new Date(s.at).toLocaleString()}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => { try { restoreBackup(JSON.stringify(s.backup)); toast.success("Snapshot restored"); } catch (e) { toast.error((e as Error).message); } }}>Restore</Button>
                <Button size="sm" variant="ghost" onClick={() => { deleteSnapshot(s.at); refresh(); }}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Keyboard Shortcuts (live overview) ----------
function KeyboardShortcutsCard() {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  const rows = SHORTCUTS.filter((s) => !s.id.startsWith("accent-"));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Keyboard className="h-4 w-4" /> Keyboard shortcuts</CardTitle>
        <CardDescription>Press <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">?</kbd> anywhere to open the searchable overlay.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {rows.map((s) => {
            const b = getBinding(s.id);
            return (
              <div key={s.id} className="flex items-center justify-between gap-2 border rounded-md px-3 py-1.5 text-sm">
                <span className="text-muted-foreground">{s.label}</span>
                <kbd className={`px-2 py-0.5 rounded font-mono text-xs ${b ? "bg-muted" : "bg-muted/40 line-through"}`}>{prettyBinding(b, isMac)}</kbd>
              </div>
            );
          })}
        </div>
        <div className="text-xs text-muted-foreground mt-2">+ <kbd className="px-1 rounded bg-muted">{isMac ? "⌘" : "Ctrl"} ⇧ 1…0</kbd> picks accent colors.</div>
      </CardContent>
    </Card>
  );
}

// ---------- Org-wide defaults (admin) ----------
function OrgDefaultsCard() {
  const t = useTheme();
  const { user } = useAuth();
  const [loaded, setLoaded] = useState<Partial<Prefs> | null>(null);
  const [draft, setDraft] = useState<Prefs>({ ...DEFAULTS });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadOrgDefault().then((d) => {
      setLoaded(d);
      setDraft({ ...DEFAULTS, ...(d ?? {}) });
    });
  }, []);

  const useCurrent = () => setDraft({
    mode: t.mode, accent: t.accent, density: t.density, radius: t.radius,
    fontScale: t.fontScale, reduceMotion: t.reduceMotion, contrast: t.contrast,
  });

  const save = async () => {
    setSaving(true);
    try {
      await saveOrgDefault(draft, user?.id);
      setLoaded(draft);
      toast.success("Org default updated. New users (and signed-in users without saved prefs) will receive it.");
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };
  const clearOrg = async () => {
    if (!confirm("Remove organization-wide default theme?")) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("app_settings").delete().eq("key", "org.theme_default");
      if (error) throw error;
      setLoaded(null); setDraft({ ...DEFAULTS });
      toast.success("Org default cleared");
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" /> Organization theme defaults</CardTitle>
        <CardDescription>Set the default appearance applied to all teams. Users who haven't customized their own preferences receive this on next login.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Theme</Label>
            <Select value={draft.mode} onValueChange={(v) => setDraft((d) => ({ ...d, mode: v as ThemeMode }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Accent</Label>
            <Select value={draft.accent} onValueChange={(v) => setDraft((d) => ({ ...d, accent: v as Prefs["accent"] }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACCENTS.map((a) => <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Density</Label>
            <Select value={draft.density} onValueChange={(v) => setDraft((d) => ({ ...d, density: v as Density }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="compact">Compact</SelectItem>
                <SelectItem value="comfortable">Comfortable</SelectItem>
                <SelectItem value="cozy">Cozy</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Radius</Label>
            <Select value={draft.radius} onValueChange={(v) => setDraft((d) => ({ ...d, radius: v as Radius }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sharp">Sharp</SelectItem>
                <SelectItem value="default">Default</SelectItem>
                <SelectItem value="rounded">Rounded</SelectItem>
                <SelectItem value="pill">Pill</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={useCurrent}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Use my current settings
          </Button>
          {loaded ? (
            <Badge variant="secondary">Active org default set</Badge>
          ) : (
            <Badge variant="outline">No org default</Badge>
          )}
        </div>

        <div className="flex justify-end gap-2">
          {loaded && <Button variant="ghost" size="sm" onClick={clearOrg} disabled={saving}>Clear</Button>}
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}
            Roll out to all teams
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DemoControls() {
  const qc = useQueryClient();
  const simOn = useSimEnabled();
  const [busy, setBusy] = useState<"reseed" | "clear" | null>(null);

  const reseed = async () => {
    setBusy("reseed");
    try { const n = await reseedDemoData(); toast.success(`Reseeded ${n} demo leads`); qc.invalidateQueries(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  };
  const wipe = async () => {
    if (!confirm("Delete ALL leads, follow-ups, and activity logs? This cannot be undone.")) return;
    setBusy("clear");
    try { await clearDemoData(); toast.success("All test data cleared"); qc.invalidateQueries(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Database className="h-4 w-4" /> Demo &amp; Testing</CardTitle>
        <CardDescription>Tools for testing the CRM. Disable these before going live.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 p-3 border rounded-lg">
          <div>
            <div className="font-medium text-sm flex items-center gap-2">
              <Radio className={`h-4 w-4 ${simOn ? "text-success animate-pulse" : "text-muted-foreground"}`} />
              Simulate realtime updates
            </div>
            <div className="text-xs text-muted-foreground">Every 5s, randomly mutate a lead so Pipeline &amp; Follow-ups show live changes.</div>
          </div>
          <Switch checked={simOn} onCheckedChange={setSimEnabled} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={reseed} disabled={busy !== null} variant="default">
            {busy === "reseed" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RotateCcw className="h-4 w-4 mr-2" />}
            Reseed 100 demo leads
          </Button>
          <Button onClick={wipe} disabled={busy !== null} variant="outline">
            {busy === "clear" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2 text-destructive" />}
            Clear all test data
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReportSubscriptions() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [frequency, setFrequency] = useState<"daily" | "weekly">("daily");
  const [reports, setReports] = useState<string[]>(["overdue", "pipeline", "productivity"]);

  const { data: subs, isLoading } = useQuery({
    queryKey: ["report-subs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("report_subscriptions").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Subscription[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!email.trim()) throw new Error("Email is required");
      if (reports.length === 0) throw new Error("Pick at least one report");
      const { error } = await supabase.from("report_subscriptions").insert({
        email: email.trim().toLowerCase(), frequency, reports,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Recipient added"); setEmail(""); qc.invalidateQueries({ queryKey: ["report-subs"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase.from("report_subscriptions").update({ enabled }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["report-subs"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("report_subscriptions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Removed"); qc.invalidateQueries({ queryKey: ["report-subs"] }); },
  });

  const sendNow = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke("send-scheduled-reports", { body: { subscription_id: id, force: true } });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success("Report dispatched"); qc.invalidateQueries({ queryKey: ["report-subs"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleReport = (id: string) =>
    setReports((prev) => prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Mail className="h-4 w-4" /> Scheduled Report Emails</CardTitle>
        <CardDescription>Send operational reports automatically. Daily runs at 8am IST, weekly on Mondays.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="md:col-span-2">
              <Label className="text-xs">Recipient email</Label>
              <Input type="email" placeholder="team@easemyoffice.in" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Frequency</Label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as "daily" | "weekly")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly (Mon)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {REPORT_TYPES.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={reports.includes(r.id)} onCheckedChange={() => toggleReport(r.id)} />
                {r.label}
              </label>
            ))}
          </div>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Add recipient
          </Button>
        </div>

        <div className="space-y-2">
          {isLoading && <div className="py-4 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
          {(subs ?? []).length === 0 && !isLoading && (
            <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg">No recipients yet.</div>
          )}
          {(subs ?? []).map((s) => (
            <div key={s.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 border rounded-lg">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{s.email}</div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-1 mt-1">
                  <Badge variant="outline">{s.frequency}</Badge>
                  {s.reports.map((r) => <Badge key={r} variant="secondary" className="capitalize">{r}</Badge>)}
                  {s.last_sent_at && <span className="text-[11px]">· last sent {new Date(s.last_sent_at).toLocaleString()}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={s.enabled} onCheckedChange={(v) => toggle.mutate({ id: s.id, enabled: v })} />
                <Button size="sm" variant="outline" onClick={() => sendNow.mutate(s.id)} disabled={sendNow.isPending}><Send className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(s.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
