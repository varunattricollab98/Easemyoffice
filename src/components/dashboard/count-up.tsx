// Animated count-up number with tabular nums.
import { useEffect, useRef, useState } from "react";

export function CountUp({ value, duration = 700, format }: {
  value: number | string | undefined;
  duration?: number;
  format?: (n: number) => string;
}) {
  const target = typeof value === "number" ? value : Number.NaN;
  const [display, setDisplay] = useState<number>(Number.isFinite(target) ? target : 0);
  const fromRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(target)) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(target); return;
    }
    fromRef.current = display;
    startRef.current = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - startRef.current) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = fromRef.current + (target - fromRef.current) * eased;
      setDisplay(v);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  if (!Number.isFinite(target)) return <span className="tabular-nums">{value ?? "—"}</span>;
  const rounded = Math.round(display);
  return <span className="tabular-nums">{format ? format(rounded) : rounded.toLocaleString()}</span>;
}
