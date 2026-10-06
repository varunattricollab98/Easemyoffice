// Shared chronological activity feed for the B2B Calls / Meetings / Activity
// History screens. Each row shows the activity type, subject, outcome, notes and
// when it happened, and links back to its firm (and names its lead). The three
// routes render this with different fixed type filters and filter controls, so
// the heavy query + list markup lives here once rather than in each route file.

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Phone, Mail, MessageCircle, CalendarCheck, FileText, Building2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ACTIVITY_TYPES, labelFor, type B2BActivity } from "@/lib/b2b";
import { listActivityFeed, type ActivityFeedFilters } from "@/lib/b2b-queries";

const ACTIVITY_ICON: Record<string, typeof Phone> = {
  call: Phone,
  whatsapp: MessageCircle,
  email: Mail,
  meeting: CalendarCheck,
  task: FileText,
  followup: CalendarCheck,
  note: FileText,
};

export function ActivityFeed({
  title,
  description,
  icon: HeaderIcon,
  fixedType,
  showTypeFilter = false,
}: {
  title: string;
  description: string;
  icon: typeof Phone;
  /** When set, the feed only shows this activity type (Calls / Meetings). */
  fixedType?: B2BActivity["type"];
  /** When true, show a type selector (used by Activity History). */
  showTypeFilter?: boolean;
}) {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filters: ActivityFeedFilters = useMemo(() => {
    const f: ActivityFeedFilters = {};
    if (fixedType) f.type = fixedType;
    else if (typeFilter !== "all") f.type = typeFilter as B2BActivity["type"];
    if (fromDate) f.from = new Date(`${fromDate}T00:00:00`).toISOString();
    if (toDate) {
      // Exclusive upper bound: include the whole selected end day.
      const end = new Date(`${toDate}T00:00:00`);
      end.setDate(end.getDate() + 1);
      f.to = end.toISOString();
    }
    return f;
  }, [fixedType, typeFilter, fromDate, toDate]);

  const { data: activities = [], isLoading } = useQuery({
    queryKey: ["b2b-activity-feed", filters],
    queryFn: () => listActivityFeed(filters),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return activities;
    return activities.filter((a) =>
      [a.subject, a.notes, a.outcome, a.firm_name, a.lead_contact]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(term)),
    );
  }, [activities, search]);

  return (
    <div className="p-5 md:p-10 space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
          <HeaderIcon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4 flex flex-wrap gap-2">
          <Input
            className="flex-1 min-w-56"
            placeholder="Search subject, notes, firm…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {showTypeFilter && (
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {ACTIVITY_TYPES.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Input
            type="date"
            className="w-[160px]"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="From date"
          />
          <Input
            type="date"
            className="w-[160px]"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="To date"
          />
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardContent className="p-5">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-10 text-center">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-10 text-center">No activity to show.</p>
          ) : (
            <ol className="relative border-l pl-6 space-y-5">
              {filtered.map((a) => (
                <ActivityRow key={a.id} activity={a} />
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ActivityRow({
  activity,
}: {
  activity: Awaited<ReturnType<typeof listActivityFeed>>[number];
}) {
  const Icon = ACTIVITY_ICON[activity.type] ?? FileText;
  return (
    <li className="relative">
      <span className="absolute -left-[31px] grid size-6 place-items-center rounded-full border bg-background text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{labelFor(ACTIVITY_TYPES, activity.type)}</span>
        {activity.outcome && <Badge variant="outline">{activity.outcome}</Badge>}
        <span className="text-xs text-muted-foreground">
          {format(new Date(activity.happened_at), "dd MMM yyyy, p")}
        </span>
      </div>
      {activity.subject && <div className="text-sm">{activity.subject}</div>}
      {activity.notes && (
        <div className="text-sm text-muted-foreground whitespace-pre-wrap">{activity.notes}</div>
      )}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-1">
        {activity.firm_id ? (
          <Link
            to="/b2b/firms/$id"
            params={{ id: activity.firm_id }}
            className="inline-flex items-center gap-1 hover:underline"
          >
            <Building2 className="h-3 w-3" />
            {activity.firm_name ?? "Firm"}
          </Link>
        ) : (
          activity.firm_name && (
            <span className="inline-flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              {activity.firm_name}
            </span>
          )
        )}
        {activity.lead_contact && <span>Lead: {activity.lead_contact}</span>}
      </div>
    </li>
  );
}
