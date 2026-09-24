import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INTERESTS, SERVICES, SOURCES, STAGES, labelFor } from "@/lib/crm";
import { Plus, Search, Phone, Mail, Upload, Download, Trash2, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CalendarIcon, AlertTriangle } from "lucide-react";
import { useLeadColWidths, LEAD_COLUMNS, type LeadColKey } from "@/lib/leads-columns";
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

// A user that a lead can be assigned to (from the `profiles` table).
type AssignableUser = { id: string; full_name: string | null; email: string | null };

// The subset of lead columns fetched for the list/dupe views. Kept as a hand
// written shape (rather than the full generated Row) because the queries only
// select these columns.
type LeadListRow = {
  id: string;
  lead_code: string | null;
  client_name: string | null;
  company_name?: string | null;
  mobile: string | null;
  email: string | null;
  stage: string | null;
  interest?: string | null;
  service_required?: string | null;
  source?: string | null;
  score?: number | null;
  assigned_to: string | null;
  next_follow_up_at?: string | null;
  last_activity_at?: string | null;
  created_at: string;
};

// A lead in the duplicate finder — the fetched row plus normalized match fields.
type DupeLead = LeadListRow & { _phone: string; _email: string; _name: string };

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
  // Per-user resizable column widths for the list.
  const { setWidth, reset: resetCols, template: colTemplate } = useLeadColWidths(user?.id ?? "anon");
  // Begin a column drag-resize from the header handle.
  const startResize = (e: React.MouseEvent, key: LeadColKey) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = (e.currentTarget.closest("[data-col-header]") as HTMLElement | null)?.offsetWidth
      ?? (e.currentTarget.parentElement as HTMLElement).offsetWidth;
    const onMove = (ev: MouseEvent) => setWidth(key, startW + (ev.clientX - startX));
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const [q, setQ] = useState(search.q ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [bulkReasonStage, setBulkReasonStage] = useState<string | null>(null);
  const [bulkReason, setBulkReason] = useState("");
  const [showDupes, setShowDupes] = useState(false);
  // When a lead's duplicate icon is clicked, open the Duplicates panel focused
  // on that lead's group.
  const [focusGroupKey, setFocusGroupKey] = useState<string | null>(null);
  const focusGroupRef = useRef<HTMLDivElement | null>(null);
  const [customDate, setCustomDate] = useState("");
  // Custom date-range mode: inclusive from/to as YYYY-MM-DD strings (component state, mirrors customDate).
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // Track user-overridden "originals" per duplicate group
  const [originalOverrides, setOriginalOverrides] = useState<Record<string, string>>({});
  const [overrideVersion, setOverrideVersion] = useState(0);
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
      } else if (dateRange === "custom_range") {
        // Inclusive range from customFrom (start of day) to customTo (end of day).
        // Swap if the user picked the dates reversed so from <= to always holds.
        let lo = customFrom;
        let hi = customTo;
        if (lo && hi && lo > hi) [lo, hi] = [hi, lo];
        if (lo) from = new Date(`${lo}T00:00:00.000`);
        if (hi) to = new Date(`${hi}T23:59:59.999`);
      }
      if (from) query = query.gte("created_at", from.toISOString());
      if (to) query = query.lte("created_at", to.toISOString());
    }
    return query;
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["leads", q, stage, interest, service, owner, dateRange, customDate, customFrom, customTo, sortDir, page, size],
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
    queryFn: async (): Promise<AssignableUser[]> => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").order("full_name", { ascending: true });
      return data ?? [];
    },
  });

  // Duplicate detection: fetch all leads' phone/email/name and find IDs that share
  // the same contact info. Only runs when "Show duplicates" is active.
  // A lead is a duplicate only if AT LEAST 2 of 3 fields match another lead:
  //   - Name + Email, OR Name + Phone, OR Email + Phone
  type DupeGroup = { matchKey: string; matchType: string; leads: DupeLead[] };
  const { data: dupeData, isLoading: dupesLoading } = useQuery({
    queryKey: ["leads-duplicates"],
    // Always run (not just when the Duplicates filter is on) so the list can
    // show a "possible duplicate" badge on affected rows. Cheap + 60s stale.
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("leads")
        .select("id, lead_code, client_name, mobile, email, created_at, assigned_to, stage")
        .order("created_at", { ascending: true })
        .limit(5000);
      if (!data) return { ids: new Set<string>(), groups: [] as DupeGroup[] };

      // Normalise fields for comparison
      const leads: DupeLead[] = ((data ?? []) as LeadListRow[]).map((l) => ({
        ...l,
        _phone: (l.mobile ?? "").replace(/\D/g, "").slice(-10),
        _email: (l.email ?? "").trim().toLowerCase(),
        _name: (l.client_name ?? "").trim().toLowerCase(),
      }));

      // For each pair of leads, check if 2+ fields match.
      // Use composite keys to group: "name+phone", "name+email", "phone+email"
      const groupMap = new Map<string, DupeLead[]>();

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
          if (!group.find((x) => x.id === a.id)) group.push(a);
          if (!group.find((x) => x.id === b.id)) group.push(b);
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
        groups.push({ matchKey: key, matchType: types, leads: arr.sort((a, b) => a.created_at < b.created_at ? -1 : 1) });
      }
      return { ids, groups };
    },
  });
  const dupeIds = dupeData?.ids ?? new Set<string>();
  const dupeGroups = dupeData?.groups ?? [];

  // leadId -> its duplicate group key, so clicking a row's duplicate icon can
  // jump straight to that group in the Duplicates panel.
  const groupKeyByLead = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of dupeGroups) for (const l of g.leads) m.set(l.id, g.matchKey);
    return m;
  }, [dupeGroups]);

  // Open the Duplicates panel focused on a specific lead's group.
  const openDuplicatesFor = useCallback(
    (leadId: string) => {
      const key = groupKeyByLead.get(leadId) ?? null;
      setShowDupes(true);
      setFocusGroupKey(key);
    },
    [groupKeyByLead],
  );

  // Scroll the focused duplicate group into view once the panel renders it.
  useEffect(() => {
    if (showDupes && focusGroupKey && focusGroupRef.current) {
      focusGroupRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [showDupes, focusGroupKey, dupeGroups]);

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

  // Merge: keep the selected lead as original, transfer assignee, and merge the
  // rest INTO it. The merge_leads RPC re-points the losing leads' activities +
  // follow-ups onto the kept lead before deleting them, so no history is lost.
  const mergeLead = useMutation({
    mutationFn: async ({ keepId, deleteIds, assignFrom }: { keepId: string; deleteIds: string[]; assignFrom: string | null }) => {
      // 1) If the lead we're keeping has no assignee, copy from the one being deleted
      if (assignFrom) {
        await supabase.from("leads").update({ assigned_to: assignFrom }).eq("id", keepId);
      }
      // 2) Merge (re-point history) + delete the duplicates in one RPC call.
      // merge_leads is a custom RPC not in the generated types yet; cast the
      // client so TS allows the call (mirrors find_duplicate_lead usage).
      const { error } = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ error: { message: string } | null }>)("merge_leads", {
        p_keep_id: keepId,
        p_delete_ids: deleteIds,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Merged — duplicates removed, history & assignee kept");
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["leads-duplicates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => {
    const allRows = data?.rows ?? [];
    if (!showDupes) return allRows;
    return allRows.filter((r) => dupeIds.has(r.id));
  }, [data?.rows, showDupes, dupeIds]);
  const total = showDupes ? rows.length : (data?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const firstShown = total === 0 ? 0 : (page - 1) * size + 1;
  const lastShown = Math.min(page * size, total);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    assignableUsers.forEach((u) => m.set(u.id, u.full_name || u.email || ""));
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
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
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
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  const bulkDelete = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("leads").delete().in("id", selectedIds);
      if (error) throw error;
    },
    onSuccess: () => { toast.success(`Deleted ${selected.size} lead(s)`); clearSel(); qc.invalidateQueries({ queryKey: ["leads"] }); },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
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

      const nameById = new Map(assignableUsers.map((u) => [u.id, u.full_name || u.email || ""]));
      const out = list.map((l) => ({
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
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, "Export failed"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-5 md:p-10 space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Leads</h1>
          <p className="text-sm text-muted-foreground">
            All your prospects in one place.{total > 0 && <> · <span className="font-medium text-foreground">{total.toLocaleString("en-IN")}</span> total</>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="transition-all duration-200 ease-out hover:shadow-sm" onClick={exportCsv} disabled={exporting}>
            <Download className="h-4 w-4 mr-2" /> {exporting ? "Exporting…" : "Export"}
          </Button>
          <Button variant="outline" className="transition-all duration-200 ease-out hover:shadow-sm" asChild>
            <Link to="/leads/import"><Upload className="h-4 w-4 mr-2" /> Import</Link>
          </Button>
          <Button className="transition-all duration-200 ease-out hover:shadow-sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-2" /> New Lead</Button>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4 flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-56">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9 focus:ring-2 ring-primary/20 transition-all duration-200 ease-out" placeholder="Search name, mobile, company, code…" value={q} onChange={(e) => onSearchChange(e.target.value)} />
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
              <SelectItem value="custom_range">Date range</SelectItem>
            </SelectContent>
          </Select>
          {dateRange === "custom" && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-[150px] justify-start text-left font-normal text-sm transition-all duration-200 ease-out">
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
          {dateRange === "custom_range" && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-[220px] justify-start text-left font-normal text-sm transition-all duration-200 ease-out">
                  <CalendarIcon className="h-4 w-4 mr-2 text-muted-foreground" />
                  {customFrom && customTo
                    ? `${format(new Date(customFrom + "T00:00:00"), "MMM d")} – ${format(new Date(customTo + "T00:00:00"), "MMM d, yyyy")}`
                    : customFrom
                      ? `${format(new Date(customFrom + "T00:00:00"), "MMM d, yyyy")} – …`
                      : "Pick a range"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  numberOfMonths={2}
                  selected={{
                    from: customFrom ? new Date(customFrom + "T00:00:00") : undefined,
                    to: customTo ? new Date(customTo + "T00:00:00") : undefined,
                  }}
                  onSelect={(range) => {
                    setCustomFrom(range?.from ? format(range.from, "yyyy-MM-dd") : "");
                    setCustomTo(range?.to ? format(range.to, "yyyy-MM-dd") : "");
                    if (page !== 1) navigate({ to: "/leads", search: { ...search, page: undefined } });
                  }}
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
            className={showDupes ? "bg-amber-600 hover:bg-amber-700 transition-all duration-200 ease-out" : "transition-all duration-200 ease-out"}
          >
            {dupesLoading ? "Checking…" : showDupes ? `Duplicates (${dupeIds.size})` : "Duplicates"}
          </Button>
          {/* Column resizing is desktop-only, so hide the reset on mobile. */}
          <Button
            size="sm"
            variant="ghost"
            onClick={resetCols}
            title="Reset column widths to default"
            className="hidden md:inline-flex transition-all duration-200 ease-out"
          >
            Reset columns
          </Button>
        </CardContent>
      </Card>

      {/* Duplicate groups panel */}
      {showDupes && dupeGroups.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/50 dark:bg-amber-950/20 shadow-sm">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm">Duplicate Groups Found: {dupeGroups.length}</div>
                <div className="text-xs text-muted-foreground">The first entry (oldest) is the original. Newer entries are likely duplicates — review and delete if needed.</div>
              </div>
            </div>
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {[...dupeGroups]
                .sort((a, b) => (a.matchKey === focusGroupKey ? -1 : b.matchKey === focusGroupKey ? 1 : 0))
                .map((g, gi) => {
                // Reorder leads: if user has overridden the original, put that one first
                const gKey = g.matchKey;
                const overrideId = originalOverrides[gKey];
                const orderedLeads: DupeLead[] = overrideId && g.leads.some((l) => l.id === overrideId)
                  ? [g.leads.find((l) => l.id === overrideId)!, ...g.leads.filter((l) => l.id !== overrideId)]
                  : [...g.leads];
                const isFocused = gKey === focusGroupKey;
                return (
                <div
                  key={`${gKey}-${overrideVersion}`}
                  ref={isFocused ? focusGroupRef : undefined}
                  className={`rounded-xl border bg-background p-3 hover:shadow-sm transition-all duration-200 ease-out ${isFocused ? "ring-2 ring-amber-400 border-amber-400" : ""}`}
                >
                  <div className="text-xs text-muted-foreground mb-2">
                    Matched by <Badge variant="outline" className="text-[10px] ml-1 rounded-full">{g.matchType}</Badge>
                    <span className="ml-2">({g.leads.length} entries)</span>
                  </div>
                  <div className="space-y-1.5">
                    {orderedLeads.map((l, li: number) => (
                      <div key={l.id} className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${li === 0 ? "bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800" : "bg-muted/40 border border-dashed"}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {li === 0 && <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 text-[10px] rounded-full">Original</Badge>}
                            {li > 0 && <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 rounded-full">Duplicate</Badge>}
                            <span className="font-medium truncate">{l.client_name}</span>
                            <span className="text-xs text-muted-foreground">{l.lead_code}</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground/70 mt-0.5">
                            {l.mobile && <span className="mr-3">{l.mobile}</span>}
                            {l.email && <span className="mr-3">{l.email}</span>}
                            <span>Added {format(new Date(l.created_at), "MMM d, yyyy")}</span>
                            {l.assigned_to && nameById.get(l.assigned_to) && <span className="ml-2">· {nameById.get(l.assigned_to)}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {li > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-emerald-600 hover:text-emerald-700 border-emerald-300 text-xs transition-all duration-200 ease-out"
                              disabled={mergeLead.isPending}
                              onClick={() => {
                                const others = orderedLeads.filter((_, i: number) => i !== li);
                                const assignFrom = l.assigned_to ? null : others.find((o) => o.assigned_to)?.assigned_to ?? null;
                                const deleteIds = others.map((o) => o.id);
                                if (window.confirm(
                                  `Keep "${l.client_name}" (${l.lead_code}) as the original and delete ${deleteIds.length} duplicate(s)?` +
                                  (assignFrom ? `\n\nThe assignee (${nameById.get(assignFrom) || "salesperson"}) will be transferred to this lead.` : "")
                                )) {
                                  mergeLead.mutate({ keepId: l.id, deleteIds, assignFrom });
                                }
                              }}
                            >
                              Mark as Original
                            </Button>
                          )}
                          {li > 0 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive transition-all duration-200 ease-out"
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
                      </div>
                    ))}
                  </div>
                </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {showDupes && dupeGroups.length === 0 && !dupesLoading && (
        <Card className="border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20 shadow-sm">
          <CardContent className="p-4 text-center text-sm text-emerald-700 dark:text-emerald-300">
            No duplicates found — your leads are clean!
          </CardContent>
        </Card>
      )}

      {selected.size > 0 && (
        <Card className="border-primary/40 bg-primary/5 shadow-sm">
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
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive transition-all duration-200 ease-out"
                disabled={bulkDelete.isPending}
                onClick={() => { if (window.confirm(`Delete ${selected.size} lead(s)? This permanently removes them and cannot be undone.`)) bulkDelete.mutate(); }}>
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </Button>
            )}
            <Button variant="ghost" size="sm" className="transition-all duration-200 ease-out" onClick={clearSel}><X className="h-4 w-4 mr-1" /> Clear</Button>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-sm">
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
              {/* Horizontal scroll wrapper — columns have fixed px widths that
                  can exceed the viewport once the user widens them. */}
              {/* Desktop: resizable table (fixed px columns + horizontal scroll). */}
              <div className="hidden md:block overflow-x-auto scrollbar-modern">
                <div style={{ minWidth: "min-content" }}>
                  {/* Resizable column header. Drag the handle between two
                      headers to resize; widths persist per user. */}
                  <div
                    className="grid items-center border-b bg-muted/30 text-[11px] font-medium uppercase tracking-wide text-muted-foreground select-none"
                    style={{ gridTemplateColumns: colTemplate }}
                  >
                    <div className="flex items-center justify-center py-2">
                      <Checkbox checked={allOnPageSelected} onCheckedChange={toggleAllOnPage} aria-label="Select all on page" />
                    </div>
                    {LEAD_COLUMNS.map((c, i) => (
                      <div key={c.key} data-col-header className="relative flex items-center px-3 py-2">
                        <span className="truncate">{c.label}</span>
                        {/* Drag handle on the right edge (not after the last col). */}
                        {i < LEAD_COLUMNS.length - 1 && (
                          <span
                            role="separator"
                            aria-orientation="vertical"
                            aria-label={`Resize ${c.label} column`}
                            onMouseDown={(e) => startResize(e, c.key)}
                            className="absolute right-0 top-0 h-full w-2 cursor-col-resize group"
                          >
                            <span className="absolute right-0 top-1/2 -translate-y-1/2 h-4 w-px bg-border group-hover:bg-primary group-hover:w-0.5 transition-colors" />
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  {rows.map((l) => (
                    <LeadRow key={l.id} l={l} selected={selected.has(l.id)} onToggle={toggleOne} nameOf={nameById} isDupe={dupeIds.has(l.id)} onDupeClick={openDuplicatesFor} template={colTemplate} />
                  ))}
                </div>
              </div>

              {/* Mobile: stacked cards (no horizontal scroll / no tiny columns). */}
              <div className="md:hidden divide-y">
                {rows.map((l) => (
                  <LeadCard key={l.id} l={l} selected={selected.has(l.id)} onToggle={toggleOne} nameOf={nameById} isDupe={dupeIds.has(l.id)} onDupeClick={openDuplicatesFor} />
                ))}
              </div>
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

function LeadRow({ l, selected, onToggle, nameOf, isDupe, onDupeClick, template }: { l: LeadListRow; selected: boolean; onToggle: (id: string) => void; nameOf: Map<string, string>; isDupe?: boolean; onDupeClick?: (id: string) => void; template: string }) {
  const interestMeta = INTERESTS.find((i) => i.id === l.interest);
  const stageMeta = STAGES.find((s) => s.id === l.stage);
  const overdue = l.next_follow_up_at && new Date(l.next_follow_up_at) < new Date();
  const assigneeName = l.assigned_to ? nameOf.get(l.assigned_to) ?? "" : "";
  return (
    <div className="grid items-center border-b last:border-b-0 hover:bg-accent/30 transition-colors" style={{ gridTemplateColumns: template }}>
      <div className="flex items-center justify-center py-3" onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}>
        <Checkbox checked={selected} onCheckedChange={() => onToggle(l.id)} aria-label="Select lead" />
      </div>
      {/* Name */}
      <Link to="/leads/$id" params={{ id: l.id }} className="min-w-0 px-3 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="font-medium truncate">{l.client_name}</div>
          {interestMeta && (
            <Badge variant="secondary" className={`${interestMeta.className} rounded-full shrink-0`}>
              {interestMeta.emoji} {interestMeta.label}
            </Badge>
          )}
          {isDupe && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDupeClick?.(l.id); }}
              className="inline-flex items-center justify-center h-5 w-5 rounded-full border border-amber-300 text-amber-600 dark:text-amber-300 shrink-0 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors cursor-pointer"
              title="Possible duplicate — click to see all matching leads"
              aria-label="Show duplicate leads"
            >
              <AlertTriangle className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {l.lead_code} · {l.company_name ?? "—"}
        </div>
      </Link>
      {/* Contact */}
      <Link to="/leads/$id" params={{ id: l.id }} className="min-w-0 px-3 py-3 text-sm">
        <div className="flex items-center gap-1 text-muted-foreground"><Phone className="h-3 w-3 shrink-0" /><span className="truncate">{l.mobile}</span></div>
        {l.email && <div className="flex items-center gap-1 text-xs text-muted-foreground"><Mail className="h-3 w-3 shrink-0" /><span className="truncate">{l.email}</span></div>}
      </Link>
      {/* Service */}
      <Link to="/leads/$id" params={{ id: l.id }} className="min-w-0 px-3 py-3 text-xs text-muted-foreground truncate">
        {labelFor(SERVICES, l.service_required)}
      </Link>
      {/* Stage */}
      <Link to="/leads/$id" params={{ id: l.id }} className="min-w-0 px-3 py-3">
        {stageMeta && (
          <span className="inline-flex items-center gap-1.5 text-xs min-w-0">
            <span className={`h-2 w-2 rounded-full shrink-0 ${stageMeta.color}`} />
            <span className="truncate">{stageMeta.label}</span>
          </span>
        )}
      </Link>
      {/* Owner */}
      <Link to="/leads/$id" params={{ id: l.id }} className="min-w-0 px-3 py-3 text-xs text-muted-foreground truncate">
        {assigneeName || <span className="text-muted-foreground/50">—</span>}
      </Link>
      {/* Follow-up */}
      <Link to="/leads/$id" params={{ id: l.id }} className="min-w-0 px-3 py-3 text-[11px]">
        {l.next_follow_up_at ? (
          <span className={overdue ? "text-destructive font-medium" : "text-muted-foreground/70"}>
            {overdue ? "Overdue " : ""}{formatDistanceToNow(new Date(l.next_follow_up_at), { addSuffix: true })}
          </span>
        ) : (
          <span className="text-amber-600">No follow-up</span>
        )}
      </Link>
    </div>
  );
}

// Mobile card — same data as a row, stacked so nothing gets truncated on a
// phone. The whole card is tappable (opens the lead); the checkbox + duplicate
// icon stop propagation.
function LeadCard({ l, selected, onToggle, nameOf, isDupe, onDupeClick }: { l: LeadListRow; selected: boolean; onToggle: (id: string) => void; nameOf: Map<string, string>; isDupe?: boolean; onDupeClick?: (id: string) => void }) {
  const interestMeta = INTERESTS.find((i) => i.id === l.interest);
  const stageMeta = STAGES.find((s) => s.id === l.stage);
  const overdue = l.next_follow_up_at && new Date(l.next_follow_up_at) < new Date();
  const assigneeName = l.assigned_to ? nameOf.get(l.assigned_to) ?? "" : "";
  return (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-accent/30 transition-colors">
      <div className="pt-1 shrink-0" onClick={(e) => { e.stopPropagation(); }}>
        <Checkbox checked={selected} onCheckedChange={() => onToggle(l.id)} aria-label="Select lead" />
      </div>
      <Link to="/leads/$id" params={{ id: l.id }} className="flex-1 min-w-0 space-y-1.5">
        {/* Top: name + interest + dupe */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{l.client_name}</span>
          {interestMeta && (
            <Badge variant="secondary" className={`${interestMeta.className} rounded-full`}>
              {interestMeta.emoji} {interestMeta.label}
            </Badge>
          )}
          {isDupe && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDupeClick?.(l.id); }}
              className="inline-flex items-center justify-center h-5 w-5 rounded-full border border-amber-300 text-amber-600 dark:text-amber-300 shrink-0 hover:bg-amber-100 dark:hover:bg-amber-900/40"
              title="Possible duplicate — tap to see all matching leads"
              aria-label="Show duplicate leads"
            >
              <AlertTriangle className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="text-xs text-muted-foreground">{l.lead_code} · {l.company_name ?? "—"}</div>
        {/* Contact */}
        <div className="text-sm text-muted-foreground space-y-0.5">
          {l.mobile && <div className="flex items-center gap-1"><Phone className="h-3 w-3 shrink-0" />{l.mobile}</div>}
          {l.email && <div className="flex items-center gap-1 text-xs"><Mail className="h-3 w-3 shrink-0" /><span className="truncate">{l.email}</span></div>}
        </div>
        {/* Meta row: stage · service · owner */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {stageMeta && (
            <span className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${stageMeta.color}`} />
              {stageMeta.label}
            </span>
          )}
          <span className="text-muted-foreground">· {labelFor(SERVICES, l.service_required)}</span>
          {assigneeName && <span className="text-muted-foreground">· {assigneeName}</span>}
        </div>
        {/* Follow-up */}
        <div className="text-[11px]">
          {l.next_follow_up_at ? (
            <span className={overdue ? "text-destructive font-medium" : "text-muted-foreground/70"}>
              {overdue ? "Overdue " : "Follow-up "}{formatDistanceToNow(new Date(l.next_follow_up_at), { addSuffix: true })}
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
        <Button variant="outline" size="icon" className="h-8 w-8 transition-all duration-200 ease-out hover:shadow-sm" disabled={page <= 1} onClick={() => onPage(1)} title="First page"><ChevronsLeft className="h-4 w-4" /></Button>
        <Button variant="outline" size="icon" className="h-8 w-8 transition-all duration-200 ease-out hover:shadow-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} title="Previous page"><ChevronLeft className="h-4 w-4" /></Button>

        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="px-1.5 text-muted-foreground">…</span>
          ) : (
            <Button
              key={p}
              variant={p === page ? "default" : "outline"}
              size="icon"
              className="h-8 w-8 transition-all duration-200 ease-out hover:shadow-sm"
              onClick={() => onPage(p as number)}
            >
              {p}
            </Button>
          )
        )}

        <Button variant="outline" size="icon" className="h-8 w-8 transition-all duration-200 ease-out hover:shadow-sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)} title="Next page"><ChevronRight className="h-4 w-4" /></Button>
        <Button variant="outline" size="icon" className="h-8 w-8 transition-all duration-200 ease-out hover:shadow-sm" disabled={page >= totalPages} onClick={() => onPage(totalPages)} title="Last page"><ChevronsRight className="h-4 w-4" /></Button>

        {totalPages > 5 && (
          <div className="flex items-center gap-1 ml-2">
            <Input
              className="h-8 w-16"
              placeholder="Go to"
              value={jump}
              onChange={(e) => setJump(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter") go(); }}
            />
            <Button variant="outline" size="sm" className="h-8 transition-all duration-200 ease-out hover:shadow-sm" onClick={go}>Go</Button>
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
