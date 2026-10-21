// B2B Renewals — partner relationship health (spec section 16).
//
// Modeled on the Sales renewal dashboard (src/components/renewals/
// renewal-dashboard.tsx) but focused on PARTNER health rather than booking
// expiry: it buckets every CA firm into Active Partners / No Recent Referral /
// Dormant / Due for Follow-up, and lists per-partner last referral, last
// booking, total referrals, total revenue and the next scheduled follow-up.
//
// The per-firm roll-up (totals, last-activity dates, score, health) comes from
// the same tested src/lib/b2b-performance.ts aggregates the Partner Performance
// page uses, via listPartnerPerformance(). Follow-ups are read / written
// through the existing b2b_followups helpers so the inline "schedule follow-up"
// matches the rest of the B2B module. RLS scopes every row to the owner.
//
// Heavy component: kept out of the route file so it stays code-split, matching
// the other B2B components.

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { toast } from "sonner";
import {
  Handshake,
  Users,
  TrendingDown,
  Bell,
  Building2,
  CalendarClock,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/utils";
import { PARTNER_HEALTH } from "@/lib/b2b";
import { createFollowup, listFollowupsWithRefs, listPartnerPerformance } from "@/lib/b2b-queries";
import type { PartnerPerformanceRow } from "@/lib/b2b-performance";
import type { ComponentType } from "react";

function money(n: number): string {
  if (!n) return "—";
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function since(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : formatDistanceToNow(d, { addSuffix: true });
}

function healthBadge(id: string) {
  const h = PARTNER_HEALTH.find((p) => p.id === id);
  return h ? (
    <Badge className={`${h.color} text-white hover:${h.color}`}>{h.label}</Badge>
  ) : (
    <Badge variant="outline">{id}</Badge>
  );
}

/** Firms with a referral or logged contact within this many days are "recent". */
const RECENT_DAYS = 45;
/** No activity for this long marks a firm dormant. */
const DORMANT_DAYS = 90;

export function B2BRenewalsPage() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [followupFor, setFollowupFor] = useState<PartnerPerformanceRow | null>(null);
  const [followupDate, setFollowupDate] = useState("");
  const [followupRemark, setFollowupRemark] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["b2b-renewals-performance"],
    queryFn: () => listPartnerPerformance(),
  });

  // Pending follow-ups across the caller's firms, so each partner row can show
  // its next scheduled follow-up. RLS scopes which rows return.
  const { data: followups = [] } = useQuery({
    queryKey: ["b2b-renewals-followups"],
    queryFn: () => listFollowupsWithRefs({ status: "pending" }),
  });

  // firm_id -> earliest upcoming pending follow-up date.
  const nextFollowupByFirm = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of followups) {
      if (!f.firm_id || !f.due_at) continue;
      const current = m.get(f.firm_id);
      if (!current || new Date(f.due_at).getTime() < new Date(current).getTime()) {
        m.set(f.firm_id, f.due_at);
      }
    }
    return m;
  }, [followups]);

  // Only firms that have become partners belong on the renewals (relationship
  // health) board; raw prospects live on the pipeline / leads pages. A firm is
  // a partner if it has ever sent a referral or carries a partnered health /
  // status.
  const partners = useMemo(() => {
    const PARTNER_STATUSES = [
      "active",
      "active_partner",
      "onboarded",
      "partner_onboarded",
      "strategic",
      "dormant",
      "lost",
    ];
    return rows.filter(
      (r) =>
        r.totalReferrals > 0 ||
        r.health === "active" ||
        r.health === "strategic" ||
        r.health === "dormant" ||
        PARTNER_STATUSES.includes((r.partnerStatus ?? "").toLowerCase()),
    );
  }, [rows]);

  const now = Date.now();

  const buckets = useMemo(() => {
    const active: PartnerPerformanceRow[] = [];
    const noRecentReferral: PartnerPerformanceRow[] = [];
    const dormant: PartnerPerformanceRow[] = [];
    const dueForFollowup: PartnerPerformanceRow[] = [];

    for (const r of partners) {
      const days = r.daysSinceLastActivity;
      if (days === null || days > DORMANT_DAYS) {
        dormant.push(r);
      } else if (days > RECENT_DAYS) {
        noRecentReferral.push(r);
      } else {
        active.push(r);
      }
      // A partner is "due for follow-up" if its scheduled follow-up is today or
      // overdue.
      const next = nextFollowupByFirm.get(r.firmId);
      if (next && new Date(next).getTime() <= now) {
        dueForFollowup.push(r);
      }
    }
    return { active, noRecentReferral, dormant, dueForFollowup };
  }, [partners, nextFollowupByFirm, now]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return partners;
    return partners.filter((r) =>
      [r.firmName, r.city, r.state]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(term)),
    );
  }, [partners, search]);

  function openFollowup(row: PartnerPerformanceRow) {
    setFollowupFor(row);
    // Default to a week out.
    const d = new Date();
    d.setDate(d.getDate() + 7);
    setFollowupDate(format(d, "yyyy-MM-dd'T'HH:mm"));
    setFollowupRemark("");
  }

  async function saveFollowup() {
    if (!followupFor || !user?.id || !followupDate) return;
    setSaving(true);
    try {
      await createFollowup({
        firm_id: followupFor.firmId,
        due_at: new Date(followupDate).toISOString(),
        remark: followupRemark || null,
        assigned_to: followupFor.assignedTo ?? user.id,
        created_by: user.id,
      });
      await qc.invalidateQueries({ queryKey: ["b2b-renewals-followups"] });
      toast.success("Follow-up scheduled");
      setFollowupFor(null);
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-[image:var(--gradient-brand)] text-primary-foreground">
            <Handshake className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">B2B Renewals</h1>
            <p className="text-sm text-muted-foreground">
              {profile?.full_name
                ? `Partner relationship health for ${profile.full_name}`
                : "Keep CA firm partnerships active and referring."}
            </p>
          </div>
        </div>
      </div>

      {/* Health buckets */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <BucketCard
          icon={Handshake}
          label="Active Partners"
          value={buckets.active.length}
          color="text-success"
          highlight
        />
        <BucketCard
          icon={Users}
          label="No Recent Referral"
          value={buckets.noRecentReferral.length}
          color="text-warning"
        />
        <BucketCard
          icon={TrendingDown}
          label="Dormant Partners"
          value={buckets.dormant.length}
          color="text-destructive"
        />
        <BucketCard
          icon={Bell}
          label="Due for Follow-up"
          value={buckets.dueForFollowup.length}
          color="text-primary"
        />
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4">
          <Input
            className="max-w-sm"
            placeholder="Search firm, city, state…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              No partners yet. Firms appear here once they send a referral or are onboarded.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="p-3 font-medium">CA Firm</th>
                  <th className="p-3 font-medium">Health</th>
                  <th className="p-3 font-medium text-right">Total Referrals</th>
                  <th className="p-3 font-medium text-right">Total Revenue</th>
                  <th className="p-3 font-medium">Last Referral</th>
                  <th className="p-3 font-medium">Last Booking</th>
                  <th className="p-3 font-medium">Next Follow-up</th>
                  <th className="p-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const next = nextFollowupByFirm.get(r.firmId) ?? null;
                  const overdue = next ? new Date(next).getTime() <= now : false;
                  return (
                    <tr key={r.firmId} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="p-3 whitespace-nowrap">
                        <Link
                          to="/b2b/firms/$id"
                          params={{ id: r.firmId }}
                          className="inline-flex items-center gap-1 font-medium hover:underline"
                        >
                          <Building2 className="h-3 w-3" />
                          {r.firmName}
                        </Link>
                        {(r.city || r.state) && (
                          <div className="text-xs text-muted-foreground">
                            {[r.city, r.state].filter(Boolean).join(", ")}
                          </div>
                        )}
                      </td>
                      <td className="p-3">{healthBadge(r.health)}</td>
                      <td className="p-3 text-right tabular-nums">{r.totalReferrals}</td>
                      <td className="p-3 text-right tabular-nums whitespace-nowrap">
                        {money(r.revenue)}
                      </td>
                      <td className="p-3 whitespace-nowrap">{since(r.lastReferral)}</td>
                      <td className="p-3 whitespace-nowrap">{since(r.lastBooking)}</td>
                      <td className="p-3 whitespace-nowrap">
                        {next ? (
                          <span
                            className={
                              overdue ? "font-medium text-destructive" : "text-muted-foreground"
                            }
                          >
                            {format(new Date(next), "MMM d, yyyy")}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <Button size="sm" variant="outline" onClick={() => openFollowup(r)}>
                          <CalendarClock className="mr-1 h-3.5 w-3.5" />
                          {next ? "Reschedule" : "Follow-up"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!followupFor} onOpenChange={(o) => !o && setFollowupFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule follow-up</DialogTitle>
            <DialogDescription>
              {followupFor ? `Set the next partner follow-up for ${followupFor.firmName}.` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="b2b-renewal-followup-date">Follow-up date &amp; time</Label>
              <Input
                id="b2b-renewal-followup-date"
                type="datetime-local"
                value={followupDate}
                onChange={(e) => setFollowupDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b2b-renewal-followup-remark">Remark</Label>
              <Textarea
                id="b2b-renewal-followup-remark"
                placeholder="What is the next step with this partner?"
                value={followupRemark}
                onChange={(e) => setFollowupRemark(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFollowupFor(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveFollowup} disabled={saving || !followupDate}>
              {saving ? "Saving…" : "Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BucketCard({
  icon: Icon,
  label,
  value,
  color,
  highlight,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-success/30 bg-success/6 dark:bg-success/15" : ""}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <Icon className={`h-5 w-5 ${color}`} />
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
        </div>
        <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
