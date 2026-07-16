import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INTERESTS, SERVICES, SOURCES, STAGES, labelFor } from "@/lib/crm";
import { Plus, Search, Phone, Mail, Upload, Download, Trash2, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CalendarIcon } from "lucide-react";
import { NewLeadDialog } from "@/components/new-lead-dialog";
import { useAuth } from "@/lib/auth";
import { triggerStageReminder } from "@/lib/stage-reminders";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type LeadSearch = {
  stage?: string;
  interest?: string;
  service?: string;
  owner?: string;
  q?: string;
  page?: number;
  size?: number;
  dateRange?: string;
  sort?: string;
};

const PAGE_SIZES = [25, 50, 100, 200];

export const Route = createFileRoute("/_authenticated/leads/")({
  head: () => ({ meta: [{ title: "Leads — EaseMyOffice CRM" }] }),
  validateSearch: (s: Record<string, unknown>): LeadSearch => ({
    stage: typeof s.stage === "string" ? s.stage : undefined,
    interest: typeof s.interest === "string" ? s.interest : undefined,
    service: typeof s.service === "string" ? s.service : undefined,
    owner: typeof s.owner === "string" ? s.owner : undefined,
    q: typeof s.q === "string" ? s.q : undefined,
    page: (() => { const n = Number(s.page); return Number.isFinite(n) && n > 1 ? Math.floor(n) : undefined; })(),
    size: (() => { const n = Number(s.size); return PAGE_SIZES.includes(n) ? n : undefined; })(),
    dateRange: typeof s.dateRange === "string" ? s.dateRange : undefined,
    sort: typeof s.sort === "string" ? s.sort : undefined,
  }),
  component: LeadsListPage,
});

