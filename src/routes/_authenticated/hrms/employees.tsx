import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, Plus, Users, ShieldAlert, Lock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { getErrorMessage } from "@/lib/utils";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/lib/auth";
import {
  hrmsDb,
  employeeName,
  statusMeta,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_STATUSES,
  type Department,
  type Employee,
  type EmployeePrivate,
  type OfficeLocation,
} from "@/lib/hrms";

export const Route = createFileRoute("/_authenticated/hrms/employees")({
  head: () => ({ meta: [{ title: "Employees — EaseMyOffice CRM" }] }),
  // Admin guard lives on the /hrms layout route.
  component: EmployeesPage,
});

type Draft = Partial<Employee> & Partial<Omit<EmployeePrivate, "employee_id">>;

const blankDraft: Draft = {
  employee_code: "",
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  personal_email: "",
  designation: "",
  employment_type: "full_time",
  employment_status: "active",
  joining_date: "",
  notes: "",
};

function EmployeesPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [editing, setEditing] = useState<Employee | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ["hrms-employees"],
    queryFn: async (): Promise<Employee[]> => {
      const { data, error } = await hrmsDb()
        .from("employees")
        .select("*")
        .order("employee_code", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["hrms-departments"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Department[]> => {
      const { data } = await hrmsDb()
        .from("departments")
        .select("*")
        .eq("active", true)
        .order("name");
      return data ?? [];
    },
  });

  const { data: offices = [] } = useQuery({
    queryKey: ["hrms-offices"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<OfficeLocation[]> => {
      const { data } = await hrmsDb().from("office_locations").select("*").order("name");
      return data ?? [];
    },
  });

  // CRM logins that have no employee record yet, so the admin can attach one instead of
  // retyping the person's details.
  const { data: profiles = [] } = useQuery({
    queryKey: ["hrms-profiles"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .order("full_name");
      return data ?? [];
    },
  });

  const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "—";

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (statusFilter !== "all" && e.employment_status !== statusFilter) return false;
      if (!t) return true;
      return [e.employee_code, employeeName(e), e.email, e.phone, e.designation].some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(t),
      );
    });
  }, [employees, search, statusFilter]);

  const counts = useMemo(() => {
    const active = employees.filter((e) => e.employment_status === "active").length;
    return { total: employees.length, active };
  }, [employees]);

  const remove = useMutation({
    mutationFn: async (e: Employee) => {
      const { error } = await hrmsDb().from("employees").delete().eq("id", e.id);
      if (error) throw new Error(error.message);
      logAudit({
        actorId: user?.id,
        action: "delete",
        entity: "lead",
        entityId: e.id,
        entityLabel: employeeName(e),
        detail: `Deleted employee ${e.employee_code} (${employeeName(e)})`,
      });
    },
    onSuccess: () => {
      toast.success("Employee removed");
      qc.invalidateQueries({ queryKey: ["hrms-employees"] });
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" /> Employees
          </h2>
          <p className="text-sm text-muted-foreground">
            {counts.active} active · {counts.total} total. Bank, PAN and Aadhaar are admin-only.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add employee
        </Button>
      </div>

      {offices.length === 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-xs dark:border-amber-800/50 dark:bg-amber-950/20">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            No office location configured yet. Add one in <strong>Office &amp; Hours</strong> before
            attendance goes live — the geofence has nothing to measure against without it.
          </span>
        </div>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative w-72 max-w-full">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search name, code, phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {EMPLOYMENT_STATUSES.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Designation</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>CRM login</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  No employees yet. Click “Add employee” to create the first record.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((e) => {
              const meta = statusMeta(e.employment_status);
              return (
                <TableRow
                  key={e.id}
                  className="cursor-pointer hover:bg-muted/30"
                  onClick={() => setEditing(e)}
                >
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {e.employee_code}
                  </TableCell>
                  <TableCell className="font-medium">{employeeName(e)}</TableCell>
                  <TableCell>{deptName(e.department_id)}</TableCell>
                  <TableCell className="text-muted-foreground">{e.designation || "—"}</TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {e.joining_date ? format(new Date(e.joining_date), "d MMM yyyy") : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {EMPLOYMENT_TYPES.find((t) => t.id === e.employment_type)?.label ??
                      e.employment_type}
                  </TableCell>
                  <TableCell>
                    <Badge className={meta.className}>{meta.label}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {e.profile_id ? (
                      <span className="text-emerald-600">Linked</span>
                    ) : (
                      <span className="text-amber-600">Not linked</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <p className="text-xs text-muted-foreground">
        A CRM login must be linked before that person can mark attendance — attendance is recorded
        against the logged-in user.
      </p>

      {(addOpen || editing) && (
        <EmployeeDialog
          employee={editing}
          departments={departments}
          offices={offices}
          employees={employees}
          profiles={profiles as { id: string; full_name: string | null; email: string | null }[]}
          onClose={() => {
            setAddOpen(false);
            setEditing(null);
          }}
          onDelete={editing ? () => remove.mutate(editing) : undefined}
        />
      )}
    </div>
  );
}

function EmployeeDialog({
  employee,
  departments,
  offices,
  employees,
  profiles,
  onClose,
  onDelete,
}: {
  employee: Employee | null;
  departments: Department[];
  offices: OfficeLocation[];
  employees: Employee[];
  profiles: { id: string; full_name: string | null; email: string | null }[];
  onClose: () => void;
  onDelete?: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isEdit = !!employee;
  const [f, setF] = useState<Draft>(blankDraft);

  // Private fields are fetched separately (own table, admin-only RLS) and only
  // when editing — there is nothing to load for a new record.
  const { data: priv } = useQuery({
    queryKey: ["hrms-employee-private", employee?.id],
    enabled: !!employee?.id,
    queryFn: async (): Promise<EmployeePrivate | null> => {
      const { data } = await hrmsDb()
        .from("employee_private")
        .select("*")
        .eq("employee_id", employee!.id)
        .maybeSingle();
      return data ?? null;
    },
  });

  useEffect(() => {
    if (!employee) {
      setF(blankDraft);
      return;
    }
    setF({
      ...employee,
      joining_date: employee.joining_date ?? "",
      exit_date: employee.exit_date ?? "",
    });
  }, [employee]);

  useEffect(() => {
    if (priv) setF((s) => ({ ...s, ...priv }));
  }, [priv]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((s) => ({ ...s, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      if (!String(f.first_name ?? "").trim()) throw new Error("First name is required");
      if (!String(f.employee_code ?? "").trim()) throw new Error("Employee code is required");

      const core = {
        employee_code: String(f.employee_code).trim(),
        first_name: String(f.first_name).trim(),
        last_name: f.last_name || null,
        phone: f.phone || null,
        email: f.email || null,
        personal_email: f.personal_email || null,
        department_id: f.department_id || null,
        designation: f.designation || null,
        reporting_manager_id: f.reporting_manager_id || null,
        joining_date: f.joining_date || null,
        employment_type: f.employment_type || "full_time",
        employment_status: f.employment_status || "active",
        office_id: f.office_id || null,
        exit_date: f.exit_date || null,
        notes: f.notes || null,
        profile_id: f.profile_id || null,
      };

      let employeeId = employee?.id;
      if (isEdit) {
        const { error } = await hrmsDb().from("employees").update(core).eq("id", employeeId);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await hrmsDb().from("employees").insert(core).select("id").single();
        if (error) throw new Error(error.message);
        employeeId = data?.id;
      }

      // Upserted separately so a failure here cannot leave the core record
      // half-written, and so the private row simply does not exist when no
      // sensitive detail was entered.
      const privateFields = {
        pan: f.pan || null,
        aadhaar: f.aadhaar || null,
        bank_name: f.bank_name || null,
        bank_account_name: f.bank_account_name || null,
        bank_account_no: f.bank_account_no || null,
        bank_ifsc: f.bank_ifsc || null,
        uan: f.uan || null,
        esi_number: f.esi_number || null,
      };
      const hasPrivate = Object.values(privateFields).some((v) => !!v);
      if (employeeId && hasPrivate) {
        const { error } = await hrmsDb()
          .from("employee_private")
          .upsert({ employee_id: employeeId, ...privateFields });
        if (error) throw new Error(error.message);
      }

      logAudit({
        actorId: user?.id,
        action: isEdit ? "edit" : "create",
        entity: "lead",
        entityId: employeeId ?? null,
        entityLabel: `${core.first_name} ${core.last_name ?? ""}`.trim(),
        detail: `${isEdit ? "Updated" : "Created"} employee ${core.employee_code}`,
      });
    },
    onSuccess: () => {
      toast.success(isEdit ? "Employee updated" : "Employee added");
      qc.invalidateQueries({ queryKey: ["hrms-employees"] });
      qc.invalidateQueries({ queryKey: ["hrms-employee-private", employee?.id] });
      onClose();
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  const T = (
    k: keyof Draft,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        value={(f[k] as string) ?? ""}
        onChange={(e) => set(k, e.target.value as Draft[typeof k])}
        {...props}
      />
    </div>
  );

  // A manager cannot be the employee themselves.
  const managerOptions = employees.filter((e) => e.id !== employee?.id);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${employeeName(employee!)}` : "Add employee"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-3">
          {T("employee_code", "Employee Code *", { placeholder: "EMO-EMP-001" })}
          {T("first_name", "First Name *")}
          {T("last_name", "Last Name")}
          {T("phone", "Phone", { inputMode: "tel" })}
          {T("email", "Work Email", { type: "email" })}
          {T("personal_email", "Personal Email", { type: "email" })}

          <div>
            <Label className="text-xs">Department</Label>
            <Select
              value={f.department_id ?? "none"}
              onValueChange={(v) => set("department_id", v === "none" ? null : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {T("designation", "Designation")}
          <div>
            <Label className="text-xs">Reporting Manager</Label>
            <Select
              value={f.reporting_manager_id ?? "none"}
              onValueChange={(v) => set("reporting_manager_id", v === "none" ? null : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {managerOptions.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {employeeName(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {T("joining_date", "Joining Date", { type: "date" })}
          <div>
            <Label className="text-xs">Employment Type</Label>
            <Select
              value={f.employment_type ?? "full_time"}
              onValueChange={(v) => set("employment_type", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMPLOYMENT_TYPES.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select
              value={f.employment_status ?? "active"}
              onValueChange={(v) => set("employment_status", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMPLOYMENT_STATUSES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Assigned Office</Label>
            <Select
              value={f.office_id ?? "none"}
              onValueChange={(v) => set("office_id", v === "none" ? null : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {offices.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">CRM Login</Label>
            <Select
              value={f.profile_id ?? "none"}
              onValueChange={(v) => set("profile_id", v === "none" ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Link a login…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not linked</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(f.employment_status === "resigned" || f.employment_status === "terminated") &&
            T("exit_date", "Exit Date", { type: "date" })}
        </div>

        {/* Sensitive block, stored in employee_private with admin-only RLS. */}
        <div className="mt-4 rounded-md border bg-muted/20 p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Lock className="h-4 w-4 text-muted-foreground" /> Private details
            <span className="text-xs font-normal text-muted-foreground">
              · admin only, never shown to the employee
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {T("pan", "PAN")}
            {T("aadhaar", "Aadhaar")}
            {T("uan", "UAN (PF)")}
            {T("esi_number", "ESI Number")}
            {T("bank_name", "Bank Name")}
            {T("bank_account_name", "Account Holder Name")}
            {T("bank_account_no", "Account Number")}
            {T("bank_ifsc", "IFSC")}
          </div>
        </div>

        <div className="mt-3">
          <Label className="text-xs">Notes</Label>
          <Textarea
            rows={2}
            value={(f.notes as string) ?? ""}
            onChange={(e) => set("notes", e.target.value)}
          />
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          {onDelete && (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive sm:mr-auto"
              onClick={() => {
                if (confirm("Remove this employee record? Attendance history would be lost.")) {
                  onDelete();
                  onClose();
                }
              }}
            >
              Remove
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || !f.first_name || !f.employee_code}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : isEdit ? "Save changes" : "Add employee"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
