import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Phone, PhoneMissed, PhoneIncoming, Copy, RefreshCcw, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/calls")({
  head: () => ({ meta: [{ title: "Calls — EaseMyOffice CRM" }] }),
  component: CallsPage,
});

interface CallEvent {
  id: string;
  direction: string | null;
  status: string | null;
  caller_number: string | null;
  agent_number: string | null;
  agent_name: string | null;
  duration_sec: number | null;
  call_id: string | null;
  call_time: string | null;
  matched_lead_id: string | null;
  matched_agent_id: string | null;
  created_lead: boolean;
  note: string | null;
  created_at: string;
}

// The public webhook URL is the Supabase project URL + the function path.
const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL ?? ""}/functions/v1/telecmi-webhook`;

function fmtDuration(sec: number | null): string {
  const s = sec ?? 0;
  if (s <= 0) return "—";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

function CallsPage() {
  const [copied, setCopied] = useState(false);

  const { data: events = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["telecmi-call-events"],
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("telecmi_call_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      return (data ?? []) as CallEvent[];
    },
  });

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(WEBHOOK_URL);
      setCopied(true);
      toast.success("Webhook URL copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — select and copy manually");
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold inline-flex items-center gap-2">
            <Phone className="h-5 w-5" /> Calls
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Calls from the TeleCMI helpline are logged here automatically and added to the caller's lead.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCcw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Setup card: the webhook URL to paste into TeleCMI. */}
      <Card className="shadow-sm">
        <CardContent className="p-4 space-y-2">
          <div className="text-sm font-medium">TeleCMI webhook URL</div>
          <p className="text-xs text-muted-foreground">
            Paste this URL into your TeleCMI webhook settings. TeleCMI will send every call event here,
            and the CRM will match the agent (by their profile phone) and the caller (by lead mobile).
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate rounded-md border bg-muted/40 px-3 py-2 text-xs">
              {WEBHOOK_URL || "Set VITE_SUPABASE_URL to see the URL"}
            </code>
            <Button size="sm" variant="outline" onClick={copyUrl} disabled={!WEBHOOK_URL}>
              {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Recent call events. */}
      <Card className="shadow-sm overflow-hidden">
        <CardContent className="p-2">
          {isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Loading calls…</div>
          ) : events.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No call events yet. Once TeleCMI is connected, calls will appear here.
            </div>
          ) : (
            <div className="divide-y">
              {events.map((e) => {
                const missed = (e.status ?? "").toLowerCase() === "missed";
                return (
                  <div key={e.id} className="flex items-center gap-3 px-3 py-3">
                    <div className={`shrink-0 rounded-full p-2 ${missed ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"}`}>
                      {missed ? <PhoneMissed className="h-4 w-4" /> : <PhoneIncoming className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className="truncate">{e.caller_number || "Unknown number"}</span>
                        <Badge variant={missed ? "destructive" : "secondary"} className="text-[10px]">
                          {missed ? "Missed" : "Answered"}
                        </Badge>
                        {e.created_lead && <Badge className="text-[10px]">New lead</Badge>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {e.agent_name ? (missed ? `Missed by ${e.agent_name}` : `Picked by ${e.agent_name}`) : (e.agent_number || "—")}
                        {e.status !== "missed" && e.duration_sec ? ` · ${fmtDuration(e.duration_sec)}` : ""}
                        {e.note ? ` · ${e.note}` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
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
