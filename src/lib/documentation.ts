// Documentation pipeline — stages, TAT and analytics maths.
//
// Pure and framework-free (no Supabase, no React) so every number on the
// Documentation dashboard and in admin analytics comes from one place.
//
// Process (owner, Oct 2026):
//   Sales assigns the booking to a documentation person and emails the client
//   the documents-required list; the booking is also assigned to a space
//   partner (SP). Client sends KYC → team verifies and sends the draft
//   agreement → client approves → team asks the SP for the final agreement →
//   SP sends it, team forwards it to the client for countersign → client sends
//   the countersigned copy → team sends Part B (NOC + utility bill) → done.
//
// TAT: a task is due `tatDays` calendar days after assignment. The DB snapshots
// the deadline into documentation_tasks.due_at at insert, so changing the TAT
// setting never rewrites old tasks.

import type { Database } from "@/integrations/supabase/types";

export type DocStage = Database["public"]["Enums"]["doc_task_stage"];

/** Who the task is waiting on while it sits in a stage. */
export type WaitingOn = "team" | "client" | "sp" | "done";

export interface DocStageDef {
  id: DocStage;
  label: string;
  /** What has to happen next, shown on cards and in the detail sheet. */
  next: string;
  waitingOn: WaitingOn;
  /** Tailwind background class for the stage dot / bar. */
  color: string;
}

export const DOC_STAGES: readonly DocStageDef[] = [
  {
    id: "assigned",
    label: "Assigned",
    next: "Email the client the documents-required list",
    waitingOn: "team",
    color: "bg-slate-500",
  },
  {
    id: "docs_requested",
    label: "Docs Requested",
    next: "Waiting for the client's KYC documents",
    waitingOn: "client",
    color: "bg-sky-500",
  },
  {
    id: "docs_received",
    label: "KYC Verification",
    next: "Verify KYC and send the draft agreement",
    waitingOn: "team",
    color: "bg-cyan-500",
  },
  {
    id: "draft_shared",
    label: "Draft Sent",
    next: "Waiting for the client to approve the draft",
    waitingOn: "client",
    color: "bg-violet-500",
  },
  {
    id: "draft_approved",
    label: "Draft Approved",
    next: "Ask the space partner for the final agreement",
    waitingOn: "team",
    color: "bg-teal-500",
  },
  {
    id: "final_requested",
    label: "With Space Partner",
    next: "Waiting for the space partner's final agreement",
    waitingOn: "sp",
    color: "bg-orange-500",
  },
  {
    id: "agreement_shared",
    label: "Sent for Countersign",
    next: "Waiting for the client's countersigned copy",
    waitingOn: "client",
    color: "bg-amber-500",
  },
  {
    id: "countersigned",
    label: "Countersigned",
    next: "Send Part B — NOC and utility bill",
    waitingOn: "team",
    color: "bg-emerald-500",
  },
  {
    id: "part_b_shared",
    label: "Part B Sent",
    next: "Close once the client has the supporting documents",
    waitingOn: "team",
    color: "bg-indigo-500",
  },
  {
    id: "completed",
    label: "Completed",
    next: "Done",
    waitingOn: "done",
    color: "bg-green-600",
  },
];

export const OPEN_STAGES = DOC_STAGES.filter((s) => s.id !== "completed");

const STAGE_INDEX = new Map(DOC_STAGES.map((s, i) => [s.id, i]));
const STAGE_BY_ID = new Map(DOC_STAGES.map((s) => [s.id, s]));

export const WAITING_ON_LABEL: Record<WaitingOn, string> = {
  team: "Our team",
  client: "Client",
  sp: "Space partner",
  done: "Done",
};

export const DEFAULT_TAT_DAYS = 3;
/** Open tasks sitting in one stage longer than this get flagged as stuck. */
export const DEFAULT_STAGE_ALERT_DAYS = 1;
/** "Due soon" window before the TAT deadline. */
export const DUE_SOON_MS = 24 * 3600_000;

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export function stageDef(stage: DocStage): DocStageDef {
  return STAGE_BY_ID.get(stage) ?? DOC_STAGES[0];
}

export function stageIndex(stage: DocStage): number {
  return STAGE_INDEX.get(stage) ?? 0;
}

export function nextStage(stage: DocStage): DocStage | null {
  const i = stageIndex(stage);
  return i < DOC_STAGES.length - 1 ? DOC_STAGES[i + 1].id : null;
}

