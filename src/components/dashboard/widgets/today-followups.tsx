import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@tanstack/react-router";
import { Bell, Check, Clock } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { todayFollowupsQuery } from "@/lib/dashboard-queries";
import { WidgetSkeleton } from "../widget-skeleton";

type FU = {
  id: string;
  action: string;
  due_at: string;
  status: string;
  leads: { id: string; lead_code: string; client_name: string } | null;
};

export function TodayFollowups() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isPending } = useQuery({ ...todayFollowupsQuery(), select: (rows) => rows as unknown as FU[] });

  async function complete(fu: FU) {
    setBusy(fu.id);
    const { error } = await supabase.from("follow_ups").update({
      status: "done", completed_at: new Date().toISOString(),
    }).eq("id", fu.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`Marked done: ${fu.action}`, {
      action: {
        label: "Undo",
        onClick: async () => {
          await supabase.from("follow_ups").update({ status: "pending", completed_at: null }).eq("id", fu.id);
          qc.invalidateQueries({ queryKey: ["today-followups"] });
        },
      },
    });
    qc.invalidateQueries({ queryKey: ["today-followups"] });
  }

  async function snooze(fu: FU) {
    setBusy(fu.id);
    const newDue = new Date(Date.now() + 60 * 60_000).toISOString();
    const { error } = await supabase.from("follow_ups").update({ due_at: newDue }).eq("id", fu.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Snoozed for 1 hour");
    qc.invalidateQueries({ queryKey: ["today-followups"] });
  }

  if (isPending && !data) return <WidgetSkeleton rows={4} />;

  return (
    <div className="surface-card p-4 lift-in h-full flex flex-col">
      <div className="flex items-center justify-between mb-3 widget-handle cursor-grab active:cursor-grabbing">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-semibold">Today's follow-ups</h3>
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums">{data?.length ?? 0}</span>
      </div>
      <div className="space-y-1.5 overflow-y-auto flex-1">
        {(!data || data.length === 0) && (
          <div className="text-sm text-muted-foreground py-8 text-center">No follow-ups today 🎉</div>
        )}
        {data?.map((fu) => (
          <div
            key={fu.id}
            className="group flex items-start gap-2 p-2.5 rounded-lg border border-transparent hover:bg-accent/50 hover:border-border transition-colors"
          >
            <Bell className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <Link
              to="/leads/$id"
              params={{ id: fu.leads?.id ?? "" }}
              className="flex-1 min-w-0"
            >
              <div className="text-sm font-medium truncate">{fu.action}</div>
              <div className="text-xs text-muted-foreground truncate">
                {fu.leads?.client_name} · {new Date(fu.due_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            </Link>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => snooze(fu)} disabled={busy === fu.id}
                className="p-1.5 rounded-md hover:bg-warning/15 text-warning"
                title="Snooze 1h"
              >
                <Clock className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => complete(fu)} disabled={busy === fu.id}
                className="p-1.5 rounded-md hover:bg-success/15 text-success"
                title="Mark done"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
