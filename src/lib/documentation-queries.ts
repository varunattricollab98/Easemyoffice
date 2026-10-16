// Data access for the Documentation pipeline (dashboard, board, analytics).
//
// RLS decides what comes back: admins get every task, a documentation person
// only the tasks assigned to them (documentation_tasks_select in
// 20260514000001), so the same helpers serve both views. The maths lives in
// src/lib/documentation.ts — these helpers only move data.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_STAGE_ALERT_DAYS,
  DEFAULT_TAT_DAYS,
  parseDays,
  stageDef,
  type DocStage,
  type DocStageEvent,
  type DocTaskCore,
} from "@/lib/documentation";

export interface DocBooking {
  id: string;
  booking_code: string | null;
  external_booking_id: string | null;
  booking_date: string | null;
  client_name: string | null;
  business_name: string | null;
  contact_no: string | null;
  email_id: string | null;
  plan_name: string | null;
  sp_name: string | null;
  area: string | null;
  city: string | null;
  state: string | null;
  sales_agent_name: string | null;
}

export interface DocTaskRow extends DocTaskCore {
  booking_id: string;
  assigned_by: string | null;
  notes: string | null;
  updated_at: string;
  escalated: boolean;
  escalation_reason: string | null;
  escalated_at: string | null;
  bookings: DocBooking | null;
  assignee_name: string | null;
  assigned_by_name: string | null;
}

export interface DocEventRow extends DocStageEvent {
  id: string;
  changed_by: string | null;
}

export interface DocSettings {
  tatDays: number;
  stageAlertDays: number;
}

export interface DocTeamMember {
  id: string;
  full_name: string | null;
  email: string | null;
}

const PAGE = 1000;

const TASK_SELECT =
  "id, booking_id, assigned_to, assigned_by, stage, notes, created_at, updated_at, due_at, stage_changed_at, completed_at, escalated, escalation_reason, escalated_at, " +
  "bookings(id, booking_code, external_booking_id, booking_date, client_name, business_name, contact_no, email_id, plan_name, sp_name, area, city, state, sales_agent_name)";

/** Reads every page so PostgREST's 1000-row cap never silently truncates. */
async function fetchAllPages<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function profileNames(ids: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", unique);
  return new Map((data ?? []).map((p) => [p.id, p.full_name || p.email]));
}

export async function fetchDocTasks(): Promise<DocTaskRow[]> {
  const rows = await fetchAllPages<DocTaskRow>((from, to) =>
    supabase
      .from("documentation_tasks")
      .select(TASK_SELECT)
      .order("created_at", { ascending: false })
      .range(from, to),
  );
  const names = await profileNames(rows.flatMap((r) => [r.assigned_to, r.assigned_by ?? ""]));
  for (const r of rows) {
    r.assignee_name = names.get(r.assigned_to) ?? null;
    r.assigned_by_name = r.assigned_by ? (names.get(r.assigned_by) ?? null) : null;
  }
  return rows;
}

export async function fetchDocEvents(): Promise<DocEventRow[]> {
  return fetchAllPages<DocEventRow>((from, to) =>
    supabase
      .from("documentation_stage_events")
      .select("id, task_id, from_stage, to_stage, changed_by, changed_at, backfilled")
      .order("changed_at", { ascending: true })
      .range(from, to),
  );
}

