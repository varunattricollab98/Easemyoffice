import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Building2, Mail, Phone, ChevronDown, ChevronRight, Users2, Wallet } from "lucide-react";
import { useState, useMemo, Fragment } from "react";

export const Route = createFileRoute("/_authenticated/clients")({
  head: () => ({ meta: [{ title: "Client Database — EaseMyOffice CRM" }] }),
  component: ClientsPage,
});

const fmtINR = (n: number) => `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

// Normalise an Indian phone number to its last 10 digits for de-duplication.
function normPhone(v?: string) {
  const digits = String(v ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

// A single de-duplicated client, aggregated from one or many bookings.
type ClientRow = {
  key: string;
  name: string;
  company: string;
  email: string;
  phones: string[];
  bookingIds: string[];
  count: number;
  totalPaid: number;
  totalBalance: number;
  firstDate: string;
  lastDate: string;
  bookings: any[];
};

// Group all booking rows into one record per unique client.
// Identity priority: phone number → email → client name (so the same person
// booking again / renewing lands on the same client, avoiding duplicates).
function buildClients(bookings: any[]): ClientRow[] {
  const map = new Map<string, ClientRow>();

  for (const b of bookings) {
    const phone = normPhone(b.contact_no);
    const email = String(b.email_id ?? "").trim().toLowerCase();
    const name = String(b.client_name ?? "").trim().toLowerCase();
    const key = phone ? `p:${phone}` : email ? `e:${email}` : name ? `n:${name}` : `id:${b.id}`;

    let c = map.get(key);
    if (!c) {
      c = {
        key,
        name: b.client_name || "—",
        company: b.business_name || "",
        email: b.email_id || "",
        phones: [],
        bookingIds: [],
        count: 0,
        totalPaid: 0,
        totalBalance: 0,
        firstDate: b.booking_date,
        lastDate: b.booking_date,
        bookings: [],
      };
      map.set(key, c);
    }

    // Keep the most recent booking's name/company/email as the canonical one.
    if (b.booking_date >= c.lastDate) {
      c.lastDate = b.booking_date;
      if (b.client_name) c.name = b.client_name;
      if (b.business_name) c.company = b.business_name;
      if (b.email_id) c.email = b.email_id;
    }
    if (b.booking_date < c.firstDate) c.firstDate = b.booking_date;

    // Collect every distinct phone number seen for this client.
    for (const p of [b.contact_no, b.alt_contact_no, b.alt_contact_no_2]) {
      const t = String(p ?? "").trim();
      if (t && !c.phones.includes(t)) c.phones.push(t);
    }

    c.bookingIds.push(b.external_booking_id || b.booking_code);
    c.count += 1;
    c.totalPaid += Number(b.amount_received ?? 0);
    c.totalBalance += Number(b.balance_amount ?? 0);
    c.bookings.push(b);
  }

  const list = Array.from(map.values());
  for (const c of list) c.bookings.sort((a, b) => (a.booking_date < b.booking_date ? 1 : -1));
  // Highest lifetime value first.
  list.sort((a, b) => b.totalPaid - a.totalPaid);
  return list;
}

function ClientsPage() {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ["clients-bookings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bookings")
        .select("id, booking_code, external_booking_id, booking_date, client_name, business_name, email_id, contact_no, alt_contact_no, alt_contact_no_2, plan_name, sales_agent_name, amount_after_tds, amount_received, balance_amount, balance_paid_at")
        .order("booking_date", { ascending: false })
        .limit(5000);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const clients = useMemo(() => buildClients(bookings), [bookings]);

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return clients;
    return clients.filter((c) =>
      [c.name, c.company, c.email, ...c.phones, ...c.bookingIds].some((v) =>
        String(v ?? "").toLowerCase().includes(t),
      ),
    );
  }, [clients, search]);

  const totalLifetime = useMemo(() => filtered.reduce((s, c) => s + c.totalPaid, 0), [filtered]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Client Database</h1>
          <p className="text-sm text-muted-foreground">
            One record per client — all bookings &amp; renewals merged, with total amount paid over time.
          </p>
        </div>
        <div className="relative w-72 max-w-full">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search name, company, phone, email, booking ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Users2 className="h-4 w-4" /> Unique Clients</div>
          <div className="text-2xl font-bold mt-1">{filtered.length}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Wallet className="h-4 w-4" /> Total Amount Paid (lifetime)</div>
          <div className="text-2xl font-bold mt-1">{fmtINR(totalLifetime)}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Building2 className="h-4 w-4" /> Total Bookings</div>
          <div className="text-2xl font-bold mt-1">{filtered.reduce((s, c) => s + c.count, 0)}</div>
        </Card>
      </div>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="text-center">Bookings</TableHead>
              <TableHead className="text-right">Total Paid</TableHead>
              <TableHead className="text-right">Balance Due</TableHead>
              <TableHead>Since</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
            {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No clients yet. Add a booking to build the database.</TableCell></TableRow>}
            {filtered.map((c) => {
              const isOpen = expanded.has(c.key);
              return (
                <Fragment key={c.key}>
                  <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => toggle(c.key)}>
                    <TableCell className="align-top pt-4">
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{c.name}</div>
                      {c.company && <div className="text-xs text-muted-foreground flex items-center gap-1"><Building2 className="h-3 w-3" />{c.company}</div>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {c.phones.length === 0 ? "—" : (
                        <div className="space-y-0.5">
                          {c.phones.map((p, i) => (
                            <div key={i} className="flex items-center gap-1.5"><Phone className="h-3 w-3 text-muted-foreground" />{p}</div>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {c.email ? <span className="flex items-center gap-1.5"><Mail className="h-3 w-3 text-muted-foreground" />{c.email}</span> : "—"}
                    </TableCell>
                    <TableCell className="text-center"><Badge variant="secondary">{c.count}</Badge></TableCell>
                    <TableCell className="text-right font-semibold text-emerald-600">{fmtINR(c.totalPaid)}</TableCell>
                    <TableCell className={`text-right ${c.totalBalance > 0 ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>{fmtINR(c.totalBalance)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.firstDate}</TableCell>
                  </TableRow>

                  {isOpen && (
                    <TableRow className="bg-muted/20 hover:bg-muted/20">
                      <TableCell></TableCell>
                      <TableCell colSpan={7} className="py-3">
                        <div className="text-xs font-medium text-muted-foreground mb-2">
                          {c.count} booking{c.count > 1 ? "s" : ""} / renewal{c.count > 1 ? "s" : ""} for this client
                        </div>
                        <div className="rounded-md border bg-background overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Booking ID</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Plan</TableHead>
                                <TableHead>Sales Agent</TableHead>
                                <TableHead className="text-right">Total</TableHead>
                                <TableHead className="text-right">Paid</TableHead>
                                <TableHead className="text-right">Balance</TableHead>
                                <TableHead>Status</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {c.bookings.map((b) => {
                                const bal = Number(b.balance_amount ?? 0);
                                const paid = !!b.balance_paid_at || bal === 0;
                                return (
                                  <TableRow key={b.id}>
                                    <TableCell className="font-mono text-xs">{b.external_booking_id || b.booking_code}</TableCell>
                                    <TableCell className="text-sm">{b.booking_date}</TableCell>
                                    <TableCell className="text-sm">{b.plan_name}</TableCell>
                                    <TableCell className="text-sm">{b.sales_agent_name}</TableCell>
                                    <TableCell className="text-right text-sm">{fmtINR(Number(b.amount_after_tds))}</TableCell>
                                    <TableCell className="text-right text-sm">{fmtINR(Number(b.amount_received))}</TableCell>
                                    <TableCell className={`text-right text-sm ${bal > 0 ? "text-amber-600" : ""}`}>{fmtINR(bal)}</TableCell>
                                    <TableCell>{paid ? <Badge variant="secondary">Paid</Badge> : <Badge variant="outline">Pending</Badge>}</TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
