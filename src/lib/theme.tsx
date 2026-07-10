import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ThemeMode = "light" | "dark" | "system";
export type AccentName =
  | "indigo" | "emerald" | "rose" | "amber" | "cyan" | "violet"
  | "teal" | "fuchsia" | "slate" | "orange";
export type Density = "compact" | "comfortable" | "cozy";
export type Radius = "sharp" | "default" | "rounded" | "pill";
export type FontScale = "sm" | "md" | "lg";
export type Contrast = "normal" | "high";

export const ACCENTS: { id: AccentName; label: string; primary: string; ring: string; darkPrimary: string }[] = [
  { id: "indigo",  label: "Indigo",  primary: "oklch(0.48 0.18 264)", ring: "oklch(0.55 0.18 264)", darkPrimary: "oklch(0.7 0.17 264)" },
  { id: "emerald", label: "Emerald", primary: "oklch(0.55 0.16 152)", ring: "oklch(0.6 0.16 152)",  darkPrimary: "oklch(0.72 0.15 152)" },
  { id: "teal",    label: "Teal",    primary: "oklch(0.56 0.13 190)", ring: "oklch(0.6 0.13 190)",  darkPrimary: "oklch(0.72 0.13 190)" },
  { id: "cyan",    label: "Cyan",    primary: "oklch(0.6 0.13 220)",  ring: "oklch(0.65 0.13 220)", darkPrimary: "oklch(0.74 0.13 220)" },
  { id: "violet",  label: "Violet",  primary: "oklch(0.55 0.2 295)",  ring: "oklch(0.6 0.2 295)",   darkPrimary: "oklch(0.72 0.18 295)" },
  { id: "fuchsia", label: "Fuchsia", primary: "oklch(0.58 0.22 330)", ring: "oklch(0.62 0.22 330)", darkPrimary: "oklch(0.74 0.2 330)" },
  { id: "rose",    label: "Rose",    primary: "oklch(0.58 0.2 18)",   ring: "oklch(0.62 0.2 18)",   darkPrimary: "oklch(0.72 0.18 18)" },
  { id: "orange",  label: "Orange",  primary: "oklch(0.62 0.18 45)",  ring: "oklch(0.66 0.18 45)",  darkPrimary: "oklch(0.74 0.17 45)" },
  { id: "amber",   label: "Amber",   primary: "oklch(0.68 0.17 70)",  ring: "oklch(0.7 0.17 70)",   darkPrimary: "oklch(0.78 0.16 70)" },
  { id: "slate",   label: "Slate",   primary: "oklch(0.4 0.03 260)",  ring: "oklch(0.5 0.03 260)",  darkPrimary: "oklch(0.78 0.02 260)" },
];

const RADIUS_VALUES: Record<Radius, string> = {
  sharp: "0.25rem", default: "0.75rem", rounded: "1rem", pill: "1.5rem",
};
const FONT_VALUES: Record<FontScale, string> = { sm: "14px", md: "16px", lg: "17px" };

export type Prefs = {
  mode: ThemeMode;
  accent: AccentName;
  density: Density;
  radius: Radius;
  fontScale: FontScale;
  reduceMotion: boolean;
  contrast: Contrast;
};

export const DEFAULTS: Prefs = {
  mode: "system", accent: "indigo", density: "comfortable",
  radius: "default", fontScale: "md", reduceMotion: false, contrast: "normal",
};

