import { createFileRoute } from "@tanstack/react-router";
import { isRenewalBooking, renewalYear } from "@/lib/booking-kind";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  CheckCircle2,
  AlertCircle,
  Upload,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  Trash2,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { BookingDetailDialog } from "@/components/bookings/booking-detail-dialog";
import { BookingDocCell } from "@/components/documentation/booking-doc-status";
import { useBookingDocTasks } from "@/lib/documentation-queries";
import { BulkUploadDialog } from "@/components/bookings/bulk-upload-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Tables } from "@/integrations/supabase/types";

// Use the generated row type rather than `any`, so the sort accessors below are
// checked against the real column names and types.
type BookingRow = Tables<"bookings">;

// A booking is a renewal when the renewal flow stamped it. Matches the query the
// old /renewals/bookings page used, so the merged list classifies rows exactly as
// that page did.

// Lazy-load the self-contained New Booking dialog (renders its own trigger).
// Mirrors the dashboard pattern so the bookings route bundle stays lean.
const NewBookingDialog = lazy(() =>
  import("@/components/dashboard/new-booking-dialog").then((m) => ({
    default: m.NewBookingDialog,
  })),
);

const NewRenewalBookingDialog = lazy(() =>
  import("@/components/bookings/new-renewal-booking-dialog").then((m) => ({
    default: m.NewRenewalBookingDialog,
  })),
);

export const Route = createFileRoute("/_authenticated/bookings")({
  // Optional ?q= to pre-fill the search box (used by global search). Optional
  // ?source= filters by booking_source (used by the admin command-center "B2B
  // Bookings" drill-down, ?source=b2b). Both are optional so direct navigation
  // to /bookings is unchanged.
  validateSearch: (s: Record<string, unknown>): { q?: string; source?: string } => ({
    q: typeof s.q === "string" ? s.q : undefined,
    source: typeof s.source === "string" ? s.source : undefined,
  }),
  component: BookingsPage,
});

import { formatINR as fmtINR } from "@/lib/utils";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// booking_date / balance_due_date are plain YYYY-MM-DD strings. Split them by
// hand rather than going through `new Date()`, which would read them as UTC
// midnight and could show the previous day in a negative-offset timezone.
// Also keeps the cell on one line — "2026-08-19" was wrapping mid-date.
function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return String(iso);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}

type SortKey =
  | "booking"
  | "date"
  | "client"
  | "plan"
  | "agent"
  | "total"
  | "received"
  | "balance"
  | "due"
  | "status";

type SortDir = "asc" | "desc";

interface SortState {
  key: SortKey;
  dir: SortDir;
}

// Text columns read better A->Z on first click; dates and money are more useful
// biggest/newest first, and status should lead with whatever needs attention.
const FIRST_CLICK_DIR: Record<SortKey, SortDir> = {
  booking: "asc",
  date: "desc",
  client: "asc",
  plan: "asc",
  agent: "asc",
  total: "desc",
  received: "desc",
  balance: "desc",
  due: "asc",
  status: "asc",
};

// Sorted so the rows that need action come first: overdue, then pending, then paid.
function statusRank(b: BookingRow, today: string): number {
  const balance = Number(b.balance_amount ?? 0);
  const isPaid = !!b.balance_paid_at || balance === 0;
  if (isPaid) return 2;
  const due = b.balance_due_date;
  return due && due <= today ? 0 : 1;
}

function sortValue(b: BookingRow, key: SortKey, today: string): string | number {
  switch (key) {
    case "booking":
      return String(b.external_booking_id || b.booking_code || "").toLowerCase();
    case "date":
      return b.booking_date ?? "";
    case "client":
      return String(b.client_name ?? "").toLowerCase();
    case "plan":
      return String(b.plan_name ?? "").toLowerCase();
    case "agent":
      return String(b.sales_agent_name ?? "").toLowerCase();
    case "total":
      return Number(b.amount_after_tds ?? 0);
    case "received":
      return Number(b.amount_received ?? 0);
    case "balance":
      return Number(b.balance_amount ?? 0);
    case "due":
      return b.balance_due_date ?? "";
    case "status":
      return statusRank(b, today);
  }
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
  className = "",
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={`whitespace-nowrap ${align === "right" ? "text-right" : ""} ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={`Sort by ${label}`}
        className={`group inline-flex items-center gap-1 rounded-sm transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
          active ? "text-foreground" : ""
        } ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        <span>{label}</span>
        {/* Idle columns only hint on hover, so the header row stays calm. */}
        <Icon
          className={`h-3.5 w-3.5 shrink-0 transition-opacity duration-150 ${
            active ? "opacity-100" : "opacity-0 group-hover:opacity-60"
          }`}
        />
      </button>
    </TableHead>
  );
}

