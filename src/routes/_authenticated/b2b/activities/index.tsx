import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckSquare, Building2, Bell, ClipboardList } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { guardRoles } from "@/lib/route-guard";
import { bucketFollowups } from "@/lib/b2b-followups";
import { listActivityFeed, listFollowupsWithRefs, type FollowupScope } from "@/lib/b2b-queries";

export const Route = createFileRoute("/_authenticated/b2b/activities/")({
  head: () => ({ meta: [{ title: "My Tasks — EaseMyOffice CRM" }] }),
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "b2b"]);
  },
  component: MyTasksPage,
});

function MyTasksPage() {
  const { user, isAdmin } = useAuth();

  // Admin sees everything; a B2B user sees only what is assigned to them. RLS
  // enforces this server-side regardless, so the scope is just a UX narrowing.
  const followupScope: FollowupScope = useMemo(
    () => ({ status: "pending", ...(isAdmin ? {} : { assignedTo: user?.id }) }),
    [isAdmin, user?.id],
  );

  const { data: followups = [], isLoading: loadingF } = useQuery({
    queryKey: ["b2b-my-followups", followupScope],
    queryFn: () => listFollowupsWithRefs(followupScope),
    enabled: !!user,
  });

  const { data: tasks = [], isLoading: loadingT } = useQuery({
    queryKey: ["b2b-my-tasks", isAdmin ? "all" : user?.id],
    queryFn: () => listActivityFeed({ type: "task", ...(isAdmin ? {} : { createdBy: user?.id }) }),
    enabled: !!user,
  });

  const buckets = useMemo(() => bucketFollowups(followups, Date.now()), [followups]);

  return (
    <div className="p-5 md:p-10 space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
          <CheckSquare className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">My Tasks</h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin ? "All" : "Your"} open follow-ups and tasks.
          </p>
        </div>
      </div>

      {/* Follow-ups due */}
      <Card className="shadow-sm">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4 text-amber-600" /> Follow-ups
          </CardTitle>
          <Link to="/b2b/activities/followups" className="text-xs text-primary hover:underline">
            Open follow-ups →
          </Link>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingF ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : followups.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No pending follow-ups.</p>
          ) : (
            <>
              <TaskGroup label="Overdue" tone="text-destructive" items={buckets.overdue} />
              <TaskGroup label="Today" tone="text-amber-600" items={buckets.today} />
              <TaskGroup label="Upcoming" tone="text-muted-foreground" items={buckets.upcoming} />
            </>
          )}
        </CardContent>
      </Card>

      {/* Logged tasks */}
      <Card className="shadow-sm">
        <CardHeader className="flex-row items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">
            Tasks <span className="text-muted-foreground font-normal">({tasks.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loadingT ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No tasks logged.</p>
          ) : (
            tasks.map((t) => (
              <div key={t.id} className="rounded-lg border p-3 text-sm space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t.subject ?? "Task"}</span>
                  {t.outcome && <Badge variant="outline">{t.outcome}</Badge>}
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(t.happened_at), "dd MMM yyyy, p")}
                  </span>
                </div>
                {t.notes && (
                  <div className="text-muted-foreground whitespace-pre-wrap">{t.notes}</div>
                )}
                {t.firm_id && (
                  <Link
                    to="/b2b/firms/$id"
                    params={{ id: t.firm_id }}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Building2 className="h-3 w-3" />
                    {t.firm_name ?? "Firm"}
                  </Link>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TaskGroup({
  label,
  tone,
  items,
}: {
  label: string;
  tone: string;
  items: Awaited<ReturnType<typeof listFollowupsWithRefs>>;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className={`text-xs font-semibold uppercase tracking-wide ${tone}`}>
        {label} ({items.length})
      </div>
      {items.map((f) => {
        const name = f.firm_name ?? f.lead_contact ?? "Follow-up";
        return (
          <div
            key={f.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
          >
            <div className="min-w-0">
              {f.firm_id ? (
                <Link
                  to="/b2b/firms/$id"
                  params={{ id: f.firm_id }}
                  className="font-medium truncate hover:underline inline-flex items-center gap-1"
                >
                  <Building2 className="h-3.5 w-3.5" />
                  {name}
                </Link>
              ) : (
                <span className="font-medium truncate">{name}</span>
              )}
              {f.remark && <div className="text-xs text-muted-foreground truncate">{f.remark}</div>}
            </div>
            <Badge variant="outline">{format(new Date(f.due_at), "dd MMM, p")}</Badge>
          </div>
        );
      })}
    </div>
  );
}
