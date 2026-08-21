import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Phone,
  Mail,
  MessageSquare,
  StickyNote,
  ArrowRightLeft,
  Search,
  Calendar,
  Bell,
  type LucideIcon,
} from "lucide-react";
import { useState, useMemo } from "react";
import { formatDistanceToNow, format, isToday, isYesterday } from "date-fns";

export const Route = createFileRoute("/_authenticated/activity")({
  head: () => ({ meta: [{ title: "Activity — EaseMyOffice CRM" }] }),
  component: ActivityPage,
});

type Activity = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  lead_id: string;
  actor_id: string | null;
  created_at: string;
  payload: Record<string, unknown>;
};

const TYPE_CONFIG: Record<
  string,
  { icon: LucideIcon; label: string; gradient: string; ring: string; dot: string }
> = {
  call: {
    icon: Phone,
    label: "Call",
    gradient: "from-blue-500 to-blue-600",
    ring: "ring-blue-200 dark:ring-blue-900",
    dot: "bg-blue-500",
  },
  email: {
    icon: Mail,
    label: "Email",
    gradient: "from-violet-500 to-purple-600",
    ring: "ring-violet-200 dark:ring-violet-900",
    dot: "bg-violet-500",
  },
  whatsapp: {
    icon: MessageSquare,
    label: "WhatsApp",
    gradient: "from-emerald-500 to-green-600",
    ring: "ring-emerald-200 dark:ring-emerald-900",
    dot: "bg-emerald-500",
  },
  note: {
    icon: StickyNote,
    label: "Note",
    gradient: "from-amber-500 to-orange-500",
    ring: "ring-amber-200 dark:ring-amber-900",
    dot: "bg-amber-500",
  },
  stage_change: {
    icon: ArrowRightLeft,
    label: "Stage",
    gradient: "from-cyan-500 to-teal-600",
    ring: "ring-cyan-200 dark:ring-cyan-900",
    dot: "bg-cyan-500",
  },
  followup: {
    icon: Bell,
    label: "Follow-up",
    gradient: "from-rose-500 to-pink-600",
    ring: "ring-rose-200 dark:ring-rose-900",
    dot: "bg-rose-500",
  },
  reminder: {
    icon: Calendar,
    label: "Reminder",
    gradient: "from-indigo-500 to-blue-600",
    ring: "ring-indigo-200 dark:ring-indigo-900",
    dot: "bg-indigo-500",
  },
};

const DEFAULT_CONFIG = {
  icon: StickyNote,
  label: "Activity",
  gradient: "from-slate-500 to-slate-600",
  ring: "ring-slate-200 dark:ring-slate-900",
  dot: "bg-slate-500",
};

function dateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEEE, d MMM yyyy");
}

