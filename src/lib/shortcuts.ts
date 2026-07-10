// Centralized keyboard shortcut registry with per-device overrides.
// Bindings are normalized strings like "Mod+Shift+T" / "?". `null` = disabled.

export type ShortcutId =
  | "open-settings"
  | "open-shortcuts"
  | "cycle-theme"
  | "cycle-density"
  | "toggle-motion"
  | "toggle-contrast"
  | "accent-1" | "accent-2" | "accent-3" | "accent-4" | "accent-5"
  | "accent-6" | "accent-7" | "accent-8" | "accent-9" | "accent-10";

export type ShortcutDef = {
  id: ShortcutId;
  label: string;
  group: "navigation" | "appearance" | "accessibility" | "accent";
  defaultBinding: string;
  allowInInput?: boolean;
};

export const SHORTCUTS: ShortcutDef[] = [
  { id: "open-settings",    label: "Open Settings",                 group: "navigation",    defaultBinding: "Mod+,",        allowInInput: true },
  { id: "open-shortcuts",   label: "Show Keyboard Shortcuts",       group: "navigation",    defaultBinding: "?",            allowInInput: false },
  { id: "cycle-theme",      label: "Cycle theme (light/dark/sys)",  group: "appearance",    defaultBinding: "Mod+Shift+T" },
  { id: "cycle-density",    label: "Cycle density",                 group: "appearance",    defaultBinding: "Mod+Shift+D" },
  { id: "toggle-motion",    label: "Toggle reduce motion",          group: "accessibility", defaultBinding: "Mod+Shift+M" },
  { id: "toggle-contrast",  label: "Toggle high contrast",          group: "accessibility", defaultBinding: "Mod+Shift+C" },
  { id: "accent-1",  label: "Accent 1 (Indigo)",   group: "accent", defaultBinding: "Mod+Shift+1" },
  { id: "accent-2",  label: "Accent 2 (Emerald)",  group: "accent", defaultBinding: "Mod+Shift+2" },
  { id: "accent-3",  label: "Accent 3 (Teal)",     group: "accent", defaultBinding: "Mod+Shift+3" },
  { id: "accent-4",  label: "Accent 4 (Cyan)",     group: "accent", defaultBinding: "Mod+Shift+4" },
  { id: "accent-5",  label: "Accent 5 (Violet)",   group: "accent", defaultBinding: "Mod+Shift+5" },
  { id: "accent-6",  label: "Accent 6 (Fuchsia)",  group: "accent", defaultBinding: "Mod+Shift+6" },
  { id: "accent-7",  label: "Accent 7 (Rose)",     group: "accent", defaultBinding: "Mod+Shift+7" },
  { id: "accent-8",  label: "Accent 8 (Orange)",   group: "accent", defaultBinding: "Mod+Shift+8" },
  { id: "accent-9",  label: "Accent 9 (Amber)",    group: "accent", defaultBinding: "Mod+Shift+9" },
  { id: "accent-10", label: "Accent 10 (Slate)",   group: "accent", defaultBinding: "Mod+Shift+0" },
];

const KEY = "shortcuts.overrides.v1";
const DISABLE_ALL = "shortcuts.disableAll.v1";

// Per-device overrides. value === null means disabled.
export type Overrides = Partial<Record<ShortcutId, string | null>>;

export function readOverrides(): Overrides {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}
export function writeOverrides(o: Overrides) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(o));
  window.dispatchEvent(new Event("shortcuts:changed"));
}
export function setBinding(id: ShortcutId, binding: string | null | undefined) {
  const o = readOverrides();
  if (binding === undefined) delete o[id]; else o[id] = binding;
  writeOverrides(o);
}
export function getBinding(id: ShortcutId): string | null {
  const o = readOverrides();
  if (id in o) return o[id] ?? null; // null = disabled, string = override
  return SHORTCUTS.find((s) => s.id === id)?.defaultBinding ?? null;
}
export function readDisabledAll(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(DISABLE_ALL) === "1";
}
export function writeDisabledAll(v: boolean) {
  localStorage.setItem(DISABLE_ALL, v ? "1" : "0");
  window.dispatchEvent(new Event("shortcuts:changed"));
}

// Normalize a binding string like "mod+shift+T" => "Mod+Shift+T"
export function normalizeBinding(s: string): string {
  const parts = s.split("+").map((p) => p.trim()).filter(Boolean);
  const mods: string[] = [];
  let key = "";
  for (const p of parts) {
    const lc = p.toLowerCase();
    if (lc === "mod" || lc === "cmd" || lc === "meta" || lc === "ctrl" || lc === "control") mods.push("Mod");
    else if (lc === "shift") mods.push("Shift");
    else if (lc === "alt" || lc === "option") mods.push("Alt");
    else key = p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1);
  }
  const order = ["Mod", "Shift", "Alt"].filter((m) => mods.includes(m));
  return [...order, key].filter(Boolean).join("+");
}

export function bindingFromEvent(e: KeyboardEvent): string {
  const mods: string[] = [];
  if (e.metaKey || e.ctrlKey) mods.push("Mod");
  if (e.shiftKey) mods.push("Shift");
  if (e.altKey) mods.push("Alt");
  let key = e.key;
  if (key === " ") key = "Space";
  if (key.length === 1) key = key.toUpperCase();
  // ignore pure modifier presses
  if (["Meta", "Control", "Shift", "Alt"].includes(key)) return "";
  return [...mods, key].join("+");
}

export function matches(binding: string | null, e: KeyboardEvent): boolean {
  if (!binding) return false;
  return bindingFromEvent(e) === normalizeBinding(binding);
}

export function prettyBinding(binding: string | null, isMac = false): string {
  if (!binding) return "Disabled";
  return normalizeBinding(binding)
    .replace("Mod", isMac ? "⌘" : "Ctrl")
    .replace("Shift", "⇧")
    .replace("Alt", isMac ? "⌥" : "Alt")
    .split("+").join(" + ");
}
