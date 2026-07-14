import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Building2, Mail, Phone, ChevronDown, ChevronRight, Users2, Wallet, Crown, Gem } from "lucide-react";
import { useState, useMemo, Fragment } from "react";
import { ClientDetailDialog } from "@/components/clients/client-detail-dialog";

export const Route = createFileRoute("/_authenticated/clients")({
  head: () => ({ meta: [{ title: "Client Database — EaseMyOffice CRM" }] }),
  component: ClientsPage,
});

const fmtINR = (n: number) => `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

// ── Category thresholds (₹ lifetime paid). Adjust to your business numbers. ──
const PREMIUM_MIN = 50000;
const SEMI_MIN = 20000;

function normPhone(v?: string) {
  const digits = String(v ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

type ClientRow = {
  key: string;
  name: string;
  company: string;
  email: string;
  phones: string[];
  bookingIds: string[];
  count: number;
  paymentCount: number;
  totalPaid: number;
  totalBalance: number;
  firstDate: string;
  lastDate: string;
  bookings: any[];
  tier: "Premium" | "Semi-premium" | "Normal";
  style: "Full payment" | "Part payments" | "Has dues";
};

function tierOf(totalPaid: number): ClientRow["tier"] {
  if (totalPaid >= PREMIUM_MIN) return "Premium";
  if (totalPaid >= SEMI_MIN) return "Semi-premium";
  return "Normal";
}

function styleOf(totalBalance: number, count: number, paymentCount: number): ClientRow["style"] {
  if (totalBalance > 0) return "Has dues";
  if (paymentCount > count) return "Part payments"; // more than one payment per booking → pays in parts / negotiates
  return "Full payment"; // pays the whole amount at once
}

// Group booking rows into one record per unique client (phone → email → name).
function buildClients(bookings: any[], payCountByBooking: Map<string, number>): ClientRow[] {
  const map = new Map<string, ClientRow>();

  for (const b of bookings) {
    const phone = normPhone(b.contact_no);
    const email = String(b.email_id ?? "").trim().toLowerCase();
    const name = String(b.client_name ?? "").trim().toLowerCase();
    const key = phone ? `p:${phone}` : email ? `e:${email}` : name ? `n:${name}` : `id:${b.id}`;

    let c = map.get(key);
    if (!c) {
      c = {
        key, name: b.client_name || "—", company: b.business_name || "", email: b.email_id || "",
        phones: [], bookingIds: [], count: 0, paymentCount: 0, totalPaid: 0, totalBalance: 0,
        firstDate: b.booking_date, lastDate: b.booking_date, bookings: [],
        tier: "Normal", style: "Full payment",
      };
      map.set(key, c);
    }

    if (b.booking_date >= c.lastDate) {
      c.lastDate = b.booking_date;
      if (b.client_name) c.name = b.client_name;
      if (b.business_name) c.company = b.business_name;
      if (b.email_id) c.email = b.email_id;
    }
    if (b.booking_date < c.firstDate) c.firstDate = b.booking_date;

    for (const p of [b.contact_no, b.alt_contact_no, b.alt_contact_no_2]) {
      const t = String(p ?? "").trim();
      if (t && !c.phones.includes(t)) c.phones.push(t);
    }

    c.bookingIds.push(b.external_booking_id || b.booking_code);
    c.count += 1;
    c.paymentCount += payCountByBooking.get(b.id) ?? 0;
    c.totalPaid += Number(b.amount_received ?? 0);
    c.totalBalance += Number(b.balance_amount ?? 0);
    c.bookings.push(b);
  }

  const list = Array.from(map.values());
  for (const c of list) {
    c.bookings.sort((a, b) => (a.booking_date < b.booking_date ? 1 : -1));
    c.tier = tierOf(c.totalPaid);
    c.style = styleOf(c.totalBalance, c.count, c.paymentCount);
  }
  list.sort((a, b) => b.totalPaid - a.totalPaid);
  return list;
}

function TierBadge({ tier }: { tier: ClientRow["tier"] }) {
  if (tier === "Premium")
    return <Badge className="bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100 gap-1"><Crown className="h-3 w-3" />Premium</Badge>;
  if (tier === "Semi-premium")
    return <Badge className="bg-violet-100 text-violet-800 border-violet-300 hover:bg-violet-100 gap-1"><Gem className="h-3 w-3" />Semi-premium</Badge>;
  return <Badge variant="secondary">Normal</Badge>;
}

function StyleBadge({ style }: { style: ClientRow["style"] }) {
  if (style === "Full payment")
    return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-100">Full payment</Badge>;
  if (style === "Part payments")
    return <Badge className="bg-blue-100 text-blue-800 border-blue-300 hover:bg-blue-100">Part payments</Badge>;
  return <Badge className="bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100">Has dues</Badge>;
}

function ClientsPage() {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<ClientRow | null>(null);

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

  // How many payment installments per booking (for the "payment style" tag).
  const { data: payCounts = new Map<string, number>() } = useQuery({
    queryKey: ["clients-payment-counts"],
    queryFn: async () => {
      const { data } = await supabase.from("booking_payments").select("booking_id").limit(20000);
      const m = new Map<string, number>();
      for (const r of (data ?? []) as any[]) m.set(r.booking_id, (m.get(r.booking_id) ?? 0) + 1);
      return m;
    },
  });

  const clients = useMemo(() => buildClients(bookings, payCounts), [bookings, payCounts]);

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return clients;
    return clients.filter((c) =>
      [c.name, c.company, c.email, c.tier, c.style, ...c.phones, ...c.bookingIds].some((v) =>
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
            One record per client — all bookings &amp; renewals merged. Click a name to see the full history.
          </p>
        </div>
        <div className="relative w-72 max-w-full">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search name, company, phone, email, category…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

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
              <TableHead>Category</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="text-center">Bookings</TableHead>
              <TableHead className="text-right">Total Paid</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
            {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No clients yet. Add a booking to build the database.</TableCell></TableRow>}
            {filtered.map((c) => {
              const isOpen = expanded.has(c.key);
              return (
                <Fragment key={c.key}>
                  <TableRow className="hover:bg-muted/40">
                    <TableCell className="align-top pt-4 cursor-pointer" onClick={() => toggle(c.key)}>
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </TableCell>
                    <TableCell>
                      <button className="text-left group" onClick={() => setDetail(c)}>
                        <div className="font-medium text-primary group-hover:underline">{c.name}</div>
                        {c.company && <div className="text-xs text-muted-foreground flex items-center gap-1"><Building2 className="h-3 w-3" />{c.company}</div>}
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 items-start">
                        <TierBadge tier={c.tier} />
                        <StyleBadge style={c.style} />
                      </div>
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
                      {c.email ? <button className="flex items-center gap-1.5 text-primary hover:underline" onClick={() => setDetail(c)}><Mail className="h-3 w-3" />{c.email}</button> : "—"}
                    </TableCell>
                    <TableCell className="text-center"><Badge variant="secondary">{c.count}</Badge></TableCell>
                    <TableCell className="text-right font-semibold text-emerald-600">{fmtINR(c.totalPaid)}</TableCell>
                    <TableCell className={`text-right ${c.totalBalance > 0 ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>{fmtINR(c.totalBalance)}</TableCell>
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

      <ClientDetailDialog client={detail} open={!!detail} onOpenChange={(v) => !v && setDetail(null)} />
    </div>
  );
}
