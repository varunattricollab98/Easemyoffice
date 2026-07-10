// One-click backup of theme + accessibility + shortcut overrides.
// Also supports daily auto-snapshots stored in localStorage, with optional
// auto-download on a 24h cadence.

import { DEFAULTS, type Prefs, applyPrefs, listSavedPresets } from "@/lib/theme";
import { readOverrides, writeOverrides, readDisabledAll, writeDisabledAll, type Overrides } from "@/lib/shortcuts";
import { supabase } from "@/integrations/supabase/client";

export type Backup = {
  version: 1;
  createdAt: string;
  prefs: Prefs;
  presets: { name: string; preset: string; createdAt: number }[];
  shortcuts: { overrides: Overrides; disableAll: boolean };
};

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem("theme.prefs");
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULTS };
}

export function buildBackup(): Backup {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    prefs: readPrefs(),
    presets: listSavedPresets(),
    shortcuts: { overrides: readOverrides(), disableAll: readDisabledAll() },
  };
}

export function downloadBackup(filename?: string): Backup {
  const b = buildBackup();
  const blob = new Blob([JSON.stringify(b, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = b.createdAt.replace(/[:.]/g, "-");
  a.href = url;
  a.download = filename || `easemyoffice-prefs-${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  localStorage.setItem("backup.lastDownloadAt", b.createdAt);
  return b;
}

export function restoreBackup(json: string): Backup {
  const b = JSON.parse(json) as Backup;
  if (!b || b.version !== 1) throw new Error("Unsupported backup file");
  if (b.prefs) {
    localStorage.setItem("theme.prefs", JSON.stringify(b.prefs));
    applyPrefs(b.prefs);
    // sync to cloud as well
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) supabase.from("user_theme_prefs").upsert({ user_id: user.id, prefs: b.prefs, updated_at: new Date().toISOString() });
    });
  }
  if (b.presets) localStorage.setItem("theme.presets", JSON.stringify(b.presets));
  if (b.shortcuts) {
    writeOverrides(b.shortcuts.overrides || {});
    writeDisabledAll(!!b.shortcuts.disableAll);
  }
  window.dispatchEvent(new Event("backup:restored"));
  return b;
}

// ---- Daily snapshot (in-app) ---------------------------------------------
const SNAP_KEY = "backup.snapshots.v1";
const AUTO_KEY = "backup.autoDaily.v1";

export type Snapshot = { at: string; backup: Backup };

export function listSnapshots(): Snapshot[] {
  try { return JSON.parse(localStorage.getItem(SNAP_KEY) || "[]"); } catch { return []; }
}
export function saveSnapshot(): Snapshot {
  const snap: Snapshot = { at: new Date().toISOString(), backup: buildBackup() };
  const all = [snap, ...listSnapshots()].slice(0, 14); // keep last 14
  localStorage.setItem(SNAP_KEY, JSON.stringify(all));
  localStorage.setItem("backup.lastSnapshotAt", snap.at);
  return snap;
}
export function deleteSnapshot(at: string) {
  localStorage.setItem(SNAP_KEY, JSON.stringify(listSnapshots().filter((s) => s.at !== at)));
}

export function autoDailyEnabled(): boolean {
  return localStorage.getItem(AUTO_KEY) === "1";
}
export function setAutoDaily(v: boolean) {
  localStorage.setItem(AUTO_KEY, v ? "1" : "0");
}

const DAY = 24 * 60 * 60 * 1000;

/** Run on app boot. Snapshots once per 24h. Optionally also downloads file. */
export function runDailyBackupIfDue() {
  if (typeof window === "undefined") return;
  const last = localStorage.getItem("backup.lastSnapshotAt");
  const due = !last || Date.now() - new Date(last).getTime() > DAY;
  if (!due) return;
  saveSnapshot();
  if (autoDailyEnabled()) {
    const lastDl = localStorage.getItem("backup.lastDownloadAt");
    if (!lastDl || Date.now() - new Date(lastDl).getTime() > DAY) {
      try { downloadBackup(); } catch {}
    }
  }
}
