import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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
import { Building2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { guardRoles } from "@/lib/route-guard";
import { getErrorMessage } from "@/lib/utils";
import { logAudit } from "@/lib/audit";
import { FIRM_SIZES, FIRM_TYPES, PARTNER_HEALTH, type CaFirm } from "@/lib/b2b";
import { createFirm, listAssignableUsers, listFirms, type FirmFilters } from "@/lib/b2b-queries";

export const Route = createFileRoute("/_authenticated/b2b/firms/")({
  head: () => ({ meta: [{ title: "CA Firms — EaseMyOffice CRM" }] }),
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "b2b"]);
  },
  component: FirmsListPage,
});

function partnerBadge(status: string | null) {
  const h = PARTNER_HEALTH.find((p) => p.id === status);
  if (!h) return <Badge variant="outline">{status ?? "—"}</Badge>;
  return <Badge className={`${h.color} text-white hover:${h.color}`}>{h.label}</Badge>;
}

function FirmsListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [owner, setOwner] = useState("all");
  const [place, setPlace] = useState("");
  const [open, setOpen] = useState(false);

  const filters: FirmFilters = useMemo(
    () => ({
      search: q.trim() || undefined,
      partnerStatus: status === "all" ? undefined : status,
      assignedTo: owner === "all" ? undefined : owner,
    }),
    [q, status, owner],
  );

  const { data: firms = [], isLoading } = useQuery({
    queryKey: ["b2b-firms", filters],
    queryFn: () => listFirms(filters),
  });

  const { data: users = [] } = useQuery({
    queryKey: ["b2b-assignable-users"],
    queryFn: listAssignableUsers,
  });

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    users.forEach((u) => m.set(u.id, u.full_name || u.email || ""));
    return m;
  }, [users]);

  // City/State is a free-text client filter on top of the server query.
  const rows = useMemo(() => {
    const needle = place.trim().toLowerCase();
    if (!needle) return firms;
    return firms.filter((f) => `${f.city ?? ""} ${f.state ?? ""}`.toLowerCase().includes(needle));
  }, [firms, place]);

  return (
    <div className="p-5 md:p-10 space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-[image:var(--gradient-brand)] text-primary-foreground">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">CA Firms</h1>
            <p className="text-sm text-muted-foreground">
              Partner accounts.
              {rows.length > 0 && (
                <>
                  {" "}
                  · <span className="font-medium text-foreground">{rows.length}</span> shown
                </>
              )}
            </p>
          </div>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> New CA Firm
        </Button>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4 flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-56">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search firm name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Partner status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {PARTNER_HEALTH.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Owner" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All owners</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.full_name || u.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative w-[180px]">
            <Input
              placeholder="City / State"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Desktop table */}
      <Card className="shadow-sm hidden md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Firm Name</TableHead>
                <TableHead>Partner Status</TableHead>
                <TableHead>City / State</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Partner Score</TableHead>
                <TableHead>Partner Since</TableHead>
                <TableHead>Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    No firms yet.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((f) => (
                <TableRow
                  key={f.id}
                  className="cursor-pointer"
                  onClick={() => navigate({ to: "/b2b/firms/$id", params: { id: f.id } })}
                >
                  <TableCell className="font-medium">{f.firm_name}</TableCell>
                  <TableCell>{partnerBadge(f.partner_status)}</TableCell>
                  <TableCell>{[f.city, f.state].filter(Boolean).join(", ") || "—"}</TableCell>
                  <TableCell>{f.assigned_to ? nameById.get(f.assigned_to) || "—" : "—"}</TableCell>
                  <TableCell className="text-right">
                    {f.partner_score != null ? Math.round(Number(f.partner_score)) : "—"}
                  </TableCell>
                  <TableCell>
                    {f.partner_since ? format(new Date(f.partner_since), "dd MMM yyyy") : "—"}
                  </TableCell>
                  <TableCell>{format(new Date(f.updated_at), "dd MMM yyyy")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {!isLoading && rows.length === 0 && (
          <Card className="shadow-sm">
            <CardContent className="p-6 text-center text-muted-foreground">
              No firms yet.
            </CardContent>
          </Card>
        )}
        {rows.map((f) => (
          <Card
            key={f.id}
            className="shadow-sm active:scale-[0.99] transition-transform"
            onClick={() => navigate({ to: "/b2b/firms/$id", params: { id: f.id } })}
          >
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">{f.firm_name}</div>
                {partnerBadge(f.partner_status)}
              </div>
              <div className="text-sm text-muted-foreground">
                {[f.city, f.state].filter(Boolean).join(", ") || "No location"}
              </div>
              <div className="text-xs text-muted-foreground">
                Owner: {f.assigned_to ? nameById.get(f.assigned_to) || "—" : "Unassigned"}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <NewFirmDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={async (firm) => {
          logAudit({
            actorId: user?.id,
            action: "create",
            entity: "ca_firm",
            entityId: firm.id,
            entityLabel: firm.firm_name,
          });
          await qc.invalidateQueries({ queryKey: ["b2b-firms"] });
          navigate({ to: "/b2b/firms/$id", params: { id: firm.id } });
        }}
      />
    </div>
  );
}

function NewFirmDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (firm: CaFirm) => void | Promise<void>;
}) {
  const { user } = useAuth();
  const [firmName, setFirmName] = useState("");
  const [firmType, setFirmType] = useState<string>("");
  const [firmSize, setFirmSize] = useState<string>("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [status, setStatus] = useState<string>("potential");

  const reset = () => {
    setFirmName("");
    setFirmType("");
    setFirmSize("");
    setPhone("");
    setEmail("");
    setCity("");
    setState("");
    setStatus("potential");
  };

  const create = useMutation({
    mutationFn: () =>
      createFirm({
        firm_name: firmName.trim(),
        firm_type: firmType || null,
        firm_size: firmSize || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        partner_status: status,
        assigned_to: user?.id ?? null,
        owner: user?.id ?? null,
        created_by: user!.id,
      }),
    onSuccess: async (firm) => {
      toast.success("CA firm created");
      reset();
      onOpenChange(false);
      await onCreated(firm);
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e, "Could not create firm")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New CA Firm</DialogTitle>
          <DialogDescription>Add a partner account.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="firm-name">Firm name</Label>
            <Input
              id="firm-name"
              value={firmName}
              onChange={(e) => setFirmName(e.target.value)}
              placeholder="e.g. Sharma & Associates"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Firm type</Label>
              <Select value={firmType} onValueChange={setFirmType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {FIRM_TYPES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Firm size</Label>
              <Select value={firmSize} onValueChange={setFirmSize}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {FIRM_SIZES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="firm-phone">Phone</Label>
              <Input id="firm-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="firm-email">Email</Label>
              <Input id="firm-email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="firm-city">City</Label>
              <Input id="firm-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="firm-state">State</Label>
              <Input id="firm-state" value={state} onChange={(e) => setState(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Partner status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {PARTNER_HEALTH.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!firmName.trim() || !user || create.isPending}
          >
            {create.isPending ? "Creating…" : "Create firm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
