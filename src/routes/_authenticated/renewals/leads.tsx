import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, Phone, Mail, CalendarClock, Plus, Upload, Download, Trash2, UserCircle2 } from "lucide-react";
import { useState, useMemo, useRef } from "react";
import { format, differenceInDays } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/renewals/leads")({
  head: () => ({ meta: [{ title: "Renewal Leads — EaseMyOffice CRM" }] }),
  component: RenewalLeadsPage,
});


const STATUS_OPTIONS = [
  { id: "all", label: "All statuses" },
  { id: "pending", label: "New Renewal" },
  { id: "contacted", label: "Contacted" },
  { id: "following_up", label: "Following Up" },
  { id: "not_responding", label: "Not Responding" },
  { id: "pending_payment", label: "Pending Payment" },
  { id: "renewed", label: "Renewed" },
  { id: "not_interested", label: "Not Interested" },
  { id: "address_changed", label: "Address Changed" },
  { id: "lost", label: "Lost" },
];

const EXPIRY_FILTERS = [
  { id: "all", label: "All expiry" },
  { id: "overdue", label: "Already expired" },
  { id: "7d", label: "Next 7 days" },
  { id: "30d", label: "Next 30 days" },
  { id: "90d", label: "Next 90 days" },
];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  contacted: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  following_up: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300",
  not_responding: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  pending_payment: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300",
  renewed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  not_interested: "bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300",
  address_changed: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  lost: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};


