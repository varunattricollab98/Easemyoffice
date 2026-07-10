import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, useRef, useMemo, useLayoutEffect } from "react";
import { track } from "@/lib/analytics";
import { CountUp } from "../count-up";
import { useCelebrateOn } from "../confetti";
import {
  Sparkles,
  Flame,
  TrendingUp,
  TrendingDown,
  CalendarClock,
  CheckCircle2,
  Target,
  ArrowUpRight,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { heroTodayQuery } from "@/lib/dashboard-queries";
import { WidgetSkeleton } from "../widget-skeleton";

const GOAL = 25; // closures per month — could become configurable later

export function HeroToday() {
  const { profile } = useAuth();
  const { data, isPending } = useQuery(heroTodayQuery());

  useCelebrateOn(data?.closures);

  if (isPending && !data) return <WidgetSkeleton rows={3} />;

  const closures = data?.closures ?? 0;
  const pct = Math.min(100, Math.round((closures / GOAL) * 100));
  const remaining = Math.max(0, GOAL - closures);
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = profile?.full_name?.split(" ")[0] ?? "there";

  // SVG progress ring
  const R = 58, C = 2 * Math.PI * R;
  const dash = (C * pct) / 100;

  const delta = data?.delta ?? 0;
  const deltaPositive = delta >= 0;

  const stats = [
    {
      label: "New today",
      value: data?.today ?? 0,
      icon: Flame,
      tone: "text-rose-500",
      sub: delta === 0 ? "same as yesterday" : `${deltaPositive ? "+" : ""}${delta} vs yesterday`,
      subIcon: deltaPositive ? TrendingUp : TrendingDown,
      subTone: deltaPositive ? "text-success" : "text-destructive",
      to: "/leads",
    },
    {
      label: "Hot leads",
      value: data?.hot ?? 0,
      icon: Target,
      tone: "text-amber-500",
      sub: "needs a call",
      to: "/leads",
    },
    {
      label: "Follow-ups today",
      value: data?.dueToday ?? 0,
      icon: CalendarClock,
      tone: "text-primary",
      sub: `${data?.doneToday ?? 0} done so far`,
      to: "/follow-ups",
    },
    {
      label: "Conversion",
      value: `${data?.conversion ?? 0}%`,
      icon: CheckCircle2,
      tone: "text-success",
      sub: `${closures}/${data?.monthLeads ?? 0} this month`,
      to: "/reports",
    },
  ] as const;

  return (
    <div className="surface-card relative overflow-hidden p-5 lift-in h-full">
      <div className="absolute inset-0" style={{ background: "var(--gradient-soft)" }} />

      <div className="relative grid gap-5 md:grid-cols-[auto_1fr] md:items-center">
        {/* Progress ring */}
        <div className="relative shrink-0 grid place-items-center" style={{ width: 140, height: 140 }}>
          <svg width={140} height={140} className="-rotate-90" aria-hidden="true">
            <circle cx={70} cy={70} r={R} stroke="var(--border)" strokeWidth={10} fill="none" />
            <circle
              cx={70} cy={70} r={R} fill="none" strokeWidth={10} strokeLinecap="round"
              stroke="url(#heroGrad)"
              strokeDasharray={`${dash} ${C - dash}`}
              style={{ transition: "stroke-dasharray 900ms cubic-bezier(.22,1,.36,1)" }}
            />
            <defs>
              <linearGradient id="heroGrad" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stopColor="oklch(0.62 0.2 264)" />
                <stop offset="100%" stopColor="oklch(0.7 0.18 200)" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Closures</div>
              <div className="text-3xl font-bold leading-none mt-0.5">
                <CountUp value={closures} />
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">of {GOAL} goal</div>
            </div>
          </div>
        </div>

        {/* Heading + sales stats */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            {greet}, {name}.
          </div>
          <h2 className="mt-1 text-xl md:text-2xl font-semibold tracking-tight">
            {pct >= 100
              ? "Goal smashed — keep the streak alive."
              : `You're ${pct}% to this month's goal.`}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {remaining > 0
              ? `${remaining} more closure${remaining === 1 ? "" : "s"} to hit ${GOAL}.`
              : "Every extra deal from here is bonus."}
          </p>

          {/* Sales stat strip — replaces the bar sparkline */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {stats.map((s) => {
              const SubIcon = "subIcon" in s ? s.subIcon : null;
              return (
                <Link
                  key={s.label}
                  to={s.to}
                  className="group rounded-xl border bg-card/70 backdrop-blur-sm p-2.5 hover:bg-accent/50 hover:-translate-y-0.5 transition-all"
                >
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <s.icon className={`h-3 w-3 ${s.tone}`} />
                      {s.label}
                    </span>
                    <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                  </div>
                  <div className="mt-1 text-xl font-semibold tabular-nums">
                    {typeof s.value === "number" ? <CountUp value={s.value} /> : s.value}
                  </div>
                  <div className={`text-[10px] mt-0.5 flex items-center gap-1 ${"subTone" in s ? s.subTone : "text-muted-foreground"}`}>
                    {SubIcon ? <SubIcon className="h-3 w-3" /> : null}
                    <span className="truncate">{s.sub}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Dual trend — new leads vs closures, with timeframe toggle, tooltips & daily strip */}
      <TrendChart
        newSeries={data?.trendNew ?? []}
        closeSeries={data?.trendClose ?? []}
        dates={data?.trendDates ?? []}
      />
    </div>
  );
}

function TrendChart({
  newSeries,
  closeSeries,
  dates,
}: {
  newSeries: number[];
  closeSeries: number[];
  dates: string[];
}) {
  type Range = 1 | 7 | 14 | 30;
  const [range, setRange] = useState<Range>(14);
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false); // tap-to-show on touch devices
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Slice the tail of the 30-day series to the chosen window.
  const sliced = useMemo(() => {
    const start = Math.max(0, newSeries.length - range);
    return {
      n: newSeries.slice(start),
      c: closeSeries.slice(start),
      d: dates.slice(start),
    };
  }, [newSeries, closeSeries, dates, range]);

  const W = 600, H = 110, P = 10, BOTTOM = 18;
  const n = Math.max(sliced.n.length, sliced.c.length, 2);
  const stepX = (W - P * 2) / (n - 1);
  const max = Math.max(1, ...sliced.n, ...sliced.c);
  const y = (v: number) => H - BOTTOM - (v / max) * (H - BOTTOM - P);

  const toPath = (arr: number[]) => {
    if (!arr.length) return "";
    return arr
      .map((v, i) => {
        const x = P + i * stepX;
        const yy = y(v);
        if (i === 0) return `M ${x} ${yy}`;
        const px = P + (i - 1) * stepX;
        const py = y(arr[i - 1]);
        const cx = (px + x) / 2;
        return `C ${cx} ${py} ${cx} ${yy} ${x} ${yy}`;
      })
      .join(" ");
  };

  const newPath = toPath(sliced.n);
  const closePath = toPath(sliced.c);
  const newArea = newPath ? `${newPath} L ${P + (n - 1) * stepX} ${H - BOTTOM} L ${P} ${H - BOTTOM} Z` : "";

  const idxFromClientX = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    const xRel = ((clientX - rect.left) / rect.width) * W;
    const idx = Math.round((xRel - P) / stepX);
    return Math.max(0, Math.min(n - 1, idx));
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== "mouse") return; // touch handled via tap
    setHover(idxFromClientX(e.clientX));
  };
  const onPointerLeave = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== "mouse") return;
    if (!pinned) setHover(null);
  };
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // Tap-to-show on touch / pen — also keeps focus for keyboard nav.
    const idx = idxFromClientX(e.clientX);
    setHover(idx);
    setPinned(e.pointerType !== "mouse");
    svgRef.current?.focus();
  };

  // Keyboard: Tab to focus, arrows to scrub, Home/End to jump, Enter/Space pin, Esc clear.
  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const cur = hover ?? n - 1;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = Math.max(0, cur - 1);
    else if (e.key === "ArrowRight") next = Math.min(n - 1, cur + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "Enter" || e.key === " ") { setPinned((p) => !p); e.preventDefault(); return; }
    else if (e.key === "Escape") { setHover(null); setPinned(false); return; }
    if (next != null) {
      e.preventDefault();
      setHover(next);
    }
  };

  const fmtDay = (iso: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  const fmtShort = (iso: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: "numeric" });
  };

  const hoverX = hover != null ? P + hover * stepX : 0;
  const hoverLabel =
    hover != null
      ? `${fmtDay(sliced.d[hover] ?? "")}: ${sliced.n[hover] ?? 0} new leads, ${sliced.c[hover] ?? 0} closed`
      : `${range}-day trend chart. Use arrow keys to inspect daily totals.`;

  // Show denser X-axis labels on 30d, but skip alternate to avoid clipping.
  const labelIdxs = (() => {
    if (n <= 1) return [0];
    const ticks = range >= 30 ? 5 : range >= 14 ? 3 : Math.min(n, 3);
    return Array.from({ length: ticks }, (_, i) => Math.round((i * (n - 1)) / (ticks - 1)));
  })();

  return (
    <div className="relative mt-4">
      {/* Header: legend + timeframe toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground mb-1 px-1">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-3 rounded-full bg-primary" /> New leads
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-3 rounded-full bg-success" /> Closures
          </span>
        </div>
        <RangeToggle range={range} onChange={(r) => { setRange(r); setHover(null); setPinned(false); track("hero_chart_range", { range: r }); }} />
      </div>

      {/* Chart */}
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full h-28 md:h-32 touch-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={hoverLabel}
          aria-live="polite"
          role="img"
          tabIndex={0}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          onBlur={() => { if (!pinned) setHover(null); }}
        >
          <defs>
            <linearGradient id="trendArea" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="oklch(0.62 0.2 264)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="oklch(0.62 0.2 264)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line
            x1={P} x2={W - P} y1={H - BOTTOM} y2={H - BOTTOM}
            stroke="var(--border)" strokeWidth="1" strokeDasharray="2 3"
          />
          {newArea && <path key={`a-${range}`} className="trend-area" d={newArea} fill="url(#trendArea)" />}
          {newPath && (
            <path
              key={`n-${range}`}
              className="trend-line"
              d={newPath} fill="none" stroke="oklch(0.62 0.2 264)" strokeWidth="2" strokeLinecap="round"
            />
          )}
          {closePath && (
            <path
              key={`c-${range}`}
              className="trend-area"
              d={closePath} fill="none" stroke="oklch(0.7 0.18 155)"
              strokeWidth="2" strokeLinecap="round" strokeDasharray="3 3"
            />
          )}
          {hover != null && (
            <g pointerEvents="none">
              <line
                x1={hoverX} x2={hoverX} y1={P} y2={H - BOTTOM}
                stroke="var(--ring)" strokeWidth="1" opacity="0.6"
              />
              <circle cx={hoverX} cy={y(sliced.n[hover] ?? 0)} r="3.5" fill="oklch(0.62 0.2 264)" />
              <circle cx={hoverX} cy={y(sliced.c[hover] ?? 0)} r="3.5" fill="oklch(0.7 0.18 155)" />
            </g>
          )}
          {labelIdxs.map((i) => (
            <text
              key={i}
              x={P + i * stepX}
              y={H - 4}
              textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              fontSize="9"
              fill="var(--muted-foreground)"
            >
              {fmtDay(sliced.d[i] ?? "")}
            </text>
          ))}
        </svg>

        {hover != null && (
          <div
            role="tooltip"
            className="pointer-events-none absolute -top-1 -translate-x-1/2 -translate-y-full rounded-md border bg-popover text-popover-foreground shadow-md px-2 py-1 text-[10px] whitespace-nowrap z-10"
            style={{ left: `${(hoverX / W) * 100}%` }}
          >
            <div className="font-medium">{fmtDay(sliced.d[hover] ?? "")}</div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {sliced.n[hover] ?? 0} new
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                {sliced.c[hover] ?? 0} closed
              </span>
            </div>
            {pinned && (
              <div className="text-[9px] text-muted-foreground mt-0.5">tap chart again or press Esc to unpin</div>
            )}
          </div>
        )}
      </div>

      {/* Compact daily totals strip — readable on small screens for Today / 7d / 14d / 30d.
          - Today (n=1): center a single wide card so it doesn't look broken.
          - 7d: comfortable cells, no horizontal scroll.
          - 14d / 30d: scroll-snap with a sensible min cell width so labels stay legible. */}
      {range === 1 ? (
        <div className="mt-3 flex justify-center">
          <div
            role="table"
            aria-label="Today's totals"
            className="grid grid-cols-1 max-w-[220px] w-full rounded-md border bg-card/50 px-3 py-2 text-center"
          >
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {fmtDay(sliced.d[0] ?? new Date().toISOString())}
            </div>
            <div className="mt-1 flex items-center justify-center gap-4">
              <span className="inline-flex items-center gap-1 text-sm">
                <span className="h-2 w-2 rounded-full bg-primary" />
                <span className="font-semibold tabular-nums">{sliced.n[0] ?? 0}</span>
                <span className="text-[10px] text-muted-foreground">new</span>
              </span>
              <span className="inline-flex items-center gap-1 text-sm">
                <span className="h-2 w-2 rounded-full bg-success" />
                <span className="font-semibold tabular-nums">{sliced.c[0] ?? 0}</span>
                <span className="text-[10px] text-muted-foreground">closed</span>
              </span>
            </div>
          </div>
        </div>
      ) : (
      <div className={`mt-3 -mx-1 ${range >= 14 ? "overflow-x-auto" : ""} snap-x`}>
        <div
          className="grid gap-0.5 px-1"
          style={{
            gridTemplateColumns: `repeat(${n}, minmax(${range >= 30 ? 30 : range >= 14 ? 34 : 40}px, 1fr))`,
            minWidth: range >= 30 ? `${n * 30}px` : range >= 14 ? `${n * 34}px` : "100%",
          }}
          role="table"
          aria-label={`Daily totals for the last ${range} days`}
        >
          {sliced.d.map((d: string, i: number) => {
            const isToday = i === n - 1;
            const active = hover === i;
            return (
              <button
                type="button"
                key={d || i}
                role="row"
                aria-label={`${fmtDay(d)}: ${sliced.n[i] ?? 0} new, ${sliced.c[i] ?? 0} closed`}
                onPointerEnter={(e) => { if (e.pointerType === "mouse") setHover(i); }}
                onPointerLeave={(e) => { if (e.pointerType === "mouse" && !pinned) setHover(null); }}
                onClick={() => { setHover(i); setPinned(true); }}
                className={`snap-start text-center rounded-sm py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active ? "bg-accent" : "hover:bg-accent/50"
                } ${isToday ? "ring-1 ring-primary/40" : ""}`}
              >
                <div className="text-[9px] text-muted-foreground leading-none">
                  {fmtShort(d)}
                </div>
                <div className="mt-0.5 text-[10px] font-semibold tabular-nums text-primary leading-none">
                  {sliced.n[i] ?? 0}
                </div>
                <div className="text-[10px] tabular-nums text-success leading-none">
                  {sliced.c[i] ?? 0}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      )}
    </div>
  );
}

type Range = 1 | 7 | 14 | 30;

function RangeToggle({ range, onChange }: { range: Range; onChange: (r: Range) => void }) {
  const ranges: Range[] = [1, 7, 14, 30];
  const containerRef = useRef<HTMLDivElement | null>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const idx = ranges.indexOf(range);
    const btn = btnRefs.current[idx];
    const container = containerRef.current;
    if (!btn || !container) return;
    const cRect = container.getBoundingClientRect();
    const bRect = btn.getBoundingClientRect();
    setPill({ left: bRect.left - cRect.left, width: bRect.width });
    // re-measure when fonts settle
    const t = setTimeout(() => {
      const b = btnRefs.current[idx];
      const c = containerRef.current;
      if (!b || !c) return;
      const cr = c.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      setPill({ left: br.left - cr.left, width: br.width });
    }, 60);
    return () => clearTimeout(t);
  }, [range]);

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label="Trend timeframe"
      className="seg-pill inline-flex rounded-md border bg-card p-0.5"
      style={{ ["--pill-left" as never]: `${pill.left}px`, ["--pill-width" as never]: `${pill.width}px` }}
    >
      {ranges.map((r, i) => (
        <button
          key={r}
          ref={(el) => { btnRefs.current[i] = el; }}
          role="tab"
          aria-selected={range === r}
          onClick={(e) => { e.preventDefault(); onChange(r); }}
          className={`relative z-[1] px-2 py-0.5 text-[10px] rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            range === r ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {r === 1 ? "Today" : `${r}d`}
        </button>
      ))}
    </div>
  );
}