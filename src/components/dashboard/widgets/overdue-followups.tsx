import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Check, Clock, CheckSquare, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { overdueFollowupsQuery } from "@/lib/dashboard-queries";
import { WidgetSkeleton } from "../widget-skeleton";

type FU = {
  id: string;
  action: string;
  due_at: string;
  leads: { id: string; client_name: string } | null;
};

export function OverdueFollowups() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const { data, isPending } = useQuery({ ...overdueFollowupsQuery(), select: (rows) => rows as unknown as FU[] });

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const allSelected = data && data.length > 0 && selected.size === data.length;
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set((data ?? []).map((d) => d.id)));
  };

  const ids = () => Array.from(selected);

  const bulkSnooze = async () => {
    if (!selected.size) return;
    setBusy(true);
    const newDue = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const { error } = await supabase.from("follow_ups").update({ due_at: newDue }).in("id", ids());
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Snoozed ${selected.size} follow-up(s) by 1 day`);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["overdue-followups"] });
    qc.invalidateQueries({ queryKey: ["today-followups"] });
    qc.invalidateQueries({ queryKey: ["needs-attention"] });
  };

  const bulkDone = async () => {
    if (!selected.size) return;
    setBusy(true);
    const { error } = await supabase
      .from("follow_ups")
      .update({ status: "done", completed_at: new Date().toISOString() })
      .in("id", ids());
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Marked ${selected.size} done`);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["overdue-followups"] });
    qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    qc.invalidateQueries({ queryKey: ["needs-attention"] });
  };

  if (isPending && !data) return <WidgetSkeleton rows={5} />;

  return (
    <section
      className="surface-card p-4 lift-in h-full flex flex-col"
      aria-label="Overdue follow-ups"
    >
      <div className="flex items-center justify-between mb-3 widget-handle cursor-grab active:cursor-grabbing gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
          <h3 className="text-sm font-semibold truncate">Overdue follow-ups</h3>
          <span className="text-[11px] text-muted-foreground tabular-nums">{data?.length ?? 0}</span>
        </div>
        <button
          onClick={toggleAll}
          className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          aria-label={allSelected ? "Deselect all overdue follow-ups" : "Select all overdue follow-ups"}
        >
          {allSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          {allSelected ? "None" : "All"}
        </button>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-2 p-2 rounded-lg bg-accent/40 border" role="toolbar" aria-label="Bulk actions">
          <span className="text-xs font-medium">{selected.size} selected</span>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={bulkSnooze} disabled={busy}>
            <Clock className="h-3.5 w-3.5" /> Snooze 1d
          </Button>
          <Button size="sm" onClick={bulkDone} disabled={busy}>
            <Check className="h-3.5 w-3.5" /> Done
          </Button>
        </div>
      )}

      <ul className="space-y-1 overflow-y-auto flex-1" role="list">
        {(!data || data.length === 0) && (
          <li className="text-sm text-muted-foreground py-8 text-center list-none">
            🎉 No overdue follow-ups.
          </li>
        )}
        {data?.map((fu) => {
          const checked = selected.has(fu.id);
          return (
            <li
              key={fu.id}
              className={`flex items-center gap-2 p-2 rounded-lg border transition-colors ${
                checked ? "bg-accent/60 border-primary/40" : "border-transparent hover:bg-accent/40"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(fu.id)}
                aria-label={`Select follow-up: ${fu.action}`}
                className="size-4 accent-primary cursor-pointer"
              />
              <Link
                to="/leads/$id"
                params={{ id: fu.leads?.id ?? "" }}
                className="flex-1 min-w-0"
              >
                <div className="text-sm font-medium truncate">{fu.action}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {fu.leads?.client_name} · overdue {formatDistanceToNow(new Date(fu.due_at), { addSuffix: true })}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
