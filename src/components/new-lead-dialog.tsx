import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SERVICES, SOURCES, INTERESTS } from "@/lib/crm";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

interface Props { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (id: string) => void; }

export function NewLeadDialog({ open, onOpenChange, onCreated }: Props) {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [dupe, setDupe] = useState<any | null>(null);
  const [checking, setChecking] = useState(false);
  const [form, setForm] = useState({
    client_name: "",
    mobile: "",
    alt_mobile: "",
    email: "",
    company_name: "",
    city: "",
    state: "",
    service_required: "virtual_office",
    source: "website",
    interest: "warm",
    budget: "",
    notes: "",
    assigned_to: user?.id ?? "",
  });

  const { data: salespeople } = useQuery({
    queryKey: ["salespeople"],
    enabled: open && isAdmin,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles").select("user_id, profiles:user_id(id, full_name, email)")
        .in("role", ["sales", "admin", "bd"]);
      return (data ?? []) as any[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      const payload = {
        client_name: form.client_name.trim(),
        mobile: form.mobile.trim(),
        alt_mobile: form.alt_mobile.trim() || null,
        email: form.email.trim() || null,
        company_name: form.company_name.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        service_required: form.service_required as any,
        source: form.source as any,
        interest: form.interest as any,
        budget: form.budget ? Number(form.budget) : null,
        notes: form.notes.trim() || null,
        assigned_to: form.assigned_to || user.id,
        created_by: user.id,
      };
      const { data, error } = await supabase.from("leads").insert(payload).select("id").single();
      if (error) throw error;
      await supabase.from("lead_activities").insert({
        lead_id: data.id, actor_id: user.id, type: "created",
        title: "Lead created", body: `via ${form.source}`,
      });
      return data.id as string;
    },
    onSuccess: (id) => {
      toast.success("Lead created");
      qc.invalidateQueries();
      setDupe(null);
      onOpenChange(false);
      onCreated?.(id);
    },
    onError: (e: any) => toast.error(e.message ?? "Could not create lead"),
  });

  // Before creating, look for an existing lead with the same mobile or email.
  // (Only leads the current user can see are checked, per row-level security —
  // admins see all; a salesperson sees their own.)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const mobile = form.mobile.trim();
    const email = form.email.trim();
    setChecking(true);
    try {
      // Company-wide duplicate check via a SECURITY DEFINER function, so it
      // catches a match owned by ANY teammate (not just the current user's).
      // If the function isn't installed yet, we fail open and just create.
      const { data, error } = await supabase.rpc("find_duplicate_lead", {
        p_mobile: mobile || null,
        p_email: email || null,
      } as never);
      if (!error && Array.isArray(data) && data.length > 0) {
        setDupe(data[0]);
        return;
      }
      create.mutate();
    } finally {
      setChecking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Lead</DialogTitle>
          <DialogDescription>Quick capture — minimum required: name, mobile.</DialogDescription>
        </DialogHeader>
        {dupe && (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4" /> Possible duplicate lead
            </div>
            <div className="text-sm text-muted-foreground">
              A lead with the same mobile/email already exists:{" "}
              <span className="font-medium text-foreground">{dupe.client_name}</span> ({dupe.lead_code})
              {dupe.owner_name ? <> — owned by <span className="font-medium text-foreground">{dupe.owner_name}</span></> : null}.
            </div>
            <div className="flex flex-wrap gap-2">
              {(dupe.mine || isAdmin) && (
                <Button type="button" size="sm" variant="outline"
                  onClick={() => { setDupe(null); onOpenChange(false); navigate({ to: "/leads/$id", params: { id: dupe.id } }); }}>
                  Open existing
                </Button>
              )}
              <Button type="button" size="sm" variant="outline" className="text-amber-700 dark:text-amber-300"
                onClick={() => { setDupe(null); create.mutate(); }}>
                Create anyway
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setDupe(null)}>Dismiss</Button>
            </div>
          </div>
        )}
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <Field label="Client name *">
            <Input required value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} />
          </Field>
          <Field label="Company">
            <Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
          </Field>
          <Field label="Mobile *">
            <Input required value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          </Field>
          <Field label="Alt. mobile">
            <Input value={form.alt_mobile} onChange={(e) => setForm({ ...form, alt_mobile: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Budget (₹)">
            <Input type="number" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
          </Field>
          <Field label="City">
            <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </Field>
          <Field label="State">
            <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
          </Field>
          <Field label="Service required">
            <Select value={form.service_required} onValueChange={(v) => setForm({ ...form, service_required: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SERVICES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Source">
            <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SOURCES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Interest">
            <Select value={form.interest} onValueChange={(v) => setForm({ ...form, interest: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INTERESTS.filter((i) => i.id !== "dead").map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.emoji} {s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {isAdmin && (
            <Field label="Assign to">
              <Select value={form.assigned_to} onValueChange={(v) => setForm({ ...form, assigned_to: v })}>
                <SelectTrigger><SelectValue placeholder="Self" /></SelectTrigger>
                <SelectContent>
                  {(salespeople ?? []).map((row) => (
                    <SelectItem key={row.user_id} value={row.user_id}>
                      {row.profiles?.full_name ?? row.profiles?.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <div className="md:col-span-2">
            <Label>Notes</Label>
            <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <DialogFooter className="md:col-span-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || checking}>
              {checking ? "Checking…" : create.isPending ? "Creating…" : "Create lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