function LeadsListPage() {
  const [open, setOpen] = useState(false);
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { isAdmin, user } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState(search.q ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [bulkReasonStage, setBulkReasonStage] = useState<string | null>(null);
  const [bulkReason, setBulkReason] = useState("");
  const [showDupes, setShowDupes] = useState(false);
  const [customDate, setCustomDate] = useState("");
  const stage = search.stage ?? "all";
  const interest = search.interest ?? "all";
  const service = search.service ?? "all";
  const owner = search.owner;
  const dateRange = search.dateRange ?? "all";
  const sortDir = search.sort ?? "newest";
  const page = search.page ?? 1;
  const size = search.size ?? 50;

  // Any change to a filter/search resets back to page 1 so results stay in view.
  const setStage = (v: string) =>
    navigate({ to: "/leads", search: { ...search, stage: v === "all" ? undefined : v, page: undefined } });
  const setInterest = (v: string) =>
    navigate({ to: "/leads", search: { ...search, interest: v === "all" ? undefined : v, page: undefined } });
  const setService = (v: string) =>
    navigate({ to: "/leads", search: { ...search, service: v === "all" ? undefined : v, page: undefined } });
  const setDateRange = (v: string) =>
    navigate({ to: "/leads", search: { ...search, dateRange: v === "all" ? undefined : v, page: undefined } });
  const setSortDir = (v: string) =>
    navigate({ to: "/leads", search: { ...search, sort: v === "newest" ? undefined : v, page: undefined } });
  const setPage = (p: number) =>
    navigate({ to: "/leads", search: { ...search, page: p <= 1 ? undefined : p } });
  const setSize = (v: string) =>
    navigate({ to: "/leads", search: { ...search, size: Number(v) === 50 ? undefined : Number(v), page: undefined } });
  const onSearchChange = (v: string) => {
    setQ(v);
    if (page !== 1) navigate({ to: "/leads", search: { ...search, page: undefined } });
  };

  const applyFilters = (query: any) => {
    if (stage !== "all") query = query.eq("stage", stage as never);
    if (interest !== "all") query = query.eq("interest", interest as never);
    if (service !== "all") query = query.eq("service_required", service as never);
    if (owner) query = query.eq("assigned_to", owner);
    if (q.trim()) {
      const term = `%${q.trim()}%`;
      query = query.or(`client_name.ilike.${term},mobile.ilike.${term},company_name.ilike.${term},lead_code.ilike.${term},email.ilike.${term}`);
    }
    // Date range filter
    if (dateRange !== "all") {
      const now = new Date();
      let from: Date | null = null;
      let to: Date | null = null;
      if (dateRange === "today") {
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (dateRange === "this_week") {
        const day = now.getDay();
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
      } else if (dateRange === "this_month") {
        from = new Date(now.getFullYear(), now.getMonth(), 1);
      } else if (dateRange === "last_month") {
        from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      } else if (dateRange === "last_7d") {
        from = new Date(Date.now() - 7 * 86400000);
      } else if (dateRange === "last_30d") {
        from = new Date(Date.now() - 30 * 86400000);
      } else if (dateRange === "custom" && customDate) {
        from = new Date(`${customDate}T00:00:00`);
        to = new Date(`${customDate}T23:59:59.999`);
      }
      if (from) query = query.gte("created_at", from.toISOString());
      if (to) query = query.lte("created_at", to.toISOString());
    }
    return query;
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["leads", q, stage, interest, service, owner, dateRange, customDate, sortDir, page, size],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const from = (page - 1) * size;
      const to = from + size - 1;
      let query = supabase.from("leads")
        .select("id, lead_code, client_name, company_name, mobile, email, stage, interest, service_required, source, score, assigned_to, next_follow_up_at, last_activity_at, created_at", { count: "exact" })
        .order("created_at", { ascending: sortDir === "oldest" })
        .range(from, to);
      query = applyFilters(query);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });

  const { data: assignableUsers = [] } = useQuery({
    queryKey: ["assignable-users"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").order("full_name", { ascending: true });
      return data ?? [];
    },
  });

  // Duplicate detection: fetch all leads' phone/email/name and find IDs that share
  // the same contact info. Only runs when "Show duplicates" is active.
  // A lead is a duplicate only if AT LEAST 2 of 3 fields match another lead:
  //   - Name + Email, OR Name + Phone, OR Email + Phone
  type DupeGroup = { matchKey: string; matchType: string; leads: any[] };
  const { data: dupeData, isLoading: dupesLoading } = useQuery({
    queryKey: ["leads-duplicates"],
    enabled: showDupes,
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase.from("leads")
        .select("id, lead_code, client_name, mobile, email, created_at, assigned_to, stage")
        .order("created_at", { ascending: true })
        .limit(5000);
      if (!data) return { ids: new Set<string>(), groups: [] as DupeGroup[] };

      // Normalise fields for comparison
      const leads = (data as any[]).map((l) => ({
        ...l,
        _phone: (l.mobile ?? "").replace(/\D/g, "").slice(-10),
        _email: (l.email ?? "").trim().toLowerCase(),
        _name: (l.client_name ?? "").trim().toLowerCase(),
      }));

      // For each pair of leads, check if 2+ fields match.
      // Use composite keys to group: "name+phone", "name+email", "phone+email"
      const groupMap = new Map<string, any[]>();

      for (let i = 0; i < leads.length; i++) {
        for (let j = i + 1; j < leads.length; j++) {
          const a = leads[i], b = leads[j];
          const nameMatch = a._name && b._name && a._name.length > 2 && a._name === b._name;
          const phoneMatch = a._phone && b._phone && a._phone.length >= 10 && a._phone === b._phone;
          const emailMatch = a._email && b._email && a._email === b._email;

          const matchCount = (nameMatch ? 1 : 0) + (phoneMatch ? 1 : 0) + (emailMatch ? 1 : 0);
          if (matchCount < 2) continue;

          // Build a stable group key from the matching values
          const parts: string[] = [];
          if (nameMatch) parts.push(`name:${a._name}`);
          if (phoneMatch) parts.push(`phone:${a._phone}`);
          if (emailMatch) parts.push(`email:${a._email}`);
          const gKey = parts.sort().join("|");

          const group = groupMap.get(gKey) ?? [];
          if (!group.find((x: any) => x.id === a.id)) group.push(a);
          if (!group.find((x: any) => x.id === b.id)) group.push(b);
          groupMap.set(gKey, group);
        }
      }

      const ids = new Set<string>();
      const groups: DupeGroup[] = [];
      for (const [key, arr] of groupMap.entries()) {
        arr.forEach((l) => ids.add(l.id));
        // Describe the match type for display
        const types = key.split("|").map((p) => {
          const [type, val] = p.split(":");
          return `${type[0].toUpperCase() + type.slice(1)}: ${val}`;
        }).join(" + ");
        groups.push({ matchKey: key, matchType: types, leads: arr.sort((a: any, b: any) => a.created_at < b.created_at ? -1 : 1) });
      }
      return { ids, groups };
    },
  });
  const dupeIds = dupeData?.ids ?? new Set<string>();
  const dupeGroups = dupeData?.groups ?? [];

  const deleteLead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("leads").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Duplicate deleted");
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["leads-duplicates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => {
    const allRows = data?.rows ?? [];
    if (!showDupes) return allRows;
    return allRows.filter((r: any) => dupeIds.has(r.id));
  }, [data?.rows, showDupes, dupeIds]);
  const total = showDupes ? rows.length : (data?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const firstShown = total === 0 ? 0 : (page - 1) * size + 1;
  const lastShown = Math.min(page * size, total);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    (assignableUsers as any[]).forEach((u) => m.set(u.id, u.full_name || u.email || ""));
    return m;
  }, [assignableUsers]);

  // ---- selection helpers ----
  const selectedIds = [...selected];
  const toggleOne = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAllOnPage = () =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (allOnPageSelected) rows.forEach((r) => n.delete(r.id));
      else rows.forEach((r) => n.add(r.id));
      return n;
    });
  const clearSel = () => setSelected(new Set());

  // ---- bulk actions ----
  const bulkAssign = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.from("leads")
        .update({ assigned_to: userId === "unassigned" ? null : userId })
        .in("id", selectedIds);
      if (error) throw error;
    },
    onSuccess: () => { toast.success(`Assigned ${selected.size} lead(s)`); clearSel(); qc.invalidateQueries({ queryKey: ["leads"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkStage = useMutation({
    mutationFn: async ({ stage, reason }: { stage: string; reason?: string }) => {
      const patch: Record<string, unknown> = { stage };
      if (reason !== undefined) patch.lost_reason = reason;
      const { error } = await supabase.from("leads").update(patch as never).in("id", selectedIds);
      if (error) throw error;
      return stage;
    },
    onSuccess: (stage) => {
      toast.success(`Moved ${selected.size} lead(s)`);
      // Trigger stage reminders for each lead that has an email.
      if (user && stage) {
        const leadsForReminder = rows.filter((l) => selectedIds.includes(l.id) && l.email);
        for (const l of leadsForReminder) {
          triggerStageReminder({ leadId: l.id, newStage: stage, clientName: l.client_name, clientEmail: l.email, userId: user.id });
        }
      }
      clearSel();
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkDelete = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("leads").delete().in("id", selectedIds);
      if (error) throw error;
    },
    onSuccess: () => { toast.success(`Deleted ${selected.size} lead(s)`); clearSel(); qc.invalidateQueries({ queryKey: ["leads"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  // ---- export (respects current filters, all matching rows) ----
  const exportCsv = async () => {
    setExporting(true);
    try {
      let query = supabase.from("leads")
        .select("lead_code, client_name, company_name, mobile, alt_mobile, email, city, state, service_required, source, interest, stage, score, budget, assigned_to, next_follow_up_at, created_at")
        .order("created_at", { ascending: false }).limit(5000);
      query = applyFilters(query);
      const { data: leadsData, error } = await query;
      if (error) throw error;
      const list = leadsData ?? [];
      if (list.length === 0) { toast.error("No leads match to export"); return; }

      const nameById = new Map((assignableUsers as any[]).map((u) => [u.id, u.full_name || u.email || ""]));
      const out = list.map((l: any) => ({
        "Lead Code": l.lead_code,
        "Name": l.client_name,
        "Company": l.company_name ?? "",
        "Mobile": l.mobile,
        "Alt Mobile": l.alt_mobile ?? "",
        "Email": l.email ?? "",
        "City": l.city ?? "",
        "State": l.state ?? "",
        "Service": labelFor(SERVICES, l.service_required),
        "Source": labelFor(SOURCES, l.source),
        "Interest": labelFor(INTERESTS, l.interest),
        "Stage": labelFor(STAGES, l.stage),
        "Score": l.score ?? 0,
        "Budget": l.budget ?? "",
        "Assigned To": l.assigned_to ? (nameById.get(l.assigned_to) ?? "") : "",
        "Next Follow-up": l.next_follow_up_at ?? "",
        "Created": l.created_at,
      }));
      downloadCsv(out, `leads-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success(`Exported ${out.length} lead(s)`);
    } catch (e: any) {
      toast.error(e.message ?? "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Leads</h1>
          <p className="text-sm text-muted-foreground">
            All your prospects in one place.{total > 0 && <> · <span className="font-medium text-foreground">{total.toLocaleString("en-IN")}</span> total</>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={exporting}>
            <Download className="h-4 w-4 mr-2" /> {exporting ? "Exporting…" : "Export"}
          </Button>
          <Button variant="outline" asChild>
            <Link to="/leads/import"><Upload className="h-4 w-4 mr-2" /> Import</Link>
          </Button>
          <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-2" /> New Lead</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-56">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search name, mobile, company, code…" value={q} onChange={(e) => onSearchChange(e.target.value)} />
          </div>
          <Select value={stage} onValueChange={setStage}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Stage" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              {STAGES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={interest} onValueChange={setInterest}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Interest" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All interests</SelectItem>
              {INTERESTS.map((s) => <SelectItem key={s.id} value={s.id}>{s.emoji} {s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={service} onValueChange={setService}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Service" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All services</SelectItem>
              {SERVICES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Date" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All time</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="this_week">This week</SelectItem>
              <SelectItem value="last_7d">Last 7 days</SelectItem>
              <SelectItem value="this_month">This month</SelectItem>
              <SelectItem value="last_month">Last month</SelectItem>
              <SelectItem value="last_30d">Last 30 days</SelectItem>
              <SelectItem value="custom">Specific date</SelectItem>
            </SelectContent>
          </Select>
          {dateRange === "custom" && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-[150px] justify-start text-left font-normal text-sm">
                  <CalendarIcon className="h-4 w-4 mr-2 text-muted-foreground" />
                  {customDate ? format(new Date(customDate + "T00:00:00"), "MMM d, yyyy") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={customDate ? new Date(customDate + "T00:00:00") : undefined}
                  onSelect={(date) => { if (date) setCustomDate(format(date, "yyyy-MM-dd")); }}
                />
              </PopoverContent>
            </Popover>
          )}
          <Select value={sortDir} onValueChange={setSortDir}>
            <SelectTrigger className="w-[130px]"><SelectValue placeholder="Sort" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant={showDupes ? "default" : "outline"}
            onClick={() => setShowDupes(!showDupes)}
            className={showDupes ? "bg-amber-600 hover:bg-amber-700" : ""}
          >
            {dupesLoading ? "Checking…" : showDupes ? `Duplicates (${dupeIds.size})` : "Duplicates"}
          </Button>
        </CardContent>
      </Card>

      {/* Duplicate groups panel */}
      {showDupes && dupeGroups.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm">Duplicate Groups Found: {dupeGroups.length}</div>
                <div className="text-xs text-muted-foreground">The first entry (oldest) is the original. Newer entries are likely duplicates — review and delete if needed.</div>
              </div>
            </div>
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {dupeGroups.map((g, gi) => (
                <div key={gi} className="rounded-lg border bg-background p-3">
                  <div className="text-xs text-muted-foreground mb-2">
                    Matched by <Badge variant="outline" className="text-[10px] ml-1">{g.matchType}</Badge>
                    <span className="ml-2">({g.leads.length} entries)</span>
                  </div>
                  <div className="space-y-1.5">
                    {g.leads.map((l: any, li: number) => (
                      <div key={l.id} className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${li === 0 ? "bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800" : "bg-muted/40 border border-dashed"}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {li === 0 && <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 text-[10px]">Original</Badge>}
                            {li > 0 && <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">Duplicate</Badge>}
                            <span className="font-medium truncate">{l.client_name}</span>
                            <span className="text-xs text-muted-foreground">{l.lead_code}</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {l.mobile && <span className="mr-3">{l.mobile}</span>}
                            {l.email && <span className="mr-3">{l.email}</span>}
                            <span>Added {format(new Date(l.created_at), "MMM d, yyyy")}</span>
                            {l.assigned_to && nameById.get(l.assigned_to) && <span className="ml-2">· {nameById.get(l.assigned_to)}</span>}
                          </div>
                        </div>
                        {li > 0 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive shrink-0"
                            disabled={deleteLead.isPending}
                            onClick={() => {
                              if (window.confirm(`Delete duplicate "${l.client_name}" (${l.lead_code})? This cannot be undone.`)) {
                                deleteLead.mutate(l.id);
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4 mr-1" /> Delete
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {showDupes && dupeGroups.length === 0 && !dupesLoading && (
        <Card className="border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20">
          <CardContent className="p-4 text-center text-sm text-emerald-700 dark:text-emerald-300">
            No duplicates found — your leads are clean!
          </CardContent>
        </Card>
      )}

      {selected.size > 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium mr-1">{selected.size} selected</span>
            <Select onValueChange={(v) => bulkAssign.mutate(v)}>
              <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Assign to…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {(assignableUsers as any[]).map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name || u.email || "User"}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select onValueChange={(v) => {
              if (v === "lost" || v === "not_interested") {
                setBulkReason("");
                setBulkReasonStage(v);
              } else {
                bulkStage.mutate({ stage: v });
              }
            }}>
              <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Change stage…" /></SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {isAdmin && (
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive"
                disabled={bulkDelete.isPending}
                onClick={() => { if (window.confirm(`Delete ${selected.size} lead(s)? This permanently removes them and cannot be undone.`)) bulkDelete.mutate(); }}>
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={clearSel}><X className="h-4 w-4 mr-1" /> Clear</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center">
              <div className="text-muted-foreground mb-4">No leads match your filters.</div>
              <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-2" /> Add a lead</Button>
            </div>
          ) : (
            <div className={isFetching ? "opacity-60 transition-opacity" : "transition-opacity"}>
              <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/30 text-xs text-muted-foreground">
                <Checkbox checked={allOnPageSelected} onCheckedChange={toggleAllOnPage} aria-label="Select all on page" />
                <span>Select all on this page</span>
              </div>
              {rows.map((l) => (
                <LeadRow key={l.id} l={l} selected={selected.has(l.id)} onToggle={toggleOne} nameOf={nameById} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {total > 0 && (
        <PaginationBar
          page={page}
          totalPages={totalPages}
          size={size}
          firstShown={firstShown}
          lastShown={lastShown}
          total={total}
          onPage={setPage}
          onSize={setSize}
        />
      )}

      <NewLeadDialog open={open} onOpenChange={setOpen} onCreated={(id) => navigate({ to: "/leads/$id", params: { id } })} />

      <Dialog open={!!bulkReasonStage} onOpenChange={(o) => { if (!o) setBulkReasonStage(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reason required</DialogTitle>
            <DialogDescription>
              Why are these <span className="font-medium text-foreground">{selected.size}</span> lead(s) marked{" "}
              <span className="font-medium text-foreground">{bulkReasonStage ? labelFor(STAGES, bulkReasonStage) : ""}</span>? This is mandatory.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            rows={3}
            value={bulkReason}
            onChange={(e) => setBulkReason(e.target.value)}
            placeholder="e.g. Chose a competitor · budget too high · no response…"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkReasonStage(null)}>Cancel</Button>
            <Button
              disabled={!bulkReason.trim() || bulkStage.isPending}
              onClick={() => { bulkStage.mutate({ stage: bulkReasonStage!, reason: bulkReason.trim() }); setBulkReasonStage(null); }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LeadRow({ l, selected, onToggle, nameOf }: { l: any; selected: boolean; onToggle: (id: string) => void; nameOf: Map<string, string> }) {
  const interestMeta = INTERESTS.find((i) => i.id === l.interest);
  const stageMeta = STAGES.find((s) => s.id === l.stage);
  const overdue = l.next_follow_up_at && new Date(l.next_follow_up_at) < new Date();
  const assigneeName = l.assigned_to ? nameOf.get(l.assigned_to) ?? "" : "";
  return (
    <div className="flex items-center border-b last:border-b-0">
      <div className="pl-4 pr-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selected} onCheckedChange={() => onToggle(l.id)} aria-label="Select lead" />
      </div>
      <Link
        to="/leads/$id"
        params={{ id: l.id }}
        className="flex-1 grid grid-cols-12 gap-3 items-center px-3 py-3 hover:bg-accent/40"
      >
        <div className="col-span-12 md:col-span-3 min-w-0">
          <div className="flex items-center gap-2">
            <div className="font-medium truncate">{l.client_name}</div>
            {interestMeta && (
              <Badge variant="secondary" className={interestMeta.className}>
                {interestMeta.emoji} {interestMeta.label}
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {l.lead_code} · {l.company_name ?? "—"}
          </div>
        </div>
        <div className="col-span-6 md:col-span-2 text-sm">
          <div className="flex items-center gap-1 text-muted-foreground"><Phone className="h-3 w-3" />{l.mobile}</div>
          {l.email && <div className="flex items-center gap-1 text-xs text-muted-foreground truncate"><Mail className="h-3 w-3" />{l.email}</div>}
        </div>
        <div className="col-span-6 md:col-span-2 text-xs text-muted-foreground truncate">
          {labelFor(SERVICES, l.service_required)}
        </div>
        <div className="col-span-4 md:col-span-2">
          {stageMeta && (
            <span className="inline-flex items-center gap-1.5 text-xs">
              <span className={`h-2 w-2 rounded-full ${stageMeta.color}`} />
              {stageMeta.label}
            </span>
          )}
        </div>
        <div className="col-span-4 md:col-span-1 text-xs text-muted-foreground truncate">
          {assigneeName || <span className="text-muted-foreground/50">—</span>}
        </div>
        <div className="col-span-4 md:col-span-2 text-right text-xs">
          {l.next_follow_up_at ? (
            <span className={overdue ? "text-destructive font-medium" : "text-muted-foreground"}>
              {overdue ? "Overdue " : ""}{formatDistanceToNow(new Date(l.next_follow_up_at), { addSuffix: true })}
            </span>
          ) : (
            <span className="text-amber-600">No follow-up</span>
          )}
        </div>
      </Link>
    </div>
  );
}

function PaginationBar({
  page, totalPages, size, firstShown, lastShown, total, onPage, onSize,
}: {
  page: number; totalPages: number; size: number; firstShown: number; lastShown: number; total: number;
  onPage: (p: number) => void; onSize: (v: string) => void;
}) {
  const [jump, setJump] = useState("");
  const pages = pageWindow(page, totalPages);
  const go = () => {
    const n = Number(jump);
    if (Number.isFinite(n) && n >= 1 && n <= totalPages) onPage(n);
    setJump("");
  };
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>Showing <span className="font-medium text-foreground">{firstShown.toLocaleString("en-IN")}</span>–<span className="font-medium text-foreground">{lastShown.toLocaleString("en-IN")}</span> of <span className="font-medium text-foreground">{total.toLocaleString("en-IN")}</span></span>
        <div className="flex items-center gap-1.5">
          <span>Per page</span>
          <Select value={String(size)} onValueChange={onSize}>
            <SelectTrigger className="h-8 w-[74px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((s) => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => onPage(1)} title="First page"><ChevronsLeft className="h-4 w-4" /></Button>
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => onPage(page - 1)} title="Previous page"><ChevronLeft className="h-4 w-4" /></Button>

        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="px-1.5 text-muted-foreground">…</span>
          ) : (
            <Button
              key={p}
              variant={p === page ? "default" : "outline"}
              size="icon"
              className="h-8 w-8"
              onClick={() => onPage(p as number)}
            >
              {p}
            </Button>
          )
        )}

        <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => onPage(page + 1)} title="Next page"><ChevronRight className="h-4 w-4" /></Button>
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => onPage(totalPages)} title="Last page"><ChevronsRight className="h-4 w-4" /></Button>

        {totalPages > 5 && (
          <div className="flex items-center gap-1 ml-2">
            <Input
              className="h-8 w-16"
              placeholder="Go to"
              value={jump}
              onChange={(e) => setJump(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter") go(); }}
            />
            <Button variant="outline" size="sm" className="h-8" onClick={go}>Go</Button>
          </div>
        )}
      </div>
    </div>
  );
}

// Build a compact page list like: 1 … 4 5 [6] 7 8 … 20
function pageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push("…");
  for (let p = start; p <= end; p++) out.push(p);
  if (end < total - 1) out.push("…");
  out.push(total);
  return out;
}

// Turn an array of flat objects into a CSV file and trigger a browser download.
function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
  // BOM so Excel opens UTF-8 (₹ etc.) correctly.
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