export async function fetchTaskEvents(
  taskId: string,
): Promise<(DocEventRow & { changed_by_name: string | null })[]> {
  const { data, error } = await supabase
    .from("documentation_stage_events")
    .select("id, task_id, from_stage, to_stage, changed_by, changed_at, backfilled")
    .eq("task_id", taskId)
    .order("changed_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as DocEventRow[];
  const names = await profileNames(rows.map((r) => r.changed_by ?? ""));
  return rows.map((r) => ({
    ...r,
    changed_by_name: r.changed_by ? (names.get(r.changed_by) ?? null) : null,
  }));
}

export async function fetchDocSettings(): Promise<DocSettings> {
  const { data } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", ["doc_tat_days", "doc_escalation_days"]);
  const map = new Map((data ?? []).map((r) => [r.key, r.value as unknown]));
  return {
    tatDays: parseDays(map.get("doc_tat_days"), DEFAULT_TAT_DAYS),
    stageAlertDays: parseDays(map.get("doc_escalation_days"), DEFAULT_STAGE_ALERT_DAYS),
  };
}

export async function fetchDocTeam(): Promise<DocTeamMember[]> {
  const { data } = await supabase.from("user_roles").select("user_id").eq("role", "documentation");
  const ids = (data ?? []).map((r) => r.user_id);
  if (!ids.length) return [];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", ids)
    .order("full_name", { ascending: true });
  return profiles ?? [];
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

export const DOC_KEYS = {
  tasks: ["doc-pipeline", "tasks"] as const,
  events: ["doc-pipeline", "events"] as const,
  taskEvents: (id: string) => ["doc-pipeline", "events", id] as const,
  settings: ["doc-pipeline", "settings"] as const,
  team: ["documentation-team-users"] as const,
};

export function useDocTasks() {
  return useQuery({
    queryKey: DOC_KEYS.tasks,
    queryFn: fetchDocTasks,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useDocEvents(enabled = true) {
  return useQuery({
    queryKey: DOC_KEYS.events,
    queryFn: fetchDocEvents,
    enabled,
    staleTime: 60_000,
  });
}

export function useTaskEvents(taskId: string | null) {
  return useQuery({
    queryKey: DOC_KEYS.taskEvents(taskId ?? ""),
    queryFn: () => fetchTaskEvents(taskId!),
    enabled: !!taskId,
  });
}

export function useDocSettings() {
  return useQuery({
    queryKey: DOC_KEYS.settings,
    queryFn: fetchDocSettings,
    staleTime: 5 * 60_000,
  });
}

export function useDocTeam(enabled = true) {
  return useQuery({
    queryKey: DOC_KEYS.team,
    queryFn: fetchDocTeam,
    enabled,
    staleTime: 5 * 60_000,
  });
}

function invalidateDocs(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["doc-pipeline"] });
  qc.invalidateQueries({ queryKey: ["doc-dashboard-tasks"] });
  qc.invalidateQueries({ queryKey: ["documentation-tasks"] });
}

/** Stage move with an optimistic update so the board never jumps back. */
export function useMoveDocStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, stage }: { taskId: string; stage: DocStage }) => {
      const { error } = await supabase
        .from("documentation_tasks")
        .update({ stage })
        .eq("id", taskId);
      if (error) throw new Error(error.message);
    },
    onMutate: async ({ taskId, stage }) => {
      await qc.cancelQueries({ queryKey: DOC_KEYS.tasks });
      const prev = qc.getQueryData<DocTaskRow[]>(DOC_KEYS.tasks);
      const nowIso = new Date().toISOString();
      qc.setQueryData<DocTaskRow[]>(DOC_KEYS.tasks, (rows) =>
        rows?.map((r) =>
          r.id === taskId
            ? {
                ...r,
                stage,
                stage_changed_at: nowIso,
                completed_at: stage === "completed" ? (r.completed_at ?? nowIso) : null,
              }
            : r,
        ),
      );
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(DOC_KEYS.tasks, ctx.prev);
      toast.error("Could not move: " + e.message);
    },
    onSuccess: (_d, { stage }) => toast.success(`Moved to ${stageDef(stage).label}`),
    onSettled: () => invalidateDocs(qc),
  });
}

export function useUpdateDocTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      taskId,
      patch,
    }: {
      taskId: string;
      patch: {
        notes?: string | null;
        escalated?: boolean;
        escalation_reason?: string | null;
        escalated_at?: string | null;
        assigned_to?: string;
      };
    }) => {
      const { error } = await supabase.from("documentation_tasks").update(patch).eq("id", taskId);
      if (error) throw new Error(error.message);
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => invalidateDocs(qc),
  });
}

