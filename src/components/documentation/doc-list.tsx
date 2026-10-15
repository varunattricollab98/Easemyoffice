import { useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDuration, stageAgeMs, stageDef, tatState } from "@/lib/documentation";
import type { DocTaskRow } from "@/lib/documentation-queries";
import { StageBadge, TatChip } from "./doc-ui";
import { bookingRef, bookingTitle } from "./doc-format";
import { cn } from "@/lib/utils";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function DocList({
  tasks,
  now,
  showAssignee,
  onOpenTask,
}: {
  tasks: DocTaskRow[];
  now: number;
  showAssignee: boolean;
  onOpenTask: (id: string) => void;
}) {
  // Open files by deadline first, then completed files newest first.
  const rows = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        const ao = a.stage === "completed" ? 1 : 0;
        const bo = b.stage === "completed" ? 1 : 0;
        if (ao !== bo) return ao - bo;
        return ao
          ? Date.parse(b.completed_at ?? b.updated_at) - Date.parse(a.completed_at ?? a.updated_at)
          : Date.parse(a.due_at) - Date.parse(b.due_at);
      }),
    [tasks],
  );

  if (!rows.length) {
    return (
      <div className="surface-card p-10 text-center text-sm text-muted-foreground">
        No documentation files match.
      </div>
    );
  }

  return (
    <div className="surface-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Booking</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>TAT</TableHead>
            <TableHead className="hidden md:table-cell">In stage</TableHead>
            <TableHead className="hidden lg:table-cell">Space partner</TableHead>
            {showAssignee && <TableHead className="hidden md:table-cell">Assigned to</TableHead>}
            <TableHead className="hidden lg:table-cell">Assigned</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => (
            <TableRow
              key={t.id}
              onClick={() => onOpenTask(t.id)}
              className={cn(
                "cursor-pointer",
                tatState(t, now) === "overdue" && "bg-red-50/60 dark:bg-red-950/20",
              )}
            >
              <TableCell>
                <div className="font-medium">{bookingTitle(t.bookings)}</div>
                <div className="text-xs text-muted-foreground">
                  {bookingRef(t.bookings)}
                  {t.bookings?.business_name && t.bookings.client_name
                    ? ` · ${t.bookings.client_name}`
                    : ""}
                </div>
              </TableCell>
              <TableCell>
                <StageBadge stage={t.stage} />
                <div className="mt-1 hidden text-[11px] text-muted-foreground xl:block">
                  {stageDef(t.stage).next}
                </div>
              </TableCell>
              <TableCell>
                <TatChip task={t} now={now} />
              </TableCell>
              <TableCell className="hidden text-sm tabular-nums text-muted-foreground md:table-cell">
                {t.stage === "completed" ? "—" : formatDuration(stageAgeMs(t, now))}
              </TableCell>
              <TableCell className="hidden text-sm lg:table-cell">
                {t.bookings?.sp_name || "—"}
              </TableCell>
              {showAssignee && (
                <TableCell className="hidden text-sm md:table-cell">
                  {t.assignee_name ?? "—"}
                </TableCell>
              )}
              <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                {fmtDate(t.created_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
