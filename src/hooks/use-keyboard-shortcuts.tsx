import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTheme, ACCENTS } from "@/lib/theme";
import { matches, getBinding, readDisabledAll, type ShortcutId } from "@/lib/shortcuts";
import { toast } from "sonner";

const isTyping = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t as HTMLElement).isContentEditable;
};

export function useGlobalShortcuts() {
  const navigate = useNavigate();
  const t = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (readDisabledAll()) return;

      const fire = (id: ShortcutId, allowInput = false) => {
        const b = getBinding(id);
        if (!matches(b, e)) return false;
        if (!allowInput && isTyping(e.target)) return false;
        e.preventDefault();
        return true;
      };

      if (fire("open-settings", true)) return navigate({ to: "/settings" });
      if (fire("open-shortcuts")) {
        window.dispatchEvent(new CustomEvent("shortcuts:open"));
        return;
      }
      if (fire("cycle-theme")) {
        const order = ["light", "dark", "system"] as const;
        const next = order[(order.indexOf(t.mode) + 1) % order.length];
        t.setMode(next); toast.success(`Theme: ${next}`); return;
      }
      if (fire("cycle-density")) {
        const order = ["compact", "comfortable", "cozy"] as const;
        const next = order[(order.indexOf(t.density) + 1) % order.length];
        t.setDensity(next); toast.success(`Density: ${next}`); return;
      }
      if (fire("toggle-motion")) {
        t.setReduceMotion(!t.reduceMotion);
        toast.success(`Reduce motion: ${!t.reduceMotion ? "on" : "off"}`); return;
      }
      if (fire("toggle-contrast")) {
        const next = t.contrast === "high" ? "normal" : "high";
        t.setContrast(next); toast.success(`Contrast: ${next}`); return;
      }
      for (let i = 0; i < 10; i++) {
        const id = `accent-${i + 1}` as ShortcutId;
        if (fire(id)) {
          if (ACCENTS[i]) { t.setAccent(ACCENTS[i].id); toast.success(`Accent: ${ACCENTS[i].label}`); }
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, t]);
}
