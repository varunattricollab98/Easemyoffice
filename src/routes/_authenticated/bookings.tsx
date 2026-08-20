import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
} from "lucide-react";
import { toast } from "sonner";
import { BookingDetailDialog } from "@/components/bookings/booking-detail-dialog";
import { BulkUploadDialog } from "@/components/bookings/bulk-upload-dialog";
import type { Tables } from "@/integrations/supabase/types";

// Use the generated row type rather than `any`, so the sort accessors below are
// checked against the real column names and types.
type BookingRow = Tables<"bookings">;

export const Route = createFileRoute("/_authenticated/bookings")({
  component: BookingsPage,
});

const fmtINR = (n: number) => `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

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
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<BookingRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: "date", dir: "desc" });

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

  const today = new Date().toISOString().slice(0, 10);
  // A bare `data?.bookings ?? []` hands back a brand new array on every render,
  // which would change the deps of the memos below every time and defeat them.
  const all = useMemo(() => data?.bookings ?? [], [data]);

  const filtered = useMemo(() => {
    if (!q) return all;
    const s = q.toLowerCase();
    return all.filter((b) =>
      [
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
      ),
    );
  }, [all, q]);

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
                {q && all.length !== rows.length ? ` of ${all.length}` : ""}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <Button
              variant="outline"
              className="transition-all duration-200 ease-out hover:shadow-sm"
              onClick={() => setBulkOpen(true)}
            >
              <Upload className="h-4 w-4 mr-1" /> Bulk Upload
            </Button>
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
            <TableRow className="bg-muted/40 hover:bg-muted/40">
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
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-10 text-muted-foreground">
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
                  ) : (
                    "No bookings yet. Add one from the dashboard."
                  )}
                </TableCell>
              </TableRow>
            )}
            {rows.map((b) => {
              const balance = Number(b.balance_amount ?? 0);
              const isPaid = !!b.balance_paid_at || balance === 0;
              const isOverdue = !isPaid && b.balance_due_date && b.balance_due_date <= today;
              return (
                <TableRow
                  key={b.id}
                  className="transition-all duration-200 ease-out hover:bg-accent/30"
                >
                  <TableCell className="font-mono text-xs whitespace-nowrap">
                    {b.external_booking_id || b.booking_code}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {fmtDate(b.booking_date)}
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[180px] truncate font-medium" title={b.client_name ?? ""}>
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
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {!isLoading && rows.length > 0 && (
            <TableFooter>
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="text-xs text-muted-foreground">
                  {q ? "Filtered total" : "Total"}
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
      {isAdmin && <BulkUploadDialog open={bulkOpen} onOpenChange={setBulkOpen} />}
    </div>
  );
}
