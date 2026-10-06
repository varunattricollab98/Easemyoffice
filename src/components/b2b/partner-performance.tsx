// Partner Performance + Active Partners (spec section 13).
//
// Both pages read the same live roll-up — listPartnerPerformance() aggregates
// every firm's referrals / bookings / activities and computes the partner score
// + health category via the tested src/lib/b2b-scoring.ts (through
// src/lib/b2b-performance.ts). Partner Performance shows every firm with a
// sortable / filterable table; Active Partners shows only onboarded/active
// firms (active or strategic health, or a partner_status that marks them live).
//
// Heavy component (query + sortable table) kept out of the route files so it
// stays code-split, mirroring firm-360 / partnership-pipeline.

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Handshake, Trophy, ArrowUp, ArrowDown, ChevronsUpDown, Building2 } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PARTNER_HEALTH } from "@/lib/b2b";
import { listAssignableUsers, listPartnerPerformance } from "@/lib/b2b-queries";
import type { PartnerPerformanceRow } from "@/lib/b2b-performance";

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

type SortKey =
  | "firmName"
  | "totalReferrals"
  | "convertedReferrals"
  | "bookings"
  | "revenue"
  | "lastReferral"
  | "lastContact"
  | "score";

type SortDir = "asc" | "desc";

const NUMERIC_KEYS = new Set<SortKey>([
  "totalReferrals",
  "convertedReferrals",
  "bookings",
  "revenue",
  "lastReferral",
  "lastContact",
  "score",
]);

function sortValue(row: PartnerPerformanceRow, key: SortKey): number | string {
  switch (key) {
    case "firmName":
      return row.firmName.toLowerCase();
    case "lastReferral":
      return row.lastReferral ? new Date(row.lastReferral).getTime() : 0;
    case "lastContact":
      return row.lastContact ? new Date(row.lastContact).getTime() : 0;
    default:
      return row[key] as number;
  }
}

function SortHeader({
  label,
  k,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === k;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 ${
          align === "right" ? "flex-row-reverse" : ""
        } ${active ? "text-foreground" : "text-muted-foreground"} hover:text-foreground`}
      >
        {label}
        <Icon className="h-3 w-3" />
      </button>
    </TableHead>
  );
}

/**
 * Shared table. `activeOnly` filters to onboarded/active partners (Active
 * Partners page); otherwise every firm shows (Partner Performance page).
 */
function PerformanceTable({ activeOnly }: { activeOnly: boolean }) {
  const [search, setSearch] = useState("");
  const [healthFilter, setHealthFilter] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "score",
    dir: "desc",
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["b2b-partner-performance"],
    queryFn: () => listPartnerPerformance(),
  });
  const { data: users = [] } = useQuery({
    queryKey: ["b2b-assignable-users"],
    queryFn: () => listAssignableUsers(),
  });
  const userName = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.id, u.full_name ?? u.email ?? u.id.slice(0, 8));
    return m;
  }, [users]);

  const toggleSort = (k: SortKey) =>
    setSort((s) =>
      s.key === k
        ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key: k, dir: NUMERIC_KEYS.has(k) ? "desc" : "asc" },
    );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = rows;
    if (activeOnly) {
      // Onboarded/active partners: those whose health is active/strategic, or
      // whose firm partner_status explicitly marks them live.
      list = list.filter(
        (r) =>
          r.health === "active" ||
          r.health === "strategic" ||
          ["active", "active_partner", "onboarded", "partner_onboarded", "strategic"].includes(
            (r.partnerStatus ?? "").toLowerCase(),
          ),
      );
    }
    if (healthFilter !== "all") list = list.filter((r) => r.health === healthFilter);
    if (term) {
      list = list.filter((r) =>
        [r.firmName, r.city, r.state]
          .filter(Boolean)
          .some((v) => (v as string).toLowerCase().includes(term)),
      );
    }
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [rows, activeOnly, healthFilter, search, sort]);

  const Header = activeOnly ? Handshake : Trophy;
  const title = activeOnly ? "Active Partners" : "Partner Performance";
  const description = activeOnly
    ? "Onboarded CA firms actively sending referrals, with their partner score and health."
    : "Every CA firm's referral + booking performance, partner score and health category.";

  return (
    <div className="p-5 md:p-10 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
          <Header className="h-5 w-5" />
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
            placeholder="Search firm, city, state…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={healthFilter} onValueChange={setHealthFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Health" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All health</SelectItem>
              {PARTNER_HEALTH.map((h) => (
                <SelectItem key={h.id} value={h.id}>
                  {h.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-16 text-center">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-16 text-center">
              {activeOnly ? "No active partners yet." : "No firms to show."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader label="CA Firm" k="firmName" sort={sort} onSort={toggleSort} />
                  <TableHead>Partner Status</TableHead>
                  <SortHeader
                    label="Referrals"
                    k="totalReferrals"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Converted"
                    k="convertedReferrals"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Bookings"
                    k="bookings"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Revenue"
                    k="revenue"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Last Referral"
                    k="lastReferral"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <TableHead>Last Booking</TableHead>
                  <SortHeader
                    label="Last Contact"
                    k="lastContact"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <TableHead>B2B Employee</TableHead>
                  <SortHeader
                    label="Score"
                    k="score"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  />
                  <TableHead>Health</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.firmId}>
                    <TableCell className="whitespace-nowrap">
                      <Link
                        to="/b2b/firms/$id"
                        params={{ id: r.firmId }}
                        className="inline-flex items-center gap-1 font-medium hover:underline"
                      >
                        <Building2 className="h-3 w-3" />
                        {r.firmName}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {r.partnerStatus ? <Badge variant="outline">{r.partnerStatus}</Badge> : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.totalReferrals}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.convertedReferrals}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.bookings}</TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap">
                      {money(r.revenue)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{since(r.lastReferral)}</TableCell>
                    <TableCell className="whitespace-nowrap">{since(r.lastBooking)}</TableCell>
                    <TableCell className="whitespace-nowrap">{since(r.lastContact)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {r.assignedTo ? (userName.get(r.assignedTo) ?? "—") : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {r.score}
                    </TableCell>
                    <TableCell>{healthBadge(r.health)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function PartnerPerformancePage() {
  return <PerformanceTable activeOnly={false} />;
}

export function ActivePartnersPage() {
  return <PerformanceTable activeOnly={true} />;
}