export function prevStage(stage: DocStage): DocStage | null {
  const i = stageIndex(stage);
  return i > 0 ? DOC_STAGES[i - 1].id : null;
}

/** Fraction of the pipeline done, 0..1 (completed = 1). */
export function stageProgress(stage: DocStage): number {
  return stageIndex(stage) / (DOC_STAGES.length - 1);
}

/** Parses a settings value (JSON number or numeric string) into a whole number of days. */
export function parseDays(value: unknown, fallback: number, max = 60): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.round(n)));
}

// ─── TAT ─────────────────────────────────────────────────────────────────────

/** The fields every calculation needs. Matches documentation_tasks columns. */
export interface DocTaskCore {
  id: string;
  stage: DocStage;
  assigned_to: string;
  created_at: string;
  due_at: string;
  stage_changed_at: string;
  completed_at: string | null;
  escalated?: boolean | null;
}

export type TatState = "on_track" | "due_soon" | "overdue" | "met" | "missed";

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

export function isOpen(t: Pick<DocTaskCore, "stage">): boolean {
  return t.stage !== "completed";
}

export function tatState(t: DocTaskCore, now: number): TatState {
  const due = ms(t.due_at);
  if (!isOpen(t)) {
    const done = ms(t.completed_at);
    return Number.isFinite(done) && done > due ? "missed" : "met";
  }
  if (now > due) return "overdue";
  if (due - now <= DUE_SOON_MS) return "due_soon";
  return "on_track";
}

/** Time from assignment to completion; null while open. */
export function completionMs(t: DocTaskCore): number | null {
  if (isOpen(t)) return null;
  const done = ms(t.completed_at);
  const start = ms(t.created_at);
  return Number.isFinite(done) && Number.isFinite(start) ? Math.max(0, done - start) : null;
}

/** How long the task has been in its current stage. */
export function stageAgeMs(t: DocTaskCore, now: number): number {
  const since = ms(t.stage_changed_at);
  return Number.isFinite(since) ? Math.max(0, now - since) : 0;
}

export function isStuck(t: DocTaskCore, now: number, stageAlertDays: number): boolean {
  return isOpen(t) && stageAgeMs(t, now) > stageAlertDays * DAY;
}