function BookingsPage() {
  const { isAdmin, user } = useAuth();
  const qc = useQueryClient();
  const { q: initialQ = "", source: sourceParam } = Route.useSearch();
  const [q, setQ] = useState(initialQ);
  const [agentFilter, setAgentFilter] = useState("all");
  // Fresh vs renewal — see isRenewalBooking: a Booking ID ending in R1/R2…,
  // source "Renewal", or a renewal-form booking.
  const [typeFilter, setTypeFilter] = useState<"all" | "fresh" | "renewal">("all");
  // Date-range preset filter: narrows bookings by booking_date.
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "week" | "month">("all");
  const [renewalOpen, setRenewalOpen] = useState(false);
  const [selected, setSelected] = useState<BookingRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: "date", dir: "desc" });
  // Booking pending delete confirmation (admin only).
  const [toDelete, setToDelete] = useState<BookingRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["bookings", isAdmin ? "all" : user?.id],
    queryFn: async () => {
      // Admin sees all bookings; a salesperson sees only their own (assigned or
      // created by them). This explicit filter is layered on top of RLS — it
      // ensures sales users never see other people's records even if they hold a
      // secondary role (accounts/documentation) that RLS would permit.
      let q = supabase
        .from("bookings")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (!isAdmin && user?.id) {
        q = q.or(`assigned_to.eq.${user.id},created_by.eq.${user.id}`);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { bookings: data ?? [] };
    },
  });

  // Which documentation person has each booking, and the file stage / TAT.
  const { data: docByBooking } = useBookingDocTasks();
  const docNow = Date.now();

  const markM = useMutation({
    mutationFn: async (id: string) => {
      const { data: row, error: gErr } = await supabase
        .from("bookings")
        .select("balance_amount, amount_received")
        .eq("id", id)
        .maybeSingle();
      if (gErr) throw new Error(gErr.message);
      if (!row) throw new Error("Booking not found");
      const bal = Number(row.balance_amount ?? 0);
      const { error } = await supabase
        .from("bookings")
        .update({
          amount_received: Number(row.amount_received ?? 0) + bal,
          balance_amount: 0,
          balance_paid_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Marked as paid");
      qc.invalidateQueries({ queryKey: ["bookings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Delete a booking. RLS restricts DELETE to admins (bookings_delete policy),
  // and child rows (booking_payments / booking_updates) cascade automatically.
  const deleteM = useMutation({
    mutationFn: async (id: string) => {
      // Audit before delete (audit_log has no FK, so it survives the delete).
      logAudit({
        actorId: user?.id, action: "delete", entity: "booking",
        entityId: id, entityLabel: toDelete?.client_name ?? toDelete?.booking_code ?? null,
        detail: `Deleted booking${toDelete?.booking_code ? ` ${toDelete.booking_code}` : ""}${toDelete?.client_name ? ` (${toDelete.client_name})` : ""}`,
      });
      const { error } = await supabase.from("bookings").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Booking deleted");
      setToDelete(null);
      qc.invalidateQueries({ queryKey: ["bookings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const today = new Date().toISOString().slice(0, 10);

  // Week boundaries (Mon-Sun) and month prefix for the date-range filter.
  // Computed as YYYY-MM-DD strings so comparisons are pure lexicographic —
  // no `new Date(dateString)` which would parse as UTC and drift by a day in
  // IST. Week starts on Monday (standard for an Indian business CRM).
  const { weekStart, weekEnd, monthPrefix } = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth(); // 0-indexed
    const d = now.getDate();
    // JS getDay(): 0=Sun … 6=Sat. Convert to Mon=0 … Sun=6.
    const jsDay = now.getDay();
    const daysSinceMonday = (jsDay + 6) % 7; // Mon=0, Tue=1, … Sun=6
    const pad = (n: number) => String(n).padStart(2, "0");

    // Build Monday of the current week
    const mon = new Date(y, m, d - daysSinceMonday);
    const wStart = `${mon.getFullYear()}-${pad(mon.getMonth() + 1)}-${pad(mon.getDate())}`;
    // Sunday = Monday + 6
    const sun = new Date(y, m, d - daysSinceMonday + 6);
    const wEnd = `${sun.getFullYear()}-${pad(sun.getMonth() + 1)}-${pad(sun.getDate())}`;

    return {
      weekStart: wStart,
      weekEnd: wEnd,
      // "YYYY-MM" prefix — a booking_date like "2026-08-19" starts with "2026-08".
      monthPrefix: `${y}-${pad(m + 1)}`,
    };
  }, [today]); // recalculates only when the calendar date changes

  // A bare `data?.bookings ?? []` hands back a brand new array on every render,
  // which would change the deps of the memos below every time and defeat them.
  const all = useMemo(() => data?.bookings ?? [], [data]);

  // Distinct sales agents (for the admin filter dropdown), sorted A–Z.
  const agents = useMemo(() => {
    const set = new Set<string>();
    for (const b of all) {
      const name = String(b.sales_agent_name ?? "").trim();
      if (name && name !== "—") set.add(name);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [all]);

  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    const sourceNeedle = (sourceParam ?? "").toLowerCase();
    return all.filter((b) => {
      // Source filter from the ?source= param (e.g. B2B-sourced bookings drilled
      // in from the admin command center). Matches booking_source as a substring
      // so "b2b" catches "B2B Referral" etc.
      if (sourceNeedle) {
        const src = String((b as { booking_source?: string | null }).booking_source ?? "").toLowerCase();
        if (!src.includes(sourceNeedle)) return false;
      }
      // Sales-agent filter (admin only; "all" = no filter).
      if (agentFilter !== "all" && String(b.sales_agent_name ?? "").trim() !== agentFilter) {
        return false;
      }
      if (typeFilter !== "all") {
        const isRenewal = isRenewalBooking(b as BookingRow);
        if (typeFilter === "renewal" && !isRenewal) return false;
        if (typeFilter === "fresh" && isRenewal) return false;
      }
      // Date-range preset filter on booking_date (plain YYYY-MM-DD strings, so
      // string comparison is chronological). "all" skips the check entirely.
      if (dateFilter !== "all") {
        const bd = String(b.booking_date ?? "");
        if (!bd) return false;
        if (dateFilter === "today" && bd !== today) return false;
        if (dateFilter === "week" && (bd < weekStart || bd > weekEnd)) return false;
        if (dateFilter === "month" && !bd.startsWith(monthPrefix)) return false;
      }
      if (!q) return true;
      return [
        b.booking_code,
        b.external_booking_id,
        b.client_name,
        b.business_name,
        b.plan_name,
        b.contact_no,
        b.email_id,
      ].some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(s),
      );
    });
  }, [all, q, agentFilter, typeFilter, dateFilter, today, weekStart, weekEnd, monthPrefix, sourceParam]);

  const rows = useMemo(() => {
    const mult = sort.dir === "asc" ? 1 : -1;
    // Copy first: Array.prototype.sort mutates, and `filtered` can be the query
    // cache's own array when there's no search term.
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sort.key, today);
      const bv = sortValue(b, sort.key, today);
      // Rows with nothing in this column (e.g. no due date) always sink to the
      // bottom, in both directions — they'd otherwise crowd out real values.
      const aBlank = av === "";
      const bBlank = bv === "";
      if (aBlank && bBlank) return 0;
      if (aBlank) return 1;
      if (bBlank) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * mult;
      // Dates are ISO strings, so plain string comparison is chronological.
      return String(av).localeCompare(String(bv)) * mult;
    });
  }, [filtered, sort, today]);

  const onSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: FIRST_CLICK_DIR[key] },
    );

  const overdue = rows.filter(
    (b) =>
      !b.balance_paid_at &&
      Number(b.balance_amount) > 0 &&
      b.balance_due_date &&
      b.balance_due_date <= today,
  );

  // Counts per type, shown on the tabs. Derived from everything the agent/search
  // filters allow EXCEPT typeFilter itself — otherwise the inactive tabs would
  // always read zero.
  const typeCounts = useMemo(() => {
    const base = all.filter((b) => {
      if (agentFilter !== "all" && String(b.sales_agent_name ?? "").trim() !== agentFilter) {
        return false;
      }
      if (!q) return true;
      const s = q.toLowerCase();
      return [
        b.booking_code,
        b.external_booking_id,
        b.client_name,
        b.business_name,
        b.plan_name,
        b.contact_no,
        b.email_id,
      ].some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(s),
      );
    });
    const renewal = base.filter((b) => isRenewalBooking(b)).length;
    return { all: base.length, renewal, fresh: base.length - renewal };
  }, [all, q, agentFilter]);

  // Totals reflect what's on screen, so they follow the search filter.
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc: { total: number; received: number; balance: number }, b) => {
          acc.total += Number(b.amount_after_tds ?? 0);
          acc.received += Number(b.amount_received ?? 0);
          acc.balance += Number(b.balance_amount ?? 0);
          return acc;
        },
        { total: 0, received: 0, balance: 0 },
      ),
    [rows],
  );

  return (
    <div className="p-5 md:p-10 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Bookings</h1>
          <p className="text-sm text-muted-foreground">
            All closed bookings synced from + New Booking.
            {!isLoading && (
              <>
                {" · "}
                <span className="font-medium text-foreground">{rows.length}</span>
                {rows.length === 1 ? " booking" : " bookings"}
                {(q || agentFilter !== "all" || typeFilter !== "all" || dateFilter !== "all") &&
                all.length !== rows.length
                  ? ` of ${all.length}`
                  : ""}
                {typeFilter !== "all" ? (typeFilter === "fresh" ? " · fresh" : " · renewals") : ""}
                {dateFilter !== "all"
                  ? dateFilter === "today"
                    ? " · today"
                    : dateFilter === "week"
                      ? " · this week"
                      : " · this month"
                  : ""}
                {agentFilter !== "all" ? ` · ${agentFilter}` : ""}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Suspense fallback={null}>
            <NewBookingDialog />
          </Suspense>
          {isAdmin && (
            <Button
              variant="outline"
              className="transition-all duration-200 ease-out hover:shadow-sm"
              onClick={() => setBulkOpen(true)}
            >
              <Upload className="h-4 w-4 mr-1" /> Bulk Upload
            </Button>
          )}
          <Button
            variant="outline"
            className="transition-all duration-200 ease-out hover:shadow-sm"
            onClick={() => setRenewalOpen(true)}
          >
            <Plus className="h-4 w-4 mr-1" /> New Renewal Booking
          </Button>
          <Select
            value={dateFilter}
            onValueChange={(v) => setDateFilter(v as typeof dateFilter)}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All time" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All time</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This week</SelectItem>
              <SelectItem value="month">This month</SelectItem>
            </SelectContent>
          </Select>
          {isAdmin && agents.length > 0 && (
            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All sales agents" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sales agents</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="relative w-72 max-w-full">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8 focus:ring-2 ring-primary/20 transition-all duration-200 ease-out"
              placeholder="Search booking, client, plan…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Type tabs, directly above the table. A segmented control rather than a
        dropdown: all three options and their counts stay visible, and switching
        is one click instead of open-then-pick.

        Styled as a frosted-glass track with a raised "lifted pill" for the
        selection — the selected and hovered states have to be distinguishable at
        a glance, so they differ on three axes at once (background opacity,
        shadow depth and text weight) rather than a single tint. */}
      <div
        className="inline-flex rounded-full border border-black/[0.06] bg-white/60 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_3px_rgba(0,0,0,0.04)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_3px_rgba(0,0,0,0.3)]"
        role="group"
        aria-label="Booking type"
      >
        {(
          [
            { id: "all", label: "All bookings", count: typeCounts.all },
            { id: "fresh", label: "Fresh bookings", count: typeCounts.fresh },
            { id: "renewal", label: "Renewal bookings", count: typeCounts.renewal },
          ] as const
        ).map((t) => {
          const active = typeFilter === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTypeFilter(t.id)}
              aria-pressed={active}
              className={[
                "group relative inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm",
                // A slightly slower curve than the app default so the lift reads
                // as movement rather than a flicker.
                "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                // Press feedback, so a tap feels physical on mobile too.
                "active:scale-[0.97]",
                active
                  ? "bg-gradient-to-b from-white to-white/85 font-semibold text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.07),0_6px_16px_-6px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.04] dark:from-white/[0.14] dark:to-white/[0.08] dark:ring-white/10"
                  : "text-muted-foreground hover:bg-white/70 hover:text-foreground hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:hover:bg-white/[0.07]",
              ].join(" ")}
            >
              {t.label}
              <span
                className={[
                  "rounded-full px-1.5 py-0.5 text-[11px] tabular-nums transition-all duration-300",
                  active
                    ? "bg-primary/12 text-primary ring-1 ring-primary/15"
                    : "bg-black/[0.05] text-muted-foreground group-hover:bg-black/[0.07] dark:bg-white/10 dark:group-hover:bg-white/[0.14]",
                ].join(" ")}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {overdue.length > 0 && (
        <Card className="p-3 border-amber-300 bg-amber-50/50 dark:bg-amber-950/20 flex items-center gap-2 shadow-sm">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <span className="text-sm">
            {overdue.length} booking(s) have a balance due today or overdue.
          </span>
        </Card>
      )}

      <Card className="overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
              <SortHeader label="Booking" sortKey="booking" sort={sort} onSort={onSort} />
              <SortHeader label="Date" sortKey="date" sort={sort} onSort={onSort} />
              <SortHeader label="Client" sortKey="client" sort={sort} onSort={onSort} />
              <SortHeader label="Plan" sortKey="plan" sort={sort} onSort={onSort} />
              <SortHeader label="Sales Agent" sortKey="agent" sort={sort} onSort={onSort} />
              <SortHeader label="Total" sortKey="total" sort={sort} onSort={onSort} align="right" />
              <SortHeader
                label="Received"
                sortKey="received"
                sort={sort}
                onSort={onSort}
                align="right"
              />
              <SortHeader
                label="Balance"
                sortKey="balance"
                sort={sort}
                onSort={onSort}
                align="right"
              />
              <SortHeader label="Due" sortKey="due" sort={sort} onSort={onSort} />
              <SortHeader label="Status" sortKey="status" sort={sort} onSort={onSort} />
              <TableHead>Documentation</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="text-center py-10 text-muted-foreground">
                  {q ? (
                    <>
                      No bookings match “{q}”.{" "}
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:text-foreground"
                        onClick={() => setQ("")}
                      >
                        Clear search
                      </button>
                    </>
                  ) : agentFilter !== "all" || typeFilter !== "all" || dateFilter !== "all" ? (
                    "No bookings match the current filters."
                  ) : (
                    "No bookings yet. Add one from the dashboard."
                  )}
                </TableCell>
              </TableRow>
            )}
            {rows.map((b, idx) => {
              const balance = Number(b.balance_amount ?? 0);
              const isPaid = !!b.balance_paid_at || balance === 0;
              const isOverdue = !isPaid && b.balance_due_date && b.balance_due_date <= today;
              return (
                <TableRow
                  key={b.id}
                  className={`transition-all duration-150 hover:bg-primary/5 ${idx % 2 === 1 ? "bg-muted/20" : ""}`}
                >
                  <TableCell className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">
                    {b.external_booking_id || b.booking_code}
                    {renewalYear(b.external_booking_id) !== null && (
                      <div className="mt-0.5 font-sans">
                        <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900">
                          Renewal · Year {renewalYear(b.external_booking_id)}
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-sm">
                    {fmtDate(b.booking_date)}
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[160px] truncate font-semibold text-sm" title={b.client_name ?? ""}>
                      {b.client_name}
                    </div>
                    {b.business_name && (
                      <div
                        className="max-w-[180px] truncate text-xs text-muted-foreground"
                        title={b.business_name}
                      >
                        {b.business_name}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[200px] truncate" title={b.plan_name ?? ""}>
                      {b.plan_name}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{b.sales_agent_name}</TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">
                    {fmtINR(Number(b.amount_after_tds))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">
                    {fmtINR(Number(b.amount_received))}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums whitespace-nowrap font-medium ${balance > 0 ? "text-amber-600" : "text-muted-foreground"}`}
                  >
                    {fmtINR(balance)}
                  </TableCell>
                  <TableCell
                    className={`whitespace-nowrap tabular-nums ${isOverdue ? "text-destructive font-medium" : b.balance_due_date ? "" : "text-muted-foreground"}`}
                  >
                    {fmtDate(b.balance_due_date)}
                  </TableCell>
                  <TableCell>
                    {isPaid ? (
                      <Badge variant="secondary" className="rounded-full whitespace-nowrap">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Paid
                      </Badge>
                    ) : isOverdue ? (
                      <Badge variant="destructive" className="rounded-full whitespace-nowrap">
                        Overdue
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="rounded-full whitespace-nowrap">
                        Pending
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="min-w-36 max-w-48">
                    <BookingDocCell task={docByBooking?.get(b.id)} now={docNow} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="transition-all duration-200 ease-out hover:shadow-sm"
                        onClick={() => setSelected(b)}
                      >
                        Open
                      </Button>
                      {!isPaid && balance > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="transition-all duration-200 ease-out hover:shadow-sm"
                          disabled={markM.isPending}
                          onClick={() => markM.mutate(b.id)}
                        >
                          Mark Paid
                        </Button>
                      )}
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10 transition-all duration-200 ease-out hover:shadow-sm"
                          title="Delete booking"
                          onClick={() => setToDelete(b)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {!isLoading && rows.length > 0 && (
            <TableFooter>
              <TableRow className="hover:bg-transparent bg-muted/30 border-t-2 border-border font-semibold">
                <TableCell colSpan={5} className="text-xs text-muted-foreground">
                  {q || agentFilter !== "all" || typeFilter !== "all" || dateFilter !== "all"
                    ? "Filtered total"
                    : "Total"}
                </TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">
                  {fmtINR(totals.total)}
                </TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">
                  {fmtINR(totals.received)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums whitespace-nowrap ${totals.balance > 0 ? "text-amber-600" : ""}`}
                >
                  {fmtINR(totals.balance)}
                </TableCell>
                <TableCell colSpan={3} />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </Card>

      <BookingDetailDialog
        booking={selected}
        open={!!selected}
        onOpenChange={(v) => {
          if (!v) setSelected(null);
        }}
      />

      {/* Renewals keep their own form: no TDS, no quoted-price discount, and a
        separate Google Sheet with a different column order. Mounted only once
        opened so its chunk is not fetched on every visit. */}
      {renewalOpen && (
        <Suspense fallback={null}>
          <NewRenewalBookingDialog
            open={renewalOpen}
            onClose={() => setRenewalOpen(false)}
            userId={user?.id ?? null}
          />
        </Suspense>
      )}
      {isAdmin && <BulkUploadDialog open={bulkOpen} onOpenChange={setBulkOpen} />}

      {isAdmin && (
        <AlertDialog open={!!toDelete} onOpenChange={(v) => { if (!v && !deleteM.isPending) setToDelete(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this booking?</AlertDialogTitle>
              <AlertDialogDescription>
                {toDelete && (
                  <>
                    This will permanently delete booking{" "}
                    <span className="font-medium text-foreground">
                      {toDelete.external_booking_id || toDelete.booking_code}
                    </span>{" "}
                    for <span className="font-medium text-foreground">{toDelete.client_name}</span>,
                    along with its payment history. This cannot be undone.
                    {" "}Any invoice already created in Zoho is not affected and must be voided there separately.
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteM.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleteM.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  if (toDelete) deleteM.mutate(toDelete.id);
                }}
              >
                {deleteM.isPending ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
