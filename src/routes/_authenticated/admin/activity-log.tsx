import { createFileRoute } from '@tanstack/react-router'
import { redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useMemo, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  ScrollText, Search, RefreshCcw, ArrowRightLeft, UserCog, Trash2, PlusCircle, PencilLine, Users, BookOpen,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/activity-log")({
  head: () => ({ meta: [{ title: "Activity Log — EaseMyOffice CRM" }] }),
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/login" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
    if (!(roles ?? []).some((r: any) => r.role === "admin")) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: ActivityLogPage,
});

interface AuditRow {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  detail: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

const ACTION_META: Record<string, { label: string; icon: typeof ScrollText; cls: string }> = {
  stage_change: { label: "Stage change", icon: ArrowRightLeft, cls: "text-blue-600 dark:text-blue-400" },
  assign: { label: "Assignment", icon: UserCog, cls: "text-violet-600 dark:text-violet-400" },
  create: { label: "Created", icon: PlusCircle, cls: "text-emerald-600 dark:text-emerald-400" },
  edit: { label: "Edited", icon: PencilLine, cls: "text-amber-600 dark:text-amber-400" },
  delete: { label: "Deleted", icon: Trash2, cls: "text-rose-600 dark:text-rose-400" },
};

const DATE_RANGES = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "all", label: "All time" },
] as const;

function rangeStart(id: string): Date | null {
  const d = new Date();
  if (id === "today") { d.setHours(0, 0, 0, 0); return d; }
  if (id === "7d") return new Date(Date.now() - 7 * 86400_000);
  if (id === "30d") return new Date(Date.now() - 30 * 86400_000);
  return null;
}

function ActivityLogPage() {
  const [q, setQ] = useState("");
  const [action, setAction] = useState<string>("all");
  const [entity, setEntity] = useState<string>("all");
  const [actor, setActor] = useState<string>("all");
  const [range, setRange] = useState<string>("7d");

  // Team members for the actor filter + id→name display.
  const { data: profiles = [] } = useQuery({
    queryKey: ["audit-profiles"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").order("full_name");
      return (data ?? []) as { id: string; full_name: string | null; email: string | null }[];
    },
  });
  const nameOf = (id: string | null) => {
    if (!id) return "System";
    const p = profiles.find((x) => x.id === id);
    return p?.full_name || p?.email || "Unknown user";
  };

  const { data: rows = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["audit-log", range],
    staleTime: 30_000,
    queryFn: async () => {
      let query = supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(1000);
      const start = rangeStart(range);
      if (start) query = query.gte("created_at", start.toISOString());
      const { data } = await query;
      return (data ?? []) as AuditRow[];
    },
  });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (action !== "all" && r.action !== action) return false;
      if (entity !== "all" && r.entity_type !== entity) return false;
      if (actor !== "all" && r.actor_id !== actor) return false;
      if (s) {
        const hay = `${r.entity_label ?? ""} ${r.detail ?? ""} ${nameOf(r.actor_id)}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [rows, q, action, entity, actor, profiles]);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold inline-flex items-center gap-2">
            <ScrollText className="h-5 w-5" /> Activity Log
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Who changed what across leads and bookings — stage moves, assignments, creates, edits and deletes.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCcw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search by client, detail, or user…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={actor} onValueChange={setActor}>
          <SelectTrigger className="w-[170px]"><SelectValue placeholder="All users" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All users</SelectItem>
            {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="All actions" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {Object.keys(ACTION_META).map((a) => <SelectItem key={a} value={a}>{ACTION_META[a].label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={entity} onValueChange={setEntity}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="lead">Leads</SelectItem>
            <SelectItem value="booking">Bookings</SelectItem>
          </SelectContent>
        </Select>
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DATE_RANGES.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card className="shadow-sm overflow-hidden">
        <CardContent className="p-2">
          {isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No activity for these filters.</div>
          ) : (
            <div className="divide-y">
              {filtered.map((r) => {
                const m = ACTION_META[r.action] ?? { label: r.action, icon: ScrollText, cls: "text-muted-foreground" };
                const Icon = m.icon;
                const EntIcon = r.entity_type === "booking" ? BookOpen : Users;
                return (
                  <div key={r.id} className="flex items-start gap-3 px-3 py-3">
                    <div className={`shrink-0 rounded-full bg-muted p-2 ${m.cls}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span className="font-medium">{nameOf(r.actor_id)}</span>
                        <Badge variant="secondary" className="text-[10px]">{m.label}</Badge>
                        <Badge variant="outline" className="text-[10px] inline-flex items-center gap-1">
                          <EntIcon className="h-3 w-3" /> {r.entity_type}
                        </Badge>
                        {r.entity_label ? <span className="text-muted-foreground truncate">· {r.entity_label}</span> : null}
                      </div>
                      {r.detail ? <div className="text-xs text-muted-foreground mt-0.5">{r.detail}</div> : null}
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted-foreground" title={format(new Date(r.created_at), "PPpp")}>
                      {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
