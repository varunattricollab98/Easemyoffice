import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import { Users, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { useAuth } from "@/lib/auth";
import { guardRoles } from "@/lib/route-guard";
import { getErrorMessage } from "@/lib/utils";
import { logAudit } from "@/lib/audit";
import { B2B_LEAD_STATUSES, B2B_SOURCES, labelFor } from "@/lib/b2b";
import {
  createB2BLead,
  listAssignableUsers,
  listB2BLeads,
  type B2BLeadFilters,
} from "@/lib/b2b-queries";

const PRIORITIES = [
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
] as const;

export const Route = createFileRoute("/_authenticated/b2b/leads/")({
  head: () => ({ meta: [{ title: "B2B Leads — EaseMyOffice CRM" }] }),
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "b2b"]);
  },
  component: B2BLeadsListPage,
});

function statusBadge(status: string) {
  const s = B2B_LEAD_STATUSES.find((x) => x.id === status);
  if (!s) return <Badge variant="outline">{status}</Badge>;
  return <Badge className={`${s.color} text-white hover:${s.color}`}>{s.label}</Badge>;
}

function B2BLeadsListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [owner, setOwner] = useState("all");
  const [source, setSource] = useState("all");
  const [priority, setPriority] = useState("all");
  const [sort, setSort] = useState("newest");
  const [open, setOpen] = useState(false);

  const filters: B2BLeadFilters = useMemo(
    () => ({
      search: q.trim() || undefined,
      status: status === "all" ? undefined : status,
      assignedTo: owner === "all" ? undefined : owner,
      source: source === "all" ? undefined : source,
      priority: priority === "all" ? undefined : priority,
      sortByFollowUp: sort === "follow_up",
    }),
    [q, status, owner, source, priority, sort],
  );

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["b2b-leads", filters],
    queryFn: () => listB2BLeads(filters),
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

  const goToLead = (firmId: string | null) => {
    if (firmId) navigate({ to: "/b2b/firms/$id", params: { id: firmId } });
  };

  return (
    <div className="p-5 md:p-10 space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">B2B Leads</h1>
            <p className="text-sm text-muted-foreground">
              Prospecting pipeline.
              {leads.length > 0 && (
                <>
                  {" "}
                  · <span className="font-medium text-foreground">{leads.length}</span> shown
                </>
              )}
            </p>
          </div>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> New B2B Lead
        </Button>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4 flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-56">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search contact person…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[190px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {B2B_LEAD_STATUSES.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="Assigned to" />
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
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {B2B_SOURCES.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any priority</SelectItem>
              {PRIORITIES.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="follow_up">Next follow-up</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Desktop table */}
      <Card className="shadow-sm hidden md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact Person</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>City / State</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Next Follow-up</TableHead>
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
              {!isLoading && leads.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    No B2B leads yet.
                  </TableCell>
                </TableRow>
              )}
              {leads.map((l) => (
                <TableRow
                  key={l.id}
                  className={l.firm_id ? "cursor-pointer" : undefined}
                  onClick={() => goToLead(l.firm_id)}
                >
                  <TableCell className="font-medium">
                    {l.contact_person || l.b2b_lead_code || "—"}
                    {l.designation && (
                      <div className="text-xs text-muted-foreground">{l.designation}</div>
                    )}
                  </TableCell>
                  <TableCell>{statusBadge(l.lead_status)}</TableCell>
                  <TableCell>{[l.city, l.state].filter(Boolean).join(", ") || "—"}</TableCell>
                  <TableCell>{labelFor(B2B_SOURCES, l.lead_source)}</TableCell>
                  <TableCell>{l.assigned_to ? nameById.get(l.assigned_to) || "—" : "—"}</TableCell>
                  <TableCell className="capitalize">{l.priority || "—"}</TableCell>
                  <TableCell>
                    {l.next_follow_up_at
                      ? format(new Date(l.next_follow_up_at), "dd MMM yyyy")
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {!isLoading && leads.length === 0 && (
          <Card className="shadow-sm">
            <CardContent className="p-6 text-center text-muted-foreground">
              No B2B leads yet.
            </CardContent>
          </Card>
        )}
        {leads.map((l) => (
          <Card
            key={l.id}
            className="shadow-sm active:scale-[0.99] transition-transform"
            onClick={() => goToLead(l.firm_id)}
          >
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">{l.contact_person || l.b2b_lead_code || "—"}</div>
                {statusBadge(l.lead_status)}
              </div>
              <div className="text-sm text-muted-foreground">
                {[l.city, l.state].filter(Boolean).join(", ") || "No location"}
              </div>
              <div className="text-xs text-muted-foreground">
                {l.next_follow_up_at
                  ? `Follow-up ${formatDistanceToNow(new Date(l.next_follow_up_at), {
                      addSuffix: true,
                    })}`
                  : "No follow-up set"}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <NewB2BLeadDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={async (leadId) => {
          logAudit({
            actorId: user?.id,
            action: "create",
            entity: "b2b_lead",
            entityId: leadId,
          });
          await qc.invalidateQueries({ queryKey: ["b2b-leads"] });
        }}
      />
    </div>
  );
}

function NewB2BLeadDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (leadId: string) => void | Promise<void>;
}) {
  const { user } = useAuth();
  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [source, setSource] = useState("");
  const [priority, setPriority] = useState("medium");
  const [remark, setRemark] = useState("");

  const reset = () => {
    setContactPerson("");
    setPhone("");
    setEmail("");
    setCity("");
    setState("");
    setSource("");
    setPriority("medium");
    setRemark("");
  };

  const create = useMutation({
    mutationFn: () =>
      createB2BLead({
        contact_person: contactPerson.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        lead_source: source || null,
        priority,
        latest_remark: remark.trim() || null,
        assigned_to: user?.id ?? null,
        created_by: user!.id,
      }),
    onSuccess: async (lead) => {
      toast.success("B2B lead created");
      reset();
      onOpenChange(false);
      await onCreated(lead.id);
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e, "Could not create lead")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New B2B Lead</DialogTitle>
          <DialogDescription>A prospecting lead for the partnership pipeline.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="lead-contact">Contact person</Label>
            <Input
              id="lead-contact"
              value={contactPerson}
              onChange={(e) => setContactPerson(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="lead-phone">Phone</Label>
              <Input id="lead-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-email">Email</Label>
              <Input id="lead-email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="lead-city">City</Label>
              <Input id="lead-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-state">State</Label>
              <Input id="lead-state" value={state} onChange={(e) => setState(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Source</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {B2B_SOURCES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lead-remark">Remark</Label>
            <Textarea
              id="lead-remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!contactPerson.trim() || !user || create.isPending}
          >
            {create.isPending ? "Creating…" : "Create lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