function RenewalLeadsPage() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expiryFilter, setExpiryFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ["renewal-leads-all"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase.from("bookings")
        .select("id, booking_code, external_booking_id, client_name, business_name, contact_no, email_id, plan_name, plan_start_date, plan_expiry_date, renewal_status, renewal_assigned_to, renewal_followup_at, renewal_notes, total_amount, created_at")
        .not("plan_expiry_date", "is", null)
        .order("plan_expiry_date", { ascending: true })
        .limit(2000);
      return (data ?? []) as any[];
    },
  });

  const { data: team = [] } = useQuery({
    queryKey: ["renewal-team"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").order("full_name");
      return (data ?? []) as any[];
    },
  });

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    team.forEach((u: any) => m.set(u.id, u.full_name || u.email || ""));
    return m;
  }, [team]);


  const filtered = useMemo(() => {
    const now = new Date();
    return bookings.filter((b: any) => {
      if (statusFilter !== "all" && b.renewal_status !== statusFilter) return false;
      if (expiryFilter !== "all") {
        const exp = new Date(b.plan_expiry_date);
        const days = differenceInDays(exp, now);
        if (expiryFilter === "overdue" && days >= 0) return false;
        if (expiryFilter === "7d" && (days < 0 || days > 7)) return false;
        if (expiryFilter === "30d" && (days < 0 || days > 30)) return false;
        if (expiryFilter === "90d" && (days < 0 || days > 90)) return false;
      }
      if (search.trim()) {
        const s = search.toLowerCase();
        if (![b.client_name, b.business_name, b.contact_no, b.email_id, b.plan_name, b.booking_code, b.external_booking_id]
          .some((v: string) => (v ?? "").toLowerCase().includes(s))) return false;
      }
      return true;
    });
  }, [bookings, statusFilter, expiryFilter, search]);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("bookings").update({
        renewal_status: status, renewal_stage_changed_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["renewal-leads-all"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignTo = useMutation({
    mutationFn: async ({ id, userId }: { id: string; userId: string }) => {
      const { error } = await supabase.from("bookings").update({ renewal_assigned_to: userId }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Assigned"); qc.invalidateQueries({ queryKey: ["renewal-leads-all"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteLead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("bookings").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["renewal-leads-all"] }); },
    onError: (e: Error) => toast.error(e.message),
  });


  const exportCsv = () => {
    if (filtered.length === 0) { toast.error("No data to export"); return; }
    const headers = ["Booking ID", "Client", "Business", "Phone", "Email", "Plan", "Start Date", "Expiry Date", "Status", "Assigned To", "Amount"];
    const rows = filtered.map((b: any) => [
      b.external_booking_id || b.booking_code, b.client_name, b.business_name ?? "", b.contact_no ?? "",
      b.email_id ?? "", b.plan_name ?? "", b.plan_start_date ?? "", b.plan_expiry_date ?? "",
      b.renewal_status, nameById.get(b.renewal_assigned_to) ?? "", b.total_amount ?? "",
    ]);
    const esc = (s: string) => /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    const csv = [headers.join(","), ...rows.map((r) => r.map((v: any) => esc(String(v ?? ""))).join(","))].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `renewal-leads-${format(new Date(), "yyyy-MM-dd")}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} records`);
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Renewal Leads</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} leads · bookings with expiry dates</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4 mr-1" /> Export</Button>
          <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}><Upload className="h-4 w-4 mr-1" /> Bulk Upload</Button>
          <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-1" /> New Renewal Lead</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-3 flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-56">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search client, plan, phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUS_OPTIONS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={expiryFilter} onValueChange={setExpiryFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>{EXPIRY_FILTERS.map((f) => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}</SelectContent>
          </Select>
        </CardContent>
      </Card>


      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-muted-foreground">No renewal leads yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Click "+ New Renewal Lead" or "Bulk Upload" to add expiring bookings.</p>
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((b: any) => {
                const exp = new Date(b.plan_expiry_date);
                const daysLeft = differenceInDays(exp, new Date());
                const expired = daysLeft < 0;
                const assignee = b.renewal_assigned_to ? nameById.get(b.renewal_assigned_to) : null;
                return (
                  <div key={b.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{b.client_name}</span>
                        <Badge className={STATUS_COLORS[b.renewal_status] ?? ""} variant="secondary">
                          {STATUS_OPTIONS.find((s) => s.id === b.renewal_status)?.label ?? b.renewal_status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
                        <span>{b.plan_name}</span>
                        {b.contact_no && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{b.contact_no}</span>}
                        {b.email_id && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{b.email_id}</span>}
                        {assignee && <span className="inline-flex items-center gap-1"><UserCircle2 className="h-3 w-3" />{assignee}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right mr-2">
                        <div className={`text-xs font-medium ${expired ? "text-destructive" : daysLeft <= 7 ? "text-amber-600" : "text-muted-foreground"}`}>
                          <CalendarClock className="h-3 w-3 inline mr-1" />
                          {expired ? `Expired ${Math.abs(daysLeft)}d ago` : `${daysLeft}d left`}
                        </div>
                        <div className="text-[10px] text-muted-foreground">{format(exp, "MMM d, yyyy")}</div>
                      </div>
                      <Select value={b.renewal_status} onValueChange={(v) => updateStatus.mutate({ id: b.id, status: v })}>
                        <SelectTrigger className="h-7 w-32 text-[11px]"><SelectValue /></SelectTrigger>
                        <SelectContent>{STATUS_OPTIONS.filter((s) => s.id !== "all").map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
                      </Select>
                      {isAdmin && (
                        <Select value={b.renewal_assigned_to ?? ""} onValueChange={(v) => assignTo.mutate({ id: b.id, userId: v })}>
                          <SelectTrigger className="h-7 w-32 text-[11px]"><SelectValue placeholder="Assign…" /></SelectTrigger>
                          <SelectContent>{team.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.full_name || t.email}</SelectItem>)}</SelectContent>
                        </Select>
                      )}
                      {isAdmin && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => { if (window.confirm(`Delete renewal lead "${b.client_name}"?`)) deleteLead.mutate(b.id); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AddRenewalLeadDialog open={addOpen} onClose={() => setAddOpen(false)} userId={user?.id ?? null} team={team} />
      <BulkUploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} userId={user?.id ?? null} />
    </div>
  );
}


function AddRenewalLeadDialog({ open, onClose, userId, team }: { open: boolean; onClose: () => void; userId: string | null; team: any[] }) {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [f, setF] = useState({
    client_name: "", business_name: "", contact_no: "", email_id: "",
    plan_name: "", plan_start_date: "", plan_expiry_date: "",
    total_amount: "", remarks: "", assigned_to: userId ?? "",
  });

  const reset = () => setF({ client_name: "", business_name: "", contact_no: "", email_id: "", plan_name: "", plan_start_date: "", plan_expiry_date: "", total_amount: "", remarks: "", assigned_to: userId ?? "" });

  const create = useMutation({
    mutationFn: async () => {
      if (!f.client_name.trim()) throw new Error("Client name is required");
      if (!f.plan_expiry_date) throw new Error("Expiry date is required");
      const { error } = await supabase.from("bookings").insert({
        client_name: f.client_name.trim(),
        business_name: f.business_name.trim() || null,
        contact_no: f.contact_no.trim(),
        email_id: f.email_id.trim() || null,
        plan_name: f.plan_name.trim(),
        plan_start_date: f.plan_start_date || null,
        plan_expiry_date: f.plan_expiry_date,
        total_amount: parseFloat(f.total_amount) || 0,
        remarks: f.remarks.trim() || null,
        renewal_assigned_to: f.assigned_to || userId,
        renewal_status: "pending",
        booking_date: f.plan_start_date || new Date().toISOString().slice(0, 10),
        sales_agent_name: "Renewal Import",
        booking_source: "Renewal",
        assigned_to: userId,
        created_by: userId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Renewal lead added");
      reset(); onClose();
      qc.invalidateQueries({ queryKey: ["renewal-leads-all"] });
      qc.invalidateQueries({ queryKey: ["renewal-bookings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add Renewal Lead</DialogTitle></DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2"><Label className="text-xs">Client Name *</Label><Input value={f.client_name} onChange={(e) => setF({ ...f, client_name: e.target.value })} /></div>
          <div><Label className="text-xs">Business Name</Label><Input value={f.business_name} onChange={(e) => setF({ ...f, business_name: e.target.value })} /></div>
          <div><Label className="text-xs">Contact No.</Label><Input value={f.contact_no} onChange={(e) => setF({ ...f, contact_no: e.target.value })} inputMode="tel" /></div>
          <div><Label className="text-xs">Email</Label><Input value={f.email_id} onChange={(e) => setF({ ...f, email_id: e.target.value })} type="email" /></div>
          <div><Label className="text-xs">Plan Name</Label><Input value={f.plan_name} onChange={(e) => setF({ ...f, plan_name: e.target.value })} /></div>
          <div><Label className="text-xs">Plan Start Date</Label><Input type="date" value={f.plan_start_date} onChange={(e) => setF({ ...f, plan_start_date: e.target.value })} /></div>
          <div><Label className="text-xs">Plan Expiry Date *</Label><Input type="date" value={f.plan_expiry_date} onChange={(e) => setF({ ...f, plan_expiry_date: e.target.value })} /></div>
          <div><Label className="text-xs">Total Amount (₹)</Label><Input type="number" value={f.total_amount} onChange={(e) => setF({ ...f, total_amount: e.target.value })} /></div>
          {isAdmin && (
            <div><Label className="text-xs">Assign To</Label>
              <Select value={f.assigned_to} onValueChange={(v) => setF({ ...f, assigned_to: v })}>
                <SelectTrigger><SelectValue placeholder="Assign…" /></SelectTrigger>
                <SelectContent>{team.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.full_name || t.email}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="md:col-span-2"><Label className="text-xs">Remarks</Label><Textarea rows={2} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!f.client_name.trim() || !f.plan_expiry_date || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "Saving…" : "Add Lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function BulkUploadDialog({ open, onClose, userId }: { open: boolean; onClose: () => void; userId: string | null }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) { toast.error("CSV must have a header row + at least 1 data row"); return; }
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"));
      const parsed = lines.slice(1).map((line) => {
        const vals = line.split(",").map((v) => v.replace(/^"|"$/g, "").trim());
        const obj: any = {};
        headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
        return obj;
      }).filter((r) => r.client_name || r.name || r.client);
      setRows(parsed);
      if (parsed.length === 0) toast.error("No valid rows found");
      else toast.success(`${parsed.length} rows parsed — review and click Upload`);
    };
    reader.readAsText(file);
  };

  const upload = async () => {
    if (rows.length === 0) return;
    setUploading(true);
    try {
      const inserts = rows.map((r) => ({
        client_name: r.client_name || r.name || r.client || "Unknown",
        business_name: r.business_name || r.business || r.company || null,
        contact_no: r.contact_no || r.phone || r.mobile || r.contact || "",
        email_id: r.email_id || r.email || null,
        plan_name: r.plan_name || r.plan || "",
        plan_start_date: r.plan_start_date || r.start_date || r.start || null,
        plan_expiry_date: r.plan_expiry_date || r.expiry_date || r.expiry || r.end_date || null,
        total_amount: parseFloat(r.total_amount || r.amount || "0") || 0,
        remarks: r.remarks || r.notes || null,
        renewal_status: "pending",
        booking_date: r.plan_start_date || r.start_date || new Date().toISOString().slice(0, 10),
        sales_agent_name: "Bulk Import",
        booking_source: "Renewal",
        assigned_to: userId,
        created_by: userId,
        renewal_assigned_to: userId,
      }));
      // Filter out rows without an expiry date (they won't show in renewal leads)
      const valid = inserts.filter((r) => r.plan_expiry_date);
      if (valid.length === 0) { toast.error("No rows have an expiry date — expiry_date column is required"); setUploading(false); return; }
      const { error } = await supabase.from("bookings").insert(valid as never);
      if (error) throw new Error(error.message);
      toast.success(`${valid.length} renewal leads uploaded`);
      setRows([]); onClose();
      qc.invalidateQueries({ queryKey: ["renewal-leads-all"] });
      qc.invalidateQueries({ queryKey: ["renewal-bookings"] });
    } catch (e: any) { toast.error(e.message); }
    setUploading(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setRows([]); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Bulk Upload Renewal Leads</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Upload a CSV file with columns: <code className="text-xs bg-muted px-1 rounded">client_name, contact_no, email, plan_name, plan_start_date, plan_expiry_date, total_amount, remarks</code>
          </p>
          <p className="text-xs text-muted-foreground">
            The <strong>plan_expiry_date</strong> column is required (format: YYYY-MM-DD). Rows without it will be skipped.
          </p>
          <Input ref={fileRef} type="file" accept=".csv" onChange={handleFile} />
          {rows.length > 0 && (
            <div className="rounded border p-3 bg-muted/20">
              <p className="text-sm font-medium">{rows.length} rows ready to upload</p>
              <p className="text-xs text-muted-foreground mt-1">
                Sample: {rows[0].client_name || rows[0].name || "—"} · {rows[0].plan_expiry_date || rows[0].expiry_date || "no expiry"} · {rows[0].plan_name || rows[0].plan || "—"}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { onClose(); setRows([]); }}>Cancel</Button>
          <Button disabled={rows.length === 0 || uploading} onClick={upload}>
            {uploading ? "Uploading…" : `Upload ${rows.length} Leads`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
