// Referrals module — the partner-sourced referrals handed into the Sales
// funnel (spec section 12). A partner (CA firm) is NOT a referral: one firm
// sends many referrals, so each row here links back to its firm 360.
//
// Lives as a heavy component (query + table + three dialogs) out of the route
// file so it stays code-split, mirroring firm-360 / partnership-pipeline.
//
// The referral -> Sales Lead -> Booking chain is ADDITIVE: "Push to Sales"
// inserts a brand new public.leads row and stores its id back on the referral;
// "Link booking" attaches an existing booking and captures its revenue. Neither
// mutates existing Sales leads/bookings.

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Share2, Plus, Building2, ArrowRightLeft, Link2, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/utils";
import { logAudit } from "@/lib/audit";
import { REFERRAL_STATUSES } from "@/lib/b2b";
import { SERVICES, SOURCES, labelFor as crmLabelFor } from "@/lib/crm";
import {
  bookingRevenue,
  convertReferralToLead,
  createReferral,
  linkReferralBooking,
  listFirmContacts,
  listFirms,
  listLinkableBookings,
  listReferralsWithRefs,
  updateReferral,
  type LinkableBooking,
  type ReferralWithRefs,
} from "@/lib/b2b-queries";

function money(n: number | string | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return "—";
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : format(d, "dd MMM yyyy");
}

function statusBadge(status: string) {
  const st = REFERRAL_STATUSES.find((s) => s.id === status);
  return st ? (
    <Badge className={`${st.color} text-white hover:${st.color}`}>{st.label}</Badge>
  ) : (
    <Badge variant="outline">{status}</Badge>
  );
}