export function useSaveDocSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: DocSettings) => {
      const { data: auth } = await supabase.auth.getUser();
      const now = new Date().toISOString();
      const { error } = await supabase.from("app_settings").upsert(
        [
          {
            key: "doc_tat_days",
            value: s.tatDays,
            updated_by: auth.user?.id ?? null,
            updated_at: now,
          },
          {
            key: "doc_escalation_days",
            value: s.stageAlertDays,
            updated_by: auth.user?.id ?? null,
            updated_at: now,
          },
        ],
        { onConflict: "key" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Documentation settings saved");
      qc.invalidateQueries({ queryKey: DOC_KEYS.settings });
      qc.invalidateQueries({ queryKey: ["doc-escalation-days"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Per-booking file (Bookings list) ─────────────────────────────────────────

export interface BookingDocTask extends DocTaskCore {
  booking_id: string;
  assignee_name: string | null;
}

/**
 * Documentation file per booking, for the Bookings list. RLS returns only the
 * files the viewer may see (admin: all; sales: bookings they own or assigned).
 */
export function useBookingDocTasks() {
  return useQuery({
    queryKey: ["doc-pipeline", "by-booking"],
    staleTime: 30_000,
    queryFn: async (): Promise<Map<string, BookingDocTask>> => {
      const { data, error } = await supabase
        .from("documentation_tasks")
        .select(
          "id, booking_id, assigned_to, stage, created_at, due_at, stage_changed_at, completed_at, escalated",
        )
        .limit(5000);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as BookingDocTask[];
      const ids = [...new Set(rows.map((r) => r.assigned_to))];
      const names = new Map<string, string | null>();
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", ids);
        for (const p of profs ?? []) names.set(p.id, p.full_name || p.email);
      }
      return new Map(
        rows.map((r) => [r.booking_id, { ...r, assignee_name: names.get(r.assigned_to) ?? null }]),
      );
    },
  });
}

// ─── Assignment email ────────────────────────────────────────────────────────

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Emails the documentation person the booking details when a booking is
 * assigned (or re-assigned) to them. The in-CRM notification comes from the
 * notify_documentation_assignment DB trigger; this is the inbox copy. Never
 * throws — a failed email must not undo the assignment.
 */
export async function emailDocAssignee(bookingId: string, assigneeId: string): Promise<boolean> {
  try {
    const [{ data: booking }, { data: assignee }, settings] = await Promise.all([
      supabase
        .from("bookings")
        .select(
          "booking_code, external_booking_id, booking_date, client_name, business_name, contact_no, email_id, plan_name, sp_name, area, city, state, sales_agent_name",
        )
        .eq("id", bookingId)
        .maybeSingle(),
      supabase.from("profiles").select("full_name, email").eq("id", assigneeId).maybeSingle(),
      fetchDocSettings(),
    ]);
    if (!assignee?.email) return false;
    const b = booking ?? ({} as Partial<DocBooking>);
    const due = new Date(Date.now() + settings.tatDays * 24 * 3600_000).toLocaleDateString(
      "en-IN",
      {
        day: "numeric",
        month: "short",
        year: "numeric",
      },
    );
    const appUrl = typeof window !== "undefined" ? window.location.origin : "";
    const rows: [string, unknown][] = [
      ["Booking ID", b.external_booking_id || b.booking_code],
      ["Booking date", b.booking_date],
      ["Client", b.client_name],
      ["Business", b.business_name],
      ["Phone", b.contact_no],
      ["Email", b.email_id],
      ["Plan", b.plan_name],
      ["Space partner", b.sp_name],
      ["Location", [b.area, b.city, b.state].filter(Boolean).join(", ")],
      ["Sales agent", b.sales_agent_name],
      ["TAT due", `${due} (${settings.tatDays} days)`],
    ];
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
<p>Hi ${esc(assignee.full_name || "there")},</p>
<p>A new booking has been assigned to you for documentation.</p>
<table cellpadding="6" style="border-collapse:collapse;border:1px solid #e5e7eb">
${rows
  .filter(([, v]) => v)
  .map(
    ([k, v]) =>
      `<tr><td style="border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">${esc(k)}</td><td style="border:1px solid #e5e7eb">${esc(v)}</td></tr>`,
  )
  .join("\n")}
</table>
${appUrl ? `<p><a href="${esc(appUrl)}/documentation">Open the Documentation pipeline</a></p>` : ""}
</div>`;
    const { data, error } = await supabase.functions.invoke("send-client-email", {
      body: {
        to: assignee.email,
        subject: `New documentation: ${b.business_name || b.client_name || "booking"} (${b.external_booking_id || b.booking_code || ""})`,
        html,
        from: "EaseMyOffice Documentation <team@easemyoffice.in>",
        booking_id: bookingId,
      },
    });
    return !error && !(data as { error?: string } | null)?.error;
  } catch {
    return false;
  }
}