/** "2d 4h", "5h", "35m", "<1m". */
export function formatDuration(msValue: number): string {
  const v = Math.abs(msValue);
  if (v < 60_000) return "<1m";
  const d = Math.floor(v / DAY);
  const h = Math.floor((v % DAY) / HOUR);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  const m = Math.floor((v % HOUR) / 60_000);
  if (h > 0) return m > 0 && h < 6 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** Days with one decimal, for KPI cards: 2.4. */
export function toDays(msValue: number | null): number | null {
  return msValue == null ? null : Math.round((msValue / DAY) * 10) / 10;
}

/** Short human TAT label for a chip. */
export function tatLabel(t: DocTaskCore, now: number): string {
  const state = tatState(t, now);
  const due = ms(t.due_at);
  if (state === "met" || state === "missed") {
    const c = completionMs(t);
    return `Done in ${c == null ? "—" : formatDuration(c)}`;
  }
  if (state === "overdue") return `Overdue ${formatDuration(now - due)}`;
  return `${formatDuration(due - now)} left`;
}

// ─── Summaries ───────────────────────────────────────────────────────────────

export interface StageBucket {
  stage: DocStage;
  count: number;
  overdue: number;
  stuck: number;
  avgAgeMs: number | null;
}

export interface DocSummary {
  open: number;
  overdue: number;
  dueSoon: number;
  stuck: number;
  escalated: number;
  /** Completed tasks among `tasks`. */
  completed: number;
  completedOnTime: number;
  /** completedOnTime / completed, null when nothing completed. */
  onTimeRate: number | null;
  avgCompletionMs: number | null;
  medianCompletionMs: number | null;
  byStage: StageBucket[];
  waitingOn: Record<Exclude<WaitingOn, "done">, number>;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function summarizeDocs(
  tasks: DocTaskCore[],
  now: number,
  stageAlertDays = DEFAULT_STAGE_ALERT_DAYS,
): DocSummary {
  const ages = new Map<DocStage, number[]>();
  const buckets = new Map<DocStage, StageBucket>(
    DOC_STAGES.map((s) => [s.id, { stage: s.id, count: 0, overdue: 0, stuck: 0, avgAgeMs: null }]),
  );
  const waitingOn = { team: 0, client: 0, sp: 0 };
  const durations: number[] = [];
  let open = 0;
  let overdue = 0;
  let dueSoon = 0;
  let stuck = 0;
  let escalated = 0;
  let completed = 0;
  let completedOnTime = 0;

  for (const t of tasks) {
    const b = buckets.get(t.stage);
    if (b) b.count++;
    const state = tatState(t, now);
    if (isOpen(t)) {
      open++;
      if (state === "overdue") {
        overdue++;
        if (b) b.overdue++;
      }
      if (state === "due_soon") dueSoon++;
      if (isStuck(t, now, stageAlertDays)) {
        stuck++;
        if (b) b.stuck++;
      }
      if (t.escalated) escalated++;
      const w = stageDef(t.stage).waitingOn;
      if (w !== "done") waitingOn[w]++;
      const list = ages.get(t.stage) ?? [];
      list.push(stageAgeMs(t, now));
      ages.set(t.stage, list);
    } else {
      completed++;
      if (state === "met") completedOnTime++;
      const c = completionMs(t);
      if (c != null) durations.push(c);
    }
  }

  for (const [stage, list] of ages) {
    const b = buckets.get(stage);
    if (b) b.avgAgeMs = mean(list);
  }

  return {
    open,
    overdue,
    dueSoon,
    stuck,
    escalated,
    completed,
    completedOnTime,
    onTimeRate: completed ? completedOnTime / completed : null,
    avgCompletionMs: mean(durations),
    medianCompletionMs: median(durations),
    byStage: DOC_STAGES.map((s) => buckets.get(s.id)!),
    waitingOn,
  };
}

/** Open tasks that need attention first: overdue, then due soon, then stuck, by deadline. */
export function attentionQueue<T extends DocTaskCore>(
  tasks: T[],
  now: number,
  stageAlertDays = DEFAULT_STAGE_ALERT_DAYS,
): T[] {
  const rank = (t: T) => {
    const s = tatState(t, now);
    if (s === "overdue") return 0;
    if (s === "due_soon") return 1;
    if (isStuck(t, now, stageAlertDays) || t.escalated) return 2;
    return 3;
  };
  return tasks
    .filter((t) => isOpen(t) && rank(t) < 3)
    .sort((a, b) => rank(a) - rank(b) || ms(a.due_at) - ms(b.due_at));
}

// ─── Per person ──────────────────────────────────────────────────────────────

export interface AssigneeStats {
  assigneeId: string;
  assigned: number;
  open: number;
  overdue: number;
  completed: number;
  completedOnTime: number;
  onTimeRate: number | null;
  avgCompletionMs: number | null;
}

export function perAssignee(tasks: DocTaskCore[], now: number): AssigneeStats[] {
  const groups = new Map<string, DocTaskCore[]>();
  for (const t of tasks) {
    const list = groups.get(t.assigned_to) ?? [];
    list.push(t);
    groups.set(t.assigned_to, list);
  }
  return [...groups.entries()]
    .map(([assigneeId, list]) => {
      const s = summarizeDocs(list, now);
      return {
        assigneeId,
        assigned: list.length,
        open: s.open,
        overdue: s.overdue,
        completed: s.completed,
        completedOnTime: s.completedOnTime,
        onTimeRate: s.onTimeRate,
        avgCompletionMs: s.avgCompletionMs,
      };
    })
    .sort((a, b) => b.assigned - a.assigned);
}

// ─── Time per stage (from stage history) ─────────────────────────────────────

export interface DocStageEvent {
  task_id: string;
  from_stage: DocStage | null;
  to_stage: DocStage;
  changed_at: string;
  backfilled?: boolean | null;
}

export interface StageDuration {
  stage: DocStage;
  /** Average time a task spent in this stage (finished visits only). */
  avgMs: number | null;
  /** Finished visits measured. */
  samples: number;
}

/**
 * Average time spent in each stage, measured between consecutive history
 * events of the same task. The current, unfinished visit is not counted (it is
 * reported as stage age instead). Visits bounded by a back-filled event are
 * skipped: back-fill collapses several real stages into one jump.
 */
export function stageDurations(events: DocStageEvent[]): StageDuration[] {
  const byTask = new Map<string, DocStageEvent[]>();
  for (const e of events) {
    const list = byTask.get(e.task_id) ?? [];
    list.push(e);
    byTask.set(e.task_id, list);
  }
  const samples = new Map<DocStage, number[]>();
  for (const list of byTask.values()) {
    list.sort((a, b) => ms(a.changed_at) - ms(b.changed_at));
    for (let i = 0; i < list.length - 1; i++) {
      const cur = list[i];
      const nxt = list[i + 1];
      if (cur.backfilled || nxt.backfilled) continue;
      if (cur.to_stage === "completed") continue;
      const d = ms(nxt.changed_at) - ms(cur.changed_at);
      if (!Number.isFinite(d) || d < 0) continue;
      const arr = samples.get(cur.to_stage) ?? [];
      arr.push(d);
      samples.set(cur.to_stage, arr);
    }
  }
  return OPEN_STAGES.map((s) => {
    const arr = samples.get(s.id) ?? [];
    return { stage: s.id, avgMs: mean(arr), samples: arr.length };
  });
}

// ─── Trend ───────────────────────────────────────────────────────────────────

export interface TrendPoint {
  /** Local midnight of the bucket's first day (ms). */
  start: number;
  label: string;
  assigned: number;
  completed: number;
  onTime: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function startOfLocalDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Monday 00:00 local of the week containing `t`. */
export function startOfWeekMonday(t: number): number {
  const d = new Date(startOfLocalDay(t));
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d.getTime();
}

/**
 * Assigned vs completed (and completed on time) per bucket over [from, now].
 * Uses daily buckets for ranges up to 31 days, weekly beyond that.
 */
export function docTrend(tasks: DocTaskCore[], from: number, now: number): TrendPoint[] {
  const daily = now - from <= 31 * DAY;
  const bucketStart = daily ? startOfLocalDay : startOfWeekMonday;
  const points: TrendPoint[] = [];
  const index = new Map<number, TrendPoint>();
  for (let t = bucketStart(from); t <= now; ) {
    const d = new Date(t);
    const p: TrendPoint = {
      start: t,
      label: `${d.getDate()} ${MONTHS[d.getMonth()]}`,
      assigned: 0,
      completed: 0,
      onTime: 0,
    };
    points.push(p);
    index.set(t, p);
    d.setDate(d.getDate() + (daily ? 1 : 7));
    t = d.getTime();
  }
  for (const task of tasks) {
    const created = ms(task.created_at);
    if (created >= from && created <= now) {
      const p = index.get(bucketStart(created));
      if (p) p.assigned++;
    }
    const done = isOpen(task) ? NaN : ms(task.completed_at);
    if (Number.isFinite(done) && done >= from && done <= now) {
      const p = index.get(bucketStart(done));
      if (p) {
        p.completed++;
        if (tatState(task, now) === "met") p.onTime++;
      }
    }
  }
  return points;
}

// ─── Period ──────────────────────────────────────────────────────────────────

export type DocPeriod = "7d" | "30d" | "this_month" | "90d" | "all";

export const DOC_PERIODS: { id: DocPeriod; label: string }[] = [
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "this_month", label: "This month" },
  { id: "90d", label: "Last 90 days" },
  { id: "all", label: "All time" },
];

/** Start of the period (ms). "all" starts at the earliest task, or 90 days back. */
export function periodFrom(period: DocPeriod, now: number, tasks: DocTaskCore[] = []): number {
  switch (period) {
    case "7d":
      return startOfLocalDay(now - 6 * DAY);
    case "30d":
      return startOfLocalDay(now - 29 * DAY);
    case "90d":
      return startOfLocalDay(now - 89 * DAY);
    case "this_month": {
      const d = new Date(now);
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    }
    case "all": {
      const earliest = tasks.reduce((m, t) => Math.min(m, ms(t.created_at)), Infinity);
      return Number.isFinite(earliest)
        ? startOfLocalDay(earliest)
        : startOfLocalDay(now - 89 * DAY);
    }
  }
}

/**
 * Tasks relevant to a period for completion metrics: assigned in the period OR
 * completed in it. Open-pipeline metrics (open/overdue/by stage) are always a
 * live snapshot and should use the full task list instead.
 */
export function tasksInPeriod<T extends DocTaskCore>(tasks: T[], from: number, now: number): T[] {
  return tasks.filter((t) => {
    const c = ms(t.created_at);
    const d = ms(t.completed_at);
    return (c >= from && c <= now) || (d >= from && d <= now);
  });
}

/** Completed-in-period subset used for on-time % and average TAT. */
export function completedInPeriod<T extends DocTaskCore>(
  tasks: T[],
  from: number,
  now: number,
): T[] {
  return tasks.filter((t) => {
    if (isOpen(t)) return false;
    const d = ms(t.completed_at);
    return d >= from && d <= now;
  });
}