interface ThemeState extends Prefs {
  setMode: (m: ThemeMode) => void;
  setAccent: (a: AccentName) => void;
  setDensity: (d: Density) => void;
  setRadius: (r: Radius) => void;
  setFontScale: (f: FontScale) => void;
  setReduceMotion: (v: boolean) => void;
  setContrast: (c: Contrast) => void;
  apply: (patch: Partial<Prefs>) => void;
  resetDefaults: () => void;
  exportPreset: () => string;
  importPreset: (json: string) => boolean;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function applyPrefs(s: Prefs, target?: HTMLElement) {
  if (typeof document === "undefined") return;
  const root = target ?? document.documentElement;
  const isDark = s.mode === "dark" || (s.mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (!target) root.classList.toggle("dark", isDark);
  else root.classList.toggle("dark", isDark);
  const a = ACCENTS.find((x) => x.id === s.accent) ?? ACCENTS[0];
  root.style.setProperty("--primary", isDark ? a.darkPrimary : a.primary);
  root.style.setProperty("--ring", a.ring);
  root.style.setProperty("--sidebar-primary", isDark ? a.darkPrimary : a.primary);
  root.style.setProperty("--sidebar-ring", a.ring);
  root.style.setProperty("--radius", RADIUS_VALUES[s.radius]);
  if (!target) root.style.fontSize = FONT_VALUES[s.fontScale];
  else root.style.setProperty("font-size", FONT_VALUES[s.fontScale]);
  root.dataset.density = s.density;
  root.classList.toggle("quiet", s.reduceMotion);
  root.classList.toggle("hc", s.contrast === "high");
}

function readLocal(): Prefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem("theme.prefs");
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  // legacy keys
  return {
    mode: (localStorage.getItem("theme.mode") as ThemeMode) || DEFAULTS.mode,
    accent: (localStorage.getItem("theme.accent") as AccentName) || DEFAULTS.accent,
    density: (localStorage.getItem("theme.density") as Density) || DEFAULTS.density,
    radius: (localStorage.getItem("theme.radius") as Radius) || DEFAULTS.radius,
    fontScale: (localStorage.getItem("theme.fontScale") as FontScale) || DEFAULTS.fontScale,
    reduceMotion: localStorage.getItem("theme.reduceMotion") === "1",
    contrast: DEFAULTS.contrast,
  };
}
function writeLocal(p: Prefs) {
  if (typeof window === "undefined") return;
  localStorage.setItem("theme.prefs", JSON.stringify(p));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const syncTimer = useRef<number | null>(null);

  // Initial load + system listener
  useEffect(() => {
    const local = readLocal();
    setPrefs(local);
    applyPrefs(local);

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onSys = () => applyPrefs(local);
    mql.addEventListener?.("change", onSys);

    // Hydrate from server (then org default fallback)
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // try org default for guests too
        const { data } = await supabase.from("app_settings").select("value").eq("key", "org.theme_default").maybeSingle();
        if (data?.value && !localStorage.getItem("theme.prefs")) {
          const merged = { ...DEFAULTS, ...(data.value as Partial<Prefs>) };
          setPrefs(merged); applyPrefs(merged); writeLocal(merged);
        }
        return;
      }
      const { data: row } = await supabase.from("user_theme_prefs").select("prefs, updated_at").eq("user_id", user.id).maybeSingle();
      if (row?.prefs) {
        const merged = { ...DEFAULTS, ...(row.prefs as Partial<Prefs>) };
        setPrefs(merged); applyPrefs(merged); writeLocal(merged);
      } else {
        // first-time user: apply org default if present
        const { data: org } = await supabase.from("app_settings").select("value").eq("key", "org.theme_default").maybeSingle();
        if (org?.value) {
          const merged = { ...DEFAULTS, ...(org.value as Partial<Prefs>) };
          setPrefs(merged); applyPrefs(merged); writeLocal(merged);
        }
      }
    })();

    return () => mql.removeEventListener?.("change", onSys);
  }, []);

  const apply = (patch: Partial<Prefs>) => {
    setPrefs((cur) => {
      const next = { ...cur, ...patch };
      applyPrefs(next);
      writeLocal(next);
      // Debounced server sync
      if (syncTimer.current) window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        await supabase.from("user_theme_prefs").upsert({ user_id: user.id, prefs: next, updated_at: new Date().toISOString() });
      }, 600);
      return next;
    });
  };

  const value: ThemeState = {
    ...prefs,
    setMode: (m) => apply({ mode: m }),
    setAccent: (a) => apply({ accent: a }),
    setDensity: (d) => apply({ density: d }),
    setRadius: (r) => apply({ radius: r }),
    setFontScale: (f) => apply({ fontScale: f }),
    setReduceMotion: (v) => apply({ reduceMotion: v }),
    setContrast: (c) => apply({ contrast: c }),
    apply,
    resetDefaults: () => apply(DEFAULTS),
    exportPreset: () => JSON.stringify(prefs),
    importPreset: (json: string) => {
      try { apply({ ...DEFAULTS, ...JSON.parse(json) }); return true; } catch { return false; }
    },
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

// Saved (named) presets ---------------------------------------------------
export type SavedPreset = { name: string; preset: string; createdAt: number };
export function listSavedPresets(): SavedPreset[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem("theme.presets") || "[]"); } catch { return []; }
}
export function saveNamedPreset(name: string, preset: string) {
  const all = listSavedPresets().filter((p) => p.name !== name);
  all.unshift({ name, preset, createdAt: Date.now() });
  localStorage.setItem("theme.presets", JSON.stringify(all.slice(0, 12)));
}
export function deleteNamedPreset(name: string) {
  localStorage.setItem("theme.presets", JSON.stringify(listSavedPresets().filter((p) => p.name !== name)));
}

export const BUILTIN_PRESETS: { name: string; preset: Partial<Prefs> }[] = [
  { name: "Default", preset: DEFAULTS },
  { name: "Midnight Focus", preset: { mode: "dark", accent: "violet", density: "comfortable", radius: "rounded", fontScale: "md", reduceMotion: false } },
  { name: "Daylight Compact", preset: { mode: "light", accent: "emerald", density: "compact", radius: "sharp", fontScale: "sm", reduceMotion: true } },
  { name: "Sunset", preset: { mode: "light", accent: "orange", density: "comfortable", radius: "rounded", fontScale: "md" } },
  { name: "Mono Slate", preset: { mode: "dark", accent: "slate", density: "compact", radius: "default", fontScale: "sm", reduceMotion: true } },
  { name: "High Contrast", preset: { mode: "light", accent: "indigo", contrast: "high", fontScale: "lg" } },
];

// Org-wide default ---------------------------------------------------------
export async function loadOrgDefault(): Promise<Partial<Prefs> | null> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "org.theme_default").maybeSingle();
  return (data?.value as Partial<Prefs>) ?? null;
}
export async function saveOrgDefault(prefs: Partial<Prefs>, userId?: string) {
  const { error } = await supabase.from("app_settings").upsert({
    key: "org.theme_default", value: prefs, updated_by: userId ?? null, updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