export function ReferralsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [convertFor, setConvertFor] = useState<ReferralWithRefs | null>(null);
  const [linkFor, setLinkFor] = useState<ReferralWithRefs | null>(null);

  const { data: referrals = [], isLoading } = useQuery({
    queryKey: ["b2b-referrals", statusFilter],
    queryFn: () => listReferralsWithRefs(statusFilter === "all" ? {} : { status: statusFilter }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["b2b-referrals"] });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return referrals;
    return referrals.filter((r) =>
      [
        r.referral_code,
        r.referred_client_name,
        r.client_phone,
        r.firm_name,
        r.referring_contact_name,
        r.service_required,
      ]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(term)),
    );
  }, [referrals, search]);

  return (
    <div className="p-5 md:p-10 space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-[image:var(--gradient-brand)] text-primary-foreground">
            <Share2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Referrals</h1>
            <p className="text-sm text-muted-foreground">
              Client referrals handed by partner CA firms into the Sales funnel.
            </p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> New Referral
        </Button>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4 flex flex-wrap gap-2">
          <Input
            className="flex-1 min-w-56"
            placeholder="Search client, firm, contact, phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {REFERRAL_STATUSES.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
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
            <p className="text-sm text-muted-foreground py-16 text-center">No referrals yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Referral ID</TableHead>
                  <TableHead>CA Firm</TableHead>
                  <TableHead>Referring Contact</TableHead>
                  <TableHead>Referred Client</TableHead>
                  <TableHead>Client Phone</TableHead>
                  <TableHead>Date Received</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Converted?</TableHead>
                  <TableHead>Booking</TableHead>
                  <TableHead className="text-right">Booking Value</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead>Converted Date</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      {r.referral_code ?? r.id.slice(0, 8)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {r.firm_id ? (
                        <Link
                          to="/b2b/firms/$id"
                          params={{ id: r.firm_id }}
                          className="inline-flex items-center gap-1 hover:underline"
                        >
                          <Building2 className="h-3 w-3" />
                          {r.firm_name ?? "Firm"}
                        </Link>
                      ) : (
                        (r.firm_name ?? "—")
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {r.referring_contact_name ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {r.referred_client_name ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{r.client_phone ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDate(r.date_received)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {r.service_required ? crmLabelFor(SERVICES, r.service_required) : "—"}
                    </TableCell>
                    <TableCell>{statusBadge(r.referral_status)}</TableCell>
                    <TableCell>
                      {r.converted ? (
                        <Badge className="bg-success text-white hover:bg-success">
                          Yes
                        </Badge>
                      ) : (
                        <Badge variant="outline">No</Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {r.booking_id ? (
                        <Badge variant="outline">Linked</Badge>
                      ) : r.lead_id ? (
                        <span className="text-xs text-muted-foreground">Lead only</span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap">
                      {money(r.booking_value)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap">
                      {money(r.revenue)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDate(r.converted_date)}</TableCell>
                    <TableCell className="max-w-[200px] truncate" title={r.notes ?? ""}>
                      {r.notes ?? "—"}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <div className="flex justify-end gap-1">
                        {r.lead_id ? (
                          <Link to="/leads/$id" params={{ id: r.lead_id }} className="inline-flex">
                            <Button size="sm" variant="ghost" title="Open Sales lead">
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          </Link>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Push to Sales (create lead)"
                            onClick={() => setConvertFor(r)}
                          >
                            <ArrowRightLeft className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Link booking"
                          onClick={() => setLinkFor(r)}
                        >
                          <Link2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NewReferralDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={invalidate} />
      <ConvertReferralDialog
        referral={convertFor}
        onOpenChange={(v) => !v && setConvertFor(null)}
        onConverted={invalidate}
      />
      <LinkBookingDialog
        referral={linkFor}
        onOpenChange={(v) => !v && setLinkFor(null)}
        onLinked={invalidate}
      />
    </div>
  );
}

function NewReferralDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const { user } = useAuth();
  const [firmId, setFirmId] = useState<string>("");
  const [contactId, setContactId] = useState<string>("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [service, setService] = useState<string>("");
  const [dateReceived, setDateReceived] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const { data: firms = [] } = useQuery({
    queryKey: ["b2b-firms-for-referral"],
    queryFn: () => listFirms(),
    enabled: open,
  });
  const { data: contacts = [] } = useQuery({
    queryKey: ["b2b-firm-contacts", firmId],
    queryFn: () => listFirmContacts(firmId),
    enabled: open && !!firmId,
  });

  const reset = () => {
    setFirmId("");
    setContactId("");
    setClientName("");
    setClientPhone("");
    setService("");
    setDateReceived(new Date().toISOString().slice(0, 10));
    setNotes("");
  };

  const create = useMutation({
    mutationFn: () =>
      createReferral({
        firm_id: firmId || null,
        referring_contact_id: contactId || null,
        referred_client_name: clientName.trim() || null,
        client_phone: clientPhone.trim() || null,
        service_required: service || null,
        date_received: dateReceived || null,
        referral_date: dateReceived || null,
        assigned_salesperson: user!.id,
        notes: notes.trim() || null,
        created_by: user!.id,
      }),
    onSuccess: (ref) => {
      toast.success("Referral created");
      logAudit({
        actorId: user?.id,
        action: "create",
        entity: "referral",
        entityId: ref.id,
        entityLabel: clientName.trim() || null,
        detail: "Created referral",
      });
      reset();
      onOpenChange(false);
      onCreated();
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Referral</DialogTitle>
          <DialogDescription>
            Pick the partner CA firm and the person who referred, then capture the client.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>CA Firm</Label>
              <Select
                value={firmId}
                onValueChange={(v) => {
                  setFirmId(v);
                  setContactId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select firm" />
                </SelectTrigger>
                <SelectContent>
                  {firms.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.firm_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Referring Contact</Label>
              <Select value={contactId} onValueChange={setContactId} disabled={!firmId}>
                <SelectTrigger>
                  <SelectValue placeholder={firmId ? "Select contact" : "Pick a firm first"} />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ref-client">Referred Client Name</Label>
              <Input
                id="ref-client"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ref-phone">Client Phone</Label>
              <Input
                id="ref-phone"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Service Required</Label>
              <Select value={service} onValueChange={setService}>
                <SelectTrigger>
                  <SelectValue placeholder="Select service" />
                </SelectTrigger>
                <SelectContent>
                  {SERVICES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ref-date">Date Received</Label>
              <Input
                id="ref-date"
                type="date"
                value={dateReceived}
                onChange={(e) => setDateReceived(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ref-notes">Notes</Label>
            <Textarea
              id="ref-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={!user || !firmId || create.isPending}>
            {create.isPending ? "Saving…" : "Create referral"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConvertReferralDialog({
  referral,
  onOpenChange,
  onConverted,
}: {
  referral: ReferralWithRefs | null;
  onOpenChange: (v: boolean) => void;
  onConverted: () => void;
}) {
  const { user } = useAuth();
  const open = !!referral;
  const [clientName, setClientName] = useState("");
  const [mobile, setMobile] = useState("");
  const [service, setService] = useState<string>("virtual_office");

  // Seed the form from the referral whenever a new one opens the dialog.
  const key = referral?.id ?? "";
  const [lastKey, setLastKey] = useState("");
  if (key !== lastKey) {
    setLastKey(key);
    setClientName(referral?.referred_client_name ?? "");
    setMobile(referral?.client_phone ?? "");
    setService(
      SERVICES.some((s) => s.id === referral?.service_required)
        ? (referral!.service_required as string)
        : "virtual_office",
    );
  }

  const convert = useMutation({
    mutationFn: () =>
      convertReferralToLead({
        referral: referral!,
        clientName: clientName.trim(),
        mobile: mobile.trim(),
        serviceRequired: service,
        source: "referral",
        actorId: user!.id,
      }),
    onSuccess: ({ leadId }) => {
      toast.success("Referral pushed to Sales as a new lead");
      logAudit({
        actorId: user?.id,
        action: "stage_change",
        entity: "referral",
        entityId: referral!.id,
        entityLabel: clientName.trim() || null,
        detail: "Converted referral to Sales lead",
        meta: { leadId },
      });
      onOpenChange(false);
      onConverted();
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Push to Sales</DialogTitle>
          <DialogDescription>
            Creates a new Sales lead from this referral and links it back. Existing leads are not
            touched.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cv-name">Client Name</Label>
            <Input
              id="cv-name"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cv-mobile">Mobile</Label>
            <Input id="cv-mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Service Required</Label>
            <Select value={service} onValueChange={setService}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SERVICES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Source will be set to {crmLabelFor(SOURCES, "referral")}.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => convert.mutate()}
            disabled={!user || !clientName.trim() || !mobile.trim() || convert.isPending}
          >
            {convert.isPending ? "Pushing…" : "Create Sales lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LinkBookingDialog({
  referral,
  onOpenChange,
  onLinked,
}: {
  referral: ReferralWithRefs | null;
  onOpenChange: (v: boolean) => void;
  onLinked: () => void;
}) {
  const { user } = useAuth();
  const open = !!referral;
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<LinkableBooking | null>(null);

  const key = referral?.id ?? "";
  const [lastKey, setLastKey] = useState("");
  if (key !== lastKey) {
    setLastKey(key);
    setSearch("");
    setSelected(null);
  }

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ["b2b-linkable-bookings", search],
    queryFn: () => listLinkableBookings(search.trim() || undefined),
    enabled: open,
  });

  const link = useMutation({
    mutationFn: () => {
      const revenue = bookingRevenue(selected!);
      const bookingValue = Number(selected!.total_amount) || revenue;
      return linkReferralBooking({
        referralId: referral!.id,
        bookingId: selected!.id,
        bookingValue,
        revenue,
      });
    },
    onSuccess: () => {
      toast.success("Booking linked to referral");
      logAudit({
        actorId: user?.id,
        action: "edit",
        entity: "referral",
        entityId: referral!.id,
        entityLabel: referral!.referred_client_name ?? null,
        detail: "Linked booking + captured revenue",
        meta: { bookingId: selected!.id },
      });
      onOpenChange(false);
      onLinked();
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  // Allow re-pushing a status back if the booking link is being removed later is
  // out of scope; this dialog only links.
  const markLost = useMutation({
    mutationFn: () => updateReferral(referral!.id, { referral_status: "lost" }),
    onSuccess: () => {
      toast.success("Referral marked lost");
      logAudit({
        actorId: user?.id,
        action: "stage_change",
        entity: "referral",
        entityId: referral!.id,
        detail: "Marked referral lost",
      });
      onOpenChange(false);
      onLinked();
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link a Booking</DialogTitle>
          <DialogDescription>
            Attach an existing booking to this referral to capture its value and revenue. The
            booking itself is not changed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Search bookings by client…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
            {isLoading ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
            ) : bookings.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No bookings found.</p>
            ) : (
              bookings.map((b) => {
                const active = selected?.id === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelected(b)}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                      active ? "bg-primary/10" : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{b.client_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {b.booking_code ?? b.id.slice(0, 8)} · {fmtDate(b.booking_date)}
                      </div>
                    </div>
                    <div className="text-right tabular-nums shrink-0">
                      {money(bookingRevenue(b))}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button
            variant="ghost"
            className="mr-auto text-destructive hover:text-destructive"
            onClick={() => markLost.mutate()}
            disabled={!user || markLost.isPending}
          >
            Mark lost
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => link.mutate()} disabled={!user || !selected || link.isPending}>
            {link.isPending ? "Linking…" : "Link booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
