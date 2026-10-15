import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Loader2 } from "lucide-react";
import { QuickPunch } from "@/components/hrms/quick-punch";
import { Button } from "@/components/ui/button";
import { DocOverview } from "@/components/documentation/doc-overview";
import { useNow } from "@/components/documentation/doc-format";
import { useAuth } from "@/lib/auth";
import { DEFAULT_STAGE_ALERT_DAYS, DEFAULT_TAT_DAYS } from "@/lib/documentation";
import { useDocSettings, useDocTasks } from "@/lib/documentation-queries";

/** Dashboard for documentation-only users: the same overview as /documentation. */
export function DocumentationDashboardInline() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const now = useNow();
  const { data: tasks = [], isLoading } = useDocTasks();
  const {
    data: settings = { tatDays: DEFAULT_TAT_DAYS, stageAlertDays: DEFAULT_STAGE_ALERT_DAYS },
  } = useDocSettings();

  const dateLabel = new Date(now).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5 md:p-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            {profile?.full_name?.split(" ")[0] ?? "Your"}&apos;s Documentation Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            {dateLabel} &middot; TAT {settings.tatDays} days per file
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/documentation" search={{ tab: "board" }}>
              Open pipeline <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
          {/* Attendance LOGIN / LOGOUT, top right. */}
          <QuickPunch />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 p-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your files…
        </div>
      ) : (
        <DocOverview
          tasks={tasks}
          settings={settings}
          now={now}
          showAssignee={false}
          onOpenTask={(id) => navigate({ to: "/documentation", search: { task: id } })}
          onOpenStage={(stage) =>
            navigate({ to: "/documentation", search: { tab: "board", stage } })
          }
          onShowOverdue={() => navigate({ to: "/documentation", search: { tab: "list" } })}
        />
      )}
    </div>
  );
}
