import { Link } from "@tanstack/react-router";
import type { BookingDocTask } from "@/lib/documentation-queries";
import { StageBadge, TatChip } from "./doc-ui";

export function BookingDocCell({ task, now }: { task: BookingDocTask | undefined; now: number }) {
  if (!task) return <span className="text-xs text-muted-foreground">Not assigned</span>;
  return (
    <Link
      to="/documentation"
      search={{ task: task.id }}
      className="block space-y-1 rounded-md hover:opacity-80"
      title="Open in Documentation"
    >
      <div className="truncate text-sm font-medium">{task.assignee_name ?? "—"}</div>
      <div className="flex flex-wrap items-center gap-1">
        <StageBadge stage={task.stage} />
        {task.stage !== "completed" && <TatChip task={task} now={now} />}
      </div>
    </Link>
  );
}
