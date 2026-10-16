import { useMemo, useState, type ReactNode } from "react";
import {
  BarChart3,
  Columns3,
  LayoutDashboard,
  List,
  Loader2,
  Search,
  Settings,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import {
  DEFAULT_STAGE_ALERT_DAYS,
  DEFAULT_TAT_DAYS,
  tatState,
  type DocStage,
} from "@/lib/documentation";
import {
  useDocEvents,
  useDocSettings,
  useDocTasks,
  type DocTaskRow,
} from "@/lib/documentation-queries";
import { DocAnalytics } from "./doc-analytics";
import { DocAssignDialog } from "./doc-assign-dialog";
import { DocBoard } from "./doc-board";
import { DocList } from "./doc-list";
import { DocOverview } from "./doc-overview";
import { DocSettingsPanel } from "./doc-settings";
import { DocTaskSheet } from "./doc-task-sheet";
import { GlassSegmented } from "./doc-ui";
import { useNow } from "./doc-format";

export type DocTab = "overview" | "board" | "list" | "analytics" | "settings";

export interface DocSearch {
  tab?: DocTab;
  stage?: DocStage;
  task?: string;
}

function matches(t: DocTaskRow, q: string): boolean {
  const b = t.bookings;
  return [
    b?.client_name,
    b?.business_name,
    b?.external_booking_id,
    b?.booking_code,
    b?.contact_no,
    b?.email_id,
    b?.sp_name,
    b?.city,
    t.assignee_name,
  ].some((v) => (v ?? "").toLowerCase().includes(q));
}

export function DocWorkspace({
  search,
  onSearch,
}: {
  search: DocSearch;
  onSearch: (next: DocSearch) => void;
}) {
  const { isAdmin, hasRole, profile } = useAuth();
  const canAssign = isAdmin || hasRole("sales") || hasRole("bd");
  const now = useNow();
  const { data: tasks = [], isLoading, error } = useDocTasks();
  const {
    data: settings = { tatDays: DEFAULT_TAT_DAYS, stageAlertDays: DEFAULT_STAGE_ALERT_DAYS },
  } = useDocSettings();
  // The pipeline board is the landing view. Non-admins already get the
  // Overview on their Dashboard, so it is not repeated here for them.
  const adminOnly: DocTab[] = ["overview", "analytics", "settings"];
  const tab: DocTab =
    search.tab && (isAdmin || !adminOnly.includes(search.tab)) ? search.tab : "board";
  const { data: events = [] } = useDocEvents(isAdmin && tab === "analytics");

  const [q, setQ] = useState("");
  const [assignee, setAssignee] = useState<string>("all");
  const [overdueOnly, setOverdueOnly] = useState(false);

  const assignees = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) m.set(t.assigned_to, t.assignee_name ?? "Unknown");
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasks]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tasks.filter(
      (t) =>
        (assignee === "all" || t.assigned_to === assignee) &&
        (!overdueOnly || tatState(t, now) === "overdue") &&
        (!needle || matches(t, needle)),
    );
  }, [tasks, q, assignee, overdueOnly, now]);

  const openTask = tasks.find((t) => t.id === search.task) ?? null;
  const go = (patch: DocSearch) => onSearch({ ...search, ...patch });
  const openCount = tasks.filter((t) => t.stage !== "completed").length;

  const tabs: { id: DocTab; label: ReactNode; count?: number }[] = [
    {
      id: "board",
      label: (
        <>
          <Columns3 className="h-4 w-4" />
          Pipeline
        </>
      ),
      count: openCount,
    },
    {
      id: "list",
      label: (
        <>
          <List className="h-4 w-4" />
          List
        </>
      ),
    },
    ...(isAdmin
      ? ([
          {
            id: "overview",
            label: (
              <>
                <LayoutDashboard className="h-4 w-4" />
                Overview
              </>
            ),
          },
          {
            id: "analytics",
            label: (
              <>
                <BarChart3 className="h-4 w-4" />
                Analytics
              </>
            ),
          },
          {
            id: "settings",
            label: (
              <>
                <Settings className="h-4 w-4" />
                Settings
              </>
            ),
          },
        ] as const)
      : []),
  ];

  const showToolbar = tab === "board" || tab === "list";

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-4 md:p-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            {isAdmin
              ? "Documentation"
              : `${profile?.full_name?.split(" ")[0] ?? "My"}'s documentation`}
          </h1>
          <p className="text-sm text-muted-foreground">
            Documents requested → KYC → draft → space partner final → countersign → Part B · TAT{" "}
            {settings.tatDays} days
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canAssign && <DocAssignDialog />}
          <GlassSegmented
            ariaLabel="Documentation view"
            value={tab}
            onChange={(id) => go({ tab: id, stage: undefined })}
            options={tabs}
          />
        </div>
      </div>

      {showToolbar && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search client, business, booking ID, SP…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {isAdmin && assignees.length > 1 && (
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone</SelectItem>
                {assignees.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex items-center gap-2">
            <Switch id="doc-overdue" checked={overdueOnly} onCheckedChange={setOverdueOnly} />
            <Label htmlFor="doc-overdue" className="text-sm">
              TAT breached only
            </Label>
          </div>
        </div>
      )}

      {error ? (
        <div className="surface-card p-10 text-center text-sm text-red-600">
          Could not load documentation files: {(error as Error).message}
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center gap-2 p-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading documentation files…
        </div>
      ) : tab === "overview" ? (
        <DocOverview
          tasks={tasks}
          settings={settings}
          now={now}
          showAssignee={isAdmin}
          onOpenTask={(id) => go({ task: id })}
          onOpenStage={(stage) => go({ tab: "board", stage })}
          onShowOverdue={() => {
            setOverdueOnly(true);
            go({ tab: "list" });
          }}
        />
      ) : tab === "board" ? (
        <DocBoard
          tasks={filtered}
          now={now}
          stageAlertDays={settings.stageAlertDays}
          showAssignee={isAdmin}
          focusStage={search.stage ?? null}
          onOpenTask={(id) => go({ task: id })}
        />
      ) : tab === "list" ? (
        <DocList
          tasks={filtered}
          now={now}
          showAssignee={isAdmin}
          onOpenTask={(id) => go({ task: id })}
        />
      ) : tab === "analytics" ? (
        <DocAnalytics tasks={tasks} events={events} settings={settings} now={now} />
      ) : (
        <DocSettingsPanel settings={settings} />
      )}

      <DocTaskSheet
        task={openTask}
        now={now}
        isAdmin={isAdmin}
        onClose={() => go({ task: undefined })}
      />
    </div>
  );
}
