import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Bell, Building2, CheckCircle2, Clock, AlertTriangle, CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { guardRoles } from "@/lib/route-guard";
import { getErrorMessage } from "@/lib/utils";
import { logAudit } from "@/lib/audit";
import { bucketFollowups } from "@/lib/b2b-followups";
import { completeFollowup, listFollowupsWithRefs, type FollowupWithRefs } from "@/lib/b2b-queries";

// Optional ?bucket= (overdue | today | upcoming) narrows the list to one bucket
// — used by the admin command-center "Overdue Follow-ups" drill-down
// (?bucket=overdue). Optional with a sane default (all buckets) so direct
// navigation to the follow-ups page is unchanged.
type FollowupsSearch = { bucket?: "overdue" | "today" | "upcoming" };

export const Route = createFileRoute("/_authenticated/b2b/activities/followups")({
  head: () => ({ meta: [{ title: "Follow-ups — EaseMyOffice CRM" }] }),
  validateSearch: (s: Record<string, unknown>): FollowupsSearch => ({
    bucket:
      s.bucket === "overdue" || s.bucket === "today" || s.bucket === "upcoming"
        ? s.bucket
        : undefined,
  }),
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "b2b"]);
  },
  component: FollowupsPage,
});

function FollowupsPage() {
  const qc = useQueryClient();
  const { bucket } = Route.useSearch();
  const [active, setActive] = useState<FollowupWithRefs | null>(null);

  // Pending follow-ups only — done/missed drop off the working list. RLS scopes
  // rows to the current user; admins see all.
  const { data: followups = [], isLoading } = useQuery({
    queryKey: ["b2b-followups-list"],
    queryFn: () => listFollowupsWithRefs({ status: "pending" }),
  });

  // Bucketing is pure (src/lib/b2b-followups.ts) — pass "now" in explicitly so
  // the three lists are deterministic for a given render.
  const buckets = useMemo(() => bucketFollowups(followups, Date.now()), [followups]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["b2b-followups-list"] });

  return (
    <div className="p-5 md:p-10 space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-lg bg-[image:var(--gradient-brand)] text-primary-foreground">
          <Bell className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Follow-ups</h1>
          <p className="text-sm text-muted-foreground">
            {followups.length} pending · update directly from the list, no need to open the firm.
          </p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-10 text-center">Loading…</p>
      ) : (
        <>
          {(!bucket || bucket === "overdue") && (
            <Bucket
              title="Overdue"
              icon={AlertTriangle}
              tone="text-destructive"
              items={buckets.overdue}
              onUpdate={setActive}
            />
          )}
          {(!bucket || bucket === "today") && (
            <Bucket
              title="Today's Follow-ups"
              icon={Clock}
              tone="text-warning"
              items={buckets.today}
              onUpdate={setActive}
            />
          )}
          {(!bucket || bucket === "upcoming") && (
            <Bucket
              title="Upcoming"
              icon={CalendarClock}
              tone="text-muted-foreground"
              items={buckets.upcoming}
              onUpdate={setActive}
            />
          )}
        </>
      )}

      <CompleteFollowupDialog
        followup={active}
        onOpenChange={(o) => {
          if (!o) setActive(null);
        }}
        onDone={() => {
          setActive(null);
          refresh();
        }}
      />
    </div>
  );
}

function Bucket({
  title,
  icon: Icon,
  tone,
  items,
  onUpdate,
}: {
  title: string;
  icon: typeof Clock;
  tone: string;
  items: FollowupWithRefs[];
  onUpdate: (f: FollowupWithRefs) => void;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="flex-row items-center gap-2">
        <Icon className={`h-4 w-4 ${tone}`} />
        <CardTitle className="text-base">
          {title} <span className="text-muted-foreground font-normal">({items.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nothing here.</p>
        ) : (
          items.map((f) => <FollowupRow key={f.id} followup={f} onUpdate={onUpdate} />)
        )}
      </CardContent>
    </Card>
  );
}

function FollowupRow({
  followup,
  onUpdate,
}: {
  followup: FollowupWithRefs;
  onUpdate: (f: FollowupWithRefs) => void;
}) {
  const label = followup.firm_name ?? followup.lead_contact ?? "Follow-up";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          {followup.firm_id ? (
            <Link
              to="/b2b/firms/$id"
              params={{ id: followup.firm_id }}
              className="font-medium truncate hover:underline inline-flex items-center gap-1"
            >
              <Building2 className="h-3.5 w-3.5" />
              {label}
            </Link>
          ) : (
            <span className="font-medium truncate">{label}</span>
          )}
          <Badge variant="outline">{format(new Date(followup.due_at), "dd MMM, p")}</Badge>
        </div>
        {followup.remark && (
          <div className="text-xs text-muted-foreground truncate">{followup.remark}</div>
        )}
      </div>
      <Button size="sm" variant="outline" onClick={() => onUpdate(followup)}>
        <CheckCircle2 className="h-4 w-4 mr-2" /> Update
      </Button>
    </div>
  );
}

function CompleteFollowupDialog({
  followup,
  onOpenChange,
  onDone,
}: {
  followup: FollowupWithRefs | null;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const [remark, setRemark] = useState("");
  const [outcome, setOutcome] = useState("");
  const [nextDate, setNextDate] = useState("");

  // Reset the form each time the dialog opens for a (different) follow-up.
  const key = followup?.id ?? "none";
  const [lastKey, setLastKey] = useState("");
  if (key !== lastKey) {
    setLastKey(key);
    setRemark(followup?.remark ?? "");
    setOutcome("");
    setNextDate("");
  }

  const save = useMutation({
    mutationFn: () => {
      if (!followup || !user) throw new Error("Not ready");
      const nextDueAt = nextDate ? new Date(`${nextDate}T09:00:00`).toISOString() : null;
      return completeFollowup({
        followup,
        remark: remark.trim() || null,
        outcome: outcome.trim() || null,
        nextDueAt,
        actorId: user.id,
      });
    },
    onSuccess: () => {
      toast.success(nextDate ? "Follow-up done · next one scheduled" : "Follow-up marked done");
      logAudit({
        actorId: user?.id,
        action: "edit",
        entity: followup?.firm_id ? "ca_firm" : "b2b_lead",
        entityId: followup?.firm_id ?? followup?.lead_id ?? null,
        entityLabel: followup?.firm_name ?? followup?.lead_contact ?? null,
        detail: "Completed follow-up",
      });
      onDone();
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  return (
    <Dialog open={!!followup} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Update follow-up</DialogTitle>
          <DialogDescription>
            Mark this follow-up done and optionally schedule the next one, without leaving the list.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="fu-outcome">Outcome</Label>
            <Input
              id="fu-outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              placeholder="e.g. Connected, No answer, Interested"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fu-remark">Remark</Label>
            <Textarea
              id="fu-remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={3}
              placeholder="What happened on this follow-up?"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fu-next">Next follow-up date (optional)</Label>
            <Input
              id="fu-next"
              type="date"
              value={nextDate}
              onChange={(e) => setNextDate(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={!user || save.isPending}>
            {save.isPending ? "Saving…" : "Mark done"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
