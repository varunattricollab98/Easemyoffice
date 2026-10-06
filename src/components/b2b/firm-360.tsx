import { useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  ArrowLeft,
  Building2,
  Phone,
  Mail,
  MessageCircle,
  CalendarCheck,
  Star,
  Plus,
  FileText,
  Handshake,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/utils";
import { logAudit } from "@/lib/audit";
import {
  ACTIVITY_TYPES,
  PARTNER_HEALTH,
  REFERRAL_STATUSES,
  labelFor,
  type B2BActivity,
  type B2BContact,
} from "@/lib/b2b";
import {
  createActivity,
  createContact,
  getFirm360,
  setPrimaryContact,
  updateContact,
  type Firm360,
} from "@/lib/b2b-queries";

function money(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

const ACTIVITY_ICON: Record<string, typeof Phone> = {
  call: Phone,
  whatsapp: MessageCircle,
  email: Mail,
  meeting: CalendarCheck,
  task: FileText,
  followup: CalendarCheck,
  note: FileText,
};

export function Firm360Page({ id }: { id: string }) {
  const navigate = useNavigate();
  const router = useRouter();
  const qc = useQueryClient();
  const [logOpen, setLogOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [editContact, setEditContact] = useState<B2BContact | null>(null);

  const goBack = () => {
    if (window.history.length > 1) router.history.back();
    else navigate({ to: "/b2b/firms" });
  };

  const { data, isLoading } = useQuery<Firm360>({
    queryKey: ["b2b-firm-360", id],
    queryFn: () => getFirm360(id),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["b2b-firm-360", id] });

  if (isLoading) {
    return <div className="p-10 text-center text-muted-foreground">Loading…</div>;
  }
  if (!data?.firm) {
    return (
      <div className="p-10 text-center space-y-3">
        <p className="text-muted-foreground">Firm not found or not accessible.</p>
        <Button variant="outline" onClick={goBack}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
      </div>
    );
  }

  const { firm, contacts, activities, partnerships, referrals, totals } = data;
  const health = PARTNER_HEALTH.find((p) => p.id === firm.partner_status);
  const lastActivity = activities[0];

  return (
    <div className="p-5 md:p-10 space-y-5 max-w-6xl mx-auto">
      <Button variant="ghost" size="sm" onClick={goBack} className="-ml-2">
        <ArrowLeft className="h-4 w-4 mr-2" /> Back
      </Button>

      {/* Firm information header */}
      <Card className="shadow-sm">
        <CardContent className="p-5 md:p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="grid size-12 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
                <Building2 className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h1 className="text-2xl font-bold leading-tight">{firm.firm_name}</h1>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  {health ? (
                    <Badge className={`${health.color} text-white hover:${health.color}`}>
                      {health.label}
                    </Badge>
                  ) : (
                    <Badge variant="outline">{firm.partner_status ?? "—"}</Badge>
                  )}
                  {[firm.city, firm.state].filter(Boolean).length > 0 && (
                    <span>{[firm.city, firm.state].filter(Boolean).join(", ")}</span>
                  )}
                  {firm.partner_since && (
                    <span>Partner since {format(new Date(firm.partner_since), "MMM yyyy")}</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setLogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" /> Log activity
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            {firm.phone && (
              <div>
                <div className="text-muted-foreground text-xs">Phone</div>
                <div className="font-medium">{firm.phone}</div>
              </div>
            )}
            {firm.email && (
              <div>
                <div className="text-muted-foreground text-xs">Email</div>
                <div className="font-medium truncate">{firm.email}</div>
              </div>
            )}
            {firm.website && (
              <div>
                <div className="text-muted-foreground text-xs">Website</div>
                <div className="font-medium truncate">{firm.website}</div>
              </div>
            )}
            <div>
              <div className="text-muted-foreground text-xs">Partner score</div>
              <div className="font-medium">
                {firm.partner_score != null ? Math.round(Number(firm.partner_score)) : "—"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Performance strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Total Referrals" value={String(totals.referrals)} />
        <StatTile label="Converted" value={String(totals.convertedReferrals)} />
        <StatTile label="Partnerships" value={String(totals.partnerships)} />
        <StatTile label="Total Revenue" value={money(totals.revenue)} />
        <StatTile label="Contacts" value={String(totals.contacts)} />
        <StatTile label="Activities" value={String(totals.activities)} />
        <StatTile
          label="Last Contact"
          value={
            lastActivity
              ? formatDistanceToNow(new Date(lastActivity.happened_at), { addSuffix: true })
              : "—"
          }
        />
        <StatTile
          label="Last Updated"
          value={formatDistanceToNow(new Date(firm.updated_at), { addSuffix: true })}
        />
      </div>

      <Tabs defaultValue="timeline">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="contacts">Contacts ({totals.contacts})</TabsTrigger>
          <TabsTrigger value="partnerships">Partnerships ({totals.partnerships})</TabsTrigger>
          <TabsTrigger value="referrals">Referrals ({totals.referrals})</TabsTrigger>
          <TabsTrigger value="notes">Documents & Notes</TabsTrigger>
        </TabsList>

        {/* Activity timeline */}
        <TabsContent value="timeline" className="mt-4">
          <Card className="shadow-sm">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">Activity Timeline</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setLogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" /> Log activity
              </Button>
            </CardHeader>
            <CardContent>
              {activities.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No activity logged yet.
                </p>
              ) : (
                <ol className="relative border-l pl-6 space-y-5">
                  {activities.map((a) => (
                    <ActivityRow key={a.id} activity={a} />
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Contacts */}
        <TabsContent value="contacts" className="mt-4">
          <Card className="shadow-sm">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">Contacts</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditContact(null);
                  setContactOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" /> Add contact
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No contacts yet.</p>
              ) : (
                contacts.map((c) => (
                  <ContactCard
                    key={c.id}
                    contact={c}
                    firmId={id}
                    onEdit={() => {
                      setEditContact(c);
                      setContactOpen(true);
                    }}
                    onChanged={invalidate}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Partnerships */}
        <TabsContent value="partnerships" className="mt-4">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Partnerships / Opportunities</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {partnerships.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No partnerships yet.
                </p>
              ) : (
                partnerships.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-lg border p-3 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Handshake className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{p.stage ?? "—"}</span>
                      <Badge variant="outline">{p.status}</Badge>
                    </div>
                    <div className="text-muted-foreground">
                      {p.value != null ? money(Number(p.value)) : "—"}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Referrals */}
        <TabsContent value="referrals" className="mt-4">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Referrals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {referrals.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No referrals yet.</p>
              ) : (
                referrals.map((r) => {
                  const st = REFERRAL_STATUSES.find((s) => s.id === r.referral_status);
                  return (
                    <div
                      key={r.id}
                      className="flex items-center justify-between rounded-lg border p-3 text-sm"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Share2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate">
                          {r.referred_client_name ?? r.referral_code ?? "Referral"}
                        </span>
                        {st && (
                          <Badge className={`${st.color} text-white hover:${st.color}`}>
                            {st.label}
                          </Badge>
                        )}
                        {r.lead_id && <Badge variant="outline">Linked to lead</Badge>}
                      </div>
                      <div className="text-muted-foreground shrink-0">
                        {r.revenue != null ? money(Number(r.revenue)) : "—"}
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documents & notes */}
        <TabsContent value="notes" className="mt-4">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Documents & Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {activities.filter((a) => a.type === "note").length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No notes yet. Use “Log activity” and pick “Note”.
                </p>
              ) : (
                activities
                  .filter((a) => a.type === "note")
                  .map((a) => (
                    <div key={a.id} className="rounded-lg border p-3 text-sm">
                      <div className="font-medium">{a.subject ?? "Note"}</div>
                      {a.notes && (
                        <div className="text-muted-foreground whitespace-pre-wrap">{a.notes}</div>
                      )}
                      <div className="text-xs text-muted-foreground mt-1">
                        {format(new Date(a.happened_at), "dd MMM yyyy, p")}
                      </div>
                    </div>
                  ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <LogActivityDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        firmId={id}
        firmName={firm.firm_name}
        onLogged={invalidate}
      />
      <ContactDialog
        open={contactOpen}
        onOpenChange={setContactOpen}
        firmId={id}
        contact={editContact}
        onSaved={invalidate}
      />
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold mt-0.5">{value}</div>
      </CardContent>
    </Card>
  );
}

function ActivityRow({ activity }: { activity: B2BActivity }) {
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
          {formatDistanceToNow(new Date(activity.happened_at), { addSuffix: true })}
        </span>
      </div>
      {activity.subject && <div className="text-sm">{activity.subject}</div>}
      {activity.notes && (
        <div className="text-sm text-muted-foreground whitespace-pre-wrap">{activity.notes}</div>
      )}
    </li>
  );
}

function ContactCard({
  contact,
  firmId,
  onEdit,
  onChanged,
}: {
  contact: B2BContact;
  firmId: string;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const makePrimary = useMutation({
    mutationFn: () => setPrimaryContact(firmId, contact.id),
    onSuccess: () => {
      toast.success("Primary contact updated");
      onChanged();
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{contact.name}</span>
          {contact.is_primary && (
            <Badge className="bg-amber-500 text-white hover:bg-amber-500">Primary</Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {[contact.designation, contact.phone, contact.email].filter(Boolean).join(" · ") || "—"}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {!contact.is_primary && (
          <Button
            size="icon"
            variant="ghost"
            title="Mark primary"
            onClick={() => makePrimary.mutate()}
            disabled={makePrimary.isPending}
          >
            <Star className="h-4 w-4" />
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </div>
  );
}

function LogActivityDialog({
  open,
  onOpenChange,
  firmId,
  firmName,
  onLogged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  firmId: string;
  firmName: string;
  onLogged: () => void;
}) {
  const { user } = useAuth();
  const [type, setType] = useState<B2BActivity["type"]>("call");
  const [subject, setSubject] = useState("");
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState("");

  const reset = () => {
    setType("call");
    setSubject("");
    setNotes("");
    setOutcome("");
  };

  const log = useMutation({
    mutationFn: () =>
      createActivity({
        type,
        firm_id: firmId,
        subject: subject.trim() || null,
        notes: notes.trim() || null,
        outcome: outcome.trim() || null,
        created_by: user!.id,
      }),
    onSuccess: () => {
      toast.success("Activity logged");
      logAudit({
        actorId: user?.id,
        action: "create",
        entity: "ca_firm",
        entityId: firmId,
        entityLabel: firmName,
        detail: `Logged ${type}`,
      });
      reset();
      onOpenChange(false);
      onLogged();
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log activity</DialogTitle>
          <DialogDescription>Record a call, WhatsApp, email, meeting or note.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as B2BActivity["type"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTIVITY_TYPES.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="act-subject">Subject</Label>
            <Input
              id="act-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Short summary"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="act-outcome">Outcome</Label>
            <Input
              id="act-outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              placeholder="e.g. Connected, No answer"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="act-notes">Notes</Label>
            <Textarea
              id="act-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => log.mutate()} disabled={!user || log.isPending}>
            {log.isPending ? "Saving…" : "Log"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContactDialog({
  open,
  onOpenChange,
  firmId,
  contact,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  firmId: string;
  contact: B2BContact | null;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const isEdit = !!contact;
  const [name, setName] = useState("");
  const [designation, setDesignation] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  // Reset the form whenever the dialog opens for a (different) contact.
  const key = `${open}:${contact?.id ?? "new"}`;
  const [lastKey, setLastKey] = useState("");
  if (key !== lastKey) {
    setLastKey(key);
    setName(contact?.name ?? "");
    setDesignation(contact?.designation ?? "");
    setPhone(contact?.phone ?? "");
    setEmail(contact?.email ?? "");
  }

  const save = useMutation({
    mutationFn: async () => {
      if (isEdit && contact) {
        return updateContact(contact.id, {
          name: name.trim(),
          designation: designation.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
        });
      }
      return createContact({
        firm_id: firmId,
        name: name.trim(),
        designation: designation.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        created_by: user!.id,
      });
    },
    onSuccess: () => {
      toast.success(isEdit ? "Contact updated" : "Contact added");
      onOpenChange(false);
      onSaved();
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit contact" : "Add contact"}</DialogTitle>
          <DialogDescription>A person at this firm.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="c-name">Name</Label>
            <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-desig">Designation</Label>
            <Input
              id="c-desig"
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-phone">Phone</Label>
              <Input id="c-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-email">Email</Label>
              <Input id="c-email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={!name.trim() || !user || save.isPending}>
            {save.isPending ? "Saving…" : isEdit ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
