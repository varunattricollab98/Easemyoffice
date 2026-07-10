// Tiny dependency-free confetti burst; called imperatively.
import { useEffect, useRef } from "react";

type Particle = {
  x: number; y: number; vx: number; vy: number; life: number; max: number;
  size: number; color: string; rot: number; vr: number;
};

const COLORS = [
  "oklch(0.7 0.18 264)",
  "oklch(0.72 0.18 152)",
  "oklch(0.78 0.16 75)",
  "oklch(0.72 0.2 27)",
  "oklch(0.74 0.13 230)",
];

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let particles: Particle[] = [];
let raf = 0;

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9999;";
  document.body.appendChild(canvas);
  ctx = canvas.getContext("2d");
  const resize = () => {
    if (!canvas) return;
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
  };
  resize();
  window.addEventListener("resize", resize);
}

function loop() {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const dpr = devicePixelRatio;
  particles = particles.filter((p) => p.life < p.max);
  for (const p of particles) {
    p.vy += 0.18;
    p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life++;
    const alpha = 1 - p.life / p.max;
    ctx.save();
    ctx.translate(p.x * dpr, p.y * dpr);
    ctx.rotate(p.rot);
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size * dpr, -p.size * 0.5 * dpr, p.size * 2 * dpr, p.size * dpr);
    ctx.restore();
  }
  if (particles.length > 0) raf = requestAnimationFrame(loop);
  else raf = 0;
}

export function burstConfetti(originX?: number, originY?: number, count = 80) {
  if (typeof window === "undefined") return;
  if (document.documentElement.classList.contains("quiet")) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  ensureCanvas();
  const x = originX ?? window.innerWidth / 2;
  const y = originY ?? window.innerHeight / 3;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const speed = 4 + Math.random() * 6;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      life: 0, max: 80 + Math.random() * 40,
      size: 3 + Math.random() * 3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
    });
  }
  if (!raf) raf = requestAnimationFrame(loop);
}

// React helper hook to fire on a value increment
export function useCelebrateOn(value: number | undefined) {
  const prev = useRef<number | undefined>(value);
  useEffect(() => {
    if (value === undefined) return;
    if (prev.current !== undefined && value > prev.current) burstConfetti();
    prev.current = value;
  }, [value]);
}