function ActivityPage() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState<string>("all");
  const [dateRange, setDateRange] = useState<string>("7d");

  const { data: activities = [], isLoading } = useQuery({
    queryKey: ["activity-feed"],
    queryFn: async () => {
      const { data } = await supabase
        .from("lead_activities")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      return (data ?? []) as Activity[];
    },
  });

  const { data: leads = [] } = useQuery({
    queryKey: ["activity-leads"],
    queryFn: async () => {
      const { data } = await supabase
        .from("leads")
        .select("id, lead_code, client_name, company_name")
        .limit(1000);
      return data ?? [];
    },
  });

  const leadMap = useMemo(
    () => new Map(leads.map((l: any) => [l.id, l])),
    [leads],
  );

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    // Date range filter
    const now = new Date();
    let rangeStart: Date | null = null;
    switch (dateRange) {
      case "today": rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
      case "yesterday": rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1); break;
      case "7d": rangeStart = new Date(now.getTime() - 7 * 86400000); break;
      case "30d": rangeStart = new Date(now.getTime() - 30 * 86400000); break;
      case "90d": rangeStart = new Date(now.getTime() - 90 * 86400000); break;
      default: rangeStart = null; // "all" = no date filter
    }

    return activities.filter((a) => {
      // Date filter
      if (rangeStart && new Date(a.created_at) < rangeStart) return false;
      // Type filter
      if (type !== "all" && a.type !== type) return false;
      // Search filter
      if (!t) return true;
      const lead: any = leadMap.get(a.lead_id);
      return (
        a.title.toLowerCase().includes(t) ||
        (a.body ?? "").toLowerCase().includes(t) ||
        (lead?.client_name ?? "").toLowerCase().includes(t)
      );
    });
  }, [activities, search, type, leadMap, dateRange]);

  // Group by date for timeline sections
  const grouped = useMemo(() => {
    const groups: { label: string; items: Activity[] }[] = [];
    let currentLabel = "";
    for (const a of filtered) {
      const label = dateLabel(a.created_at);
      if (label !== currentLabel) {
        currentLabel = label;
        groups.push({ label, items: [a] });
      } else {
        groups[groups.length - 1].items.push(a);
      }
    }
    return groups;
  }, [filtered]);

  // Activity type stats
  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of activities) {
      counts[a.type] = (counts[a.type] || 0) + 1;
    }
    return counts;
  }, [activities]);

  return (
    <div className="p-5 md:p-10 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Activity</h1>
          <p className="text-sm text-muted-foreground">
            Live feed of calls, emails, WhatsApp, notes &amp; stage changes.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Calendar className="h-4 w-4" />
          <span>{activities.length} activities</span>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {Object.entries(TYPE_CONFIG).map(([key, cfg]) => {
          const count = stats[key] || 0;
          if (!count) return null;
          return (
            <button
              key={key}
              onClick={() => setType(type === key ? "all" : key)}
              className={`shrink-0 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium border transition-all duration-200 ${
                type === key
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-card hover:bg-accent border-border hover:border-primary/30 hover:shadow-sm"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
              {cfg.label}
              <span className="opacity-70">{count}</span>
            </button>
          );
        })}
        {type !== "all" && (
          <button
            onClick={() => setType("all")}
            className="shrink-0 flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium border border-border bg-card hover:bg-accent transition-all duration-200"
          >
            Clear filter
          </button>
        )}
      </div>

      {/* Search + Filter */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9 bg-card border-border focus:ring-2 ring-primary/20"
            placeholder="Search by name, activity or lead..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="w-[140px] bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="yesterday">Since Yesterday</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-[160px] bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="call">📞 Calls</SelectItem>
            <SelectItem value="email">📧 Emails</SelectItem>
            <SelectItem value="whatsapp">💬 WhatsApp</SelectItem>
            <SelectItem value="note">📝 Notes</SelectItem>
            <SelectItem value="stage_change">🔄 Stage changes</SelectItem>
            <SelectItem value="followup">🔔 Follow-ups</SelectItem>
            <SelectItem value="reminder">📅 Reminders</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Timeline */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-20 rounded-xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-16 text-center">
          <div className="text-4xl mb-3">📭</div>
          <div className="text-muted-foreground">No activity found</div>
          {search && (
            <button
              onClick={() => setSearch("")}
              className="mt-2 text-xs text-primary underline underline-offset-2"
            >
              Clear search
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map((group) => (
            <div key={group.label}>
              {/* Date header */}
              <div className="flex items-center gap-3 mb-4">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2">
                  {group.label}
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>

              {/* Activity cards */}
              <div className="relative pl-6 space-y-3">
                {/* Timeline line */}
                <div className="absolute left-[11px] top-4 bottom-4 w-px bg-gradient-to-b from-border via-border/50 to-transparent" />

                {group.items.map((a) => {
                  const cfg = TYPE_CONFIG[a.type] || DEFAULT_CONFIG;
                  const Icon = cfg.icon;
                  const lead: any = leadMap.get(a.lead_id);

                  return (
                    <div
                      key={a.id}
                      className="relative group rounded-xl border border-border/60 bg-card p-4 pl-10 transition-all duration-200 hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5"
                    >
                      {/* Timeline dot */}
                      <div
                        className={`absolute left-[-13px] top-5 h-6 w-6 rounded-full bg-gradient-to-br ${cfg.gradient} grid place-items-center ring-4 ring-background shadow-sm`}
                      >
                        <Icon className="h-3 w-3 text-white" />
                      </div>

                      {/* Content */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-foreground">
                              {a.title}
                            </span>
                            <Badge
                              variant="secondary"
                              className={`text-[10px] rounded-full px-2 py-0 font-medium`}
                            >
                              {cfg.label}
                            </Badge>
                          </div>
                          {a.body && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {a.body}
                            </p>
                          )}
                          {lead && (
                            <Link
                              to="/leads/$id"
                              params={{ id: a.lead_id }}
                              className="inline-flex items-center gap-1.5 mt-2 group/link"
                            >
                              <div className="h-5 w-5 rounded-full bg-primary/10 grid place-items-center text-[10px] font-bold text-primary">
                                {(lead.client_name ?? "?")[0].toUpperCase()}
                              </div>
                              <span className="text-xs font-medium text-foreground group-hover/link:text-primary transition-colors">
                                {lead.client_name}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {lead.lead_code}
                              </span>
                            </Link>
                          )}
                        </div>
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap tabular-nums">
                          {formatDistanceToNow(new Date(a.created_at), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
