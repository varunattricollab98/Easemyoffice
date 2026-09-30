import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  FileText,
  IndianRupee,
  Lock,
  LockOpen,
  Pencil,
  Printer,
  Wallet,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { cn, formatINR, getErrorMessage } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import {
  hrmsDb,
  employeeName,
  type AttendanceRow,
  type Department,
  type Employee,
  type EmployeePrivate,
  type EmployeeSalary,
  type LeaveRequest,
  type OfficeLocation,
  type SalarySlipRow,
} from "@/lib/hrms";
import { istParts } from "@/lib/attendance-rules";
import {
  buildEmployeeMonth,
  fetchAttendance,
  fetchHolidays,
  fetchHrSettings,
  fetchLeaves,
  leavePolicyOf,
  monthRange,
} from "@/lib/attendance-queries";
import {
  computeSlip,
  fixedGross,
  lopDays,
  type SalarySlip,
  type SalaryStructure,
  type SlipAdjustments,
} from "@/lib/payroll";
import { monthLabel, openSalarySlip, type SlipSnapshot } from "@/lib/salary-slip-html";
import { MonthNav } from "@/components/hrms/attendance-month";
import { GlassTabs } from "@/components/hrms/glass-tabs";

export const Route = createFileRoute("/_authenticated/hrms/salary")({
  head: () => ({ meta: [{ title: "Salary — EaseMyOffice CRM" }] }),
  // Admin guard lives on the /hrms layout route; RLS makes both salary tables
  // admin-only for reads as well.
  component: SalaryPage,
});

const INACTIVE = new Set(["resigned", "terminated"]);
const n = (v: unknown) => Number(v ?? 0) || 0;

const toStructure = (s: EmployeeSalary | undefined): SalaryStructure | null =>
  s
    ? {
        basic: n(s.basic),
        hra: n(s.hra),
        conveyance: n(s.conveyance),
        medical: n(s.medical),
        special_allowance: n(s.special_allowance),
        other_allowance: n(s.other_allowance),
        pf_enabled: s.pf_enabled,
        esi_enabled: s.esi_enabled,
        professional_tax: n(s.professional_tax),
        tds: n(s.tds),
      }
    : null;

const toAdjustments = (r: SalarySlipRow | undefined): SlipAdjustments => ({
  incentive: n(r?.incentive),
  bonus: n(r?.bonus),
  other_earnings: n(r?.other_earnings),
  advance_recovery: n(r?.advance_recovery),
  other_deductions: n(r?.other_deductions),
  tds_override: r?.tds_override == null ? null : n(r.tds_override),
});

function useLookups() {
  const employees = useQuery({
    queryKey: ["hrms-employees-lite"],
    queryFn: async (): Promise<Employee[]> => {
      const { data } = await hrmsDb().from("employees").select("*").order("first_name");
      return data ?? [];
    },
  });
  const salaries = useQuery({
    queryKey: ["hrms-salaries"],
    queryFn: async (): Promise<EmployeeSalary[]> => {
      const { data, error } = await hrmsDb().from("employee_salary").select("*");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  return { employees: employees.data ?? [], salaries: salaries.data ?? [] };
}

function SalaryPage() {
  const [tab, setTab] = useState<"slips" | "structure">("slips");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Wallet className="h-5 w-5 text-primary" /> Salary
          </h2>
          <p className="text-sm text-muted-foreground">
            Admin only — employees cannot see any salary figure. Paid days come straight from
            attendance and leave.
          </p>
        </div>
        <GlassTabs
          ariaLabel="Salary view"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "slips", label: "Salary slips" },
            { id: "structure", label: "Salary structure" },
          ]}
        />
      </div>
      {tab === "slips" ? <SlipsView /> : <StructureView />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Salary structure
// ---------------------------------------------------------------------------

const STRUCTURE_FIELDS: { key: keyof SalaryStructure; label: string }[] = [
  { key: "basic", label: "Basic" },
  { key: "hra", label: "HRA" },
  { key: "conveyance", label: "Conveyance" },
  { key: "medical", label: "Medical" },
  { key: "special_allowance", label: "Special" },
  { key: "other_allowance", label: "Other" },
];

function StructureView() {
  const { employees, salaries } = useLookups();
  const [editing, setEditing] = useState<Employee | null>(null);
  const byEmp = new Map(salaries.map((s) => [s.employee_id, s]));
  const list = employees.filter((e) => !INACTIVE.has(e.employment_status) || byEmp.has(e.id));

  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              {STRUCTURE_FIELDS.map((f) => (
                <TableHead key={f.key} className="text-right">
                  {f.label}
                </TableHead>
              ))}
              <TableHead className="text-right">Gross / month</TableHead>
              <TableHead className="text-right">PF</TableHead>
              <TableHead className="text-right">ESI</TableHead>
              <TableHead className="text-right">PT</TableHead>
              <TableHead className="text-right">TDS</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.length === 0 && (
              <TableRow>
                <TableCell colSpan={13} className="py-8 text-center text-sm text-muted-foreground">
                  Add employees first.
                </TableCell>
              </TableRow>
            )}
            {list.map((e) => {
              const s = toStructure(byEmp.get(e.id));
              return (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">
                    {employeeName(e)}
                    <div className="text-xs text-muted-foreground">{e.employee_code}</div>
                  </TableCell>
                  {STRUCTURE_FIELDS.map((f) => (
                    <TableCell key={f.key} className="text-right tabular-nums">
                      {s ? formatINR(Number(s[f.key])) : "—"}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-semibold tabular-nums">
                    {s ? formatINR(fixedGross(s)) : "—"}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {s?.pf_enabled ? "Yes" : "—"}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {s?.esi_enabled ? "Yes" : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s ? formatINR(s.professional_tax) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s ? formatINR(s.tds) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setEditing(e)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" /> {s ? "Edit" : "Set salary"}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
      <StructureDialog
        employee={editing}
        current={editing ? byEmp.get(editing.id) : undefined}
        onClose={() => setEditing(null)}
      />
    </Card>
  );
}

function StructureDialog({
  employee,
  current,
  onClose,
}: {
  employee: Employee | null;
  current: EmployeeSalary | undefined;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState<Record<string, string>>({});
  const [pf, setPf] = useState(false);
  const [esi, setEsi] = useState(false);

  useEffect(() => {
    if (!employee) return;
    const s = toStructure(current);
    setF({
      basic: String(s?.basic ?? ""),
      hra: String(s?.hra ?? ""),
      conveyance: String(s?.conveyance ?? ""),
      medical: String(s?.medical ?? ""),
      special_allowance: String(s?.special_allowance ?? ""),
      other_allowance: String(s?.other_allowance ?? ""),
      professional_tax: String(s?.professional_tax ?? "0"),
      tds: String(s?.tds ?? "0"),
      effective_from: current?.effective_from ?? "",
      notes: current?.notes ?? "",
    });
    setPf(s?.pf_enabled ?? false);
    setEsi(s?.esi_enabled ?? false);
  }, [employee, current]);

  const preview: SalaryStructure = {
    basic: n(f.basic),
    hra: n(f.hra),
    conveyance: n(f.conveyance),
    medical: n(f.medical),
    special_allowance: n(f.special_allowance),
    other_allowance: n(f.other_allowance),
    pf_enabled: pf,
    esi_enabled: esi,
    professional_tax: n(f.professional_tax),
    tds: n(f.tds),
  };
  const full = computeSlip({ structure: preview, daysInMonth: 30, lopDays: 0 });

  const save = useMutation({
    mutationFn: async () => {
      if (!employee) return;
      const { error } = await hrmsDb()
        .from("employee_salary")
        .upsert({
          employee_id: employee.id,
          ...preview,
          effective_from: f.effective_from || null,
          notes: f.notes || null,
        });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Salary structure saved");
      qc.invalidateQueries({ queryKey: ["hrms-salaries"] });
      onClose();
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  const field = (key: string, label: string) => (
    <div key={key}>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min={0}
        inputMode="decimal"
        value={f[key] ?? ""}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <Dialog open={!!employee} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Salary structure — {employee ? employeeName(employee) : ""}</DialogTitle>
          <DialogDescription>Monthly amounts at full attendance.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {field("basic", "Basic")}
            {field("hra", "House Rent Allowance")}
            {field("conveyance", "Conveyance")}
            {field("medical", "Medical")}
            {field("special_allowance", "Special Allowance")}
            {field("other_allowance", "Other Allowance")}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {field("professional_tax", "Professional Tax / month")}
            {field("tds", "TDS / month")}
            <div>
              <Label className="text-xs">Effective from</Label>
              <Input
                type="date"
                value={f.effective_from ?? ""}
                onChange={(e) => setF({ ...f, effective_from: e.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox checked={pf} onCheckedChange={(v) => setPf(v === true)} />
              PF (12% of basic, capped at ₹15,000)
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={esi} onCheckedChange={(v) => setEsi(v === true)} />
              ESI (0.75%, gross ≤ ₹21,000)
            </label>
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea
              rows={2}
              value={f.notes ?? ""}
              onChange={(e) => setF({ ...f, notes: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-3 text-sm">
            <div>
              <div className="text-[11px] text-muted-foreground">Gross / month</div>
              <div className="font-semibold tabular-nums">{formatINR(full.grossEarnings)}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Deductions</div>
              <div className="font-semibold tabular-nums">{formatINR(full.totalDeductions)}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Net at full attendance</div>
              <div className="font-semibold tabular-nums text-emerald-600">
                {formatINR(full.netPay)}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Monthly salary slips
// ---------------------------------------------------------------------------

type SlipRowView = {
  employee: Employee;
  structure: SalaryStructure | null;
  row: SalarySlipRow | undefined;
  slip: SalarySlip | null;
  snapshot: SlipSnapshot | null;
  warnings: string[];
};

function defaultMonth(today: string) {
  // In the first ten days of a month the admin is closing the previous one.
  const [y, m, d] = today.split("-").map(Number);
  if (d > 10) return { year: y, month: m };
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
}

function SlipsView() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const today = istParts(new Date()).date;
  const [ym, setYm] = useState(() => defaultMonth(today));
  const [adjusting, setAdjusting] = useState<SlipRowView | null>(null);
  const { from, to } = monthRange(ym.year, ym.month);
  const monthKey = from.slice(0, 7);

  const { employees, salaries } = useLookups();
  const { data: settings } = useQuery({ queryKey: ["hrms-settings"], queryFn: fetchHrSettings });
  const policyStart = leavePolicyOf(settings).policyStart;
  const since = policyStart < from ? policyStart : from;
  const { data: holidays = [] } = useQuery({
    queryKey: ["hrms-holidays-range", since, to],
    queryFn: () => fetchHolidays(since, to),
  });
  const { data: attendance = [] } = useQuery({
    queryKey: ["hrms-attendance-month", from],
    queryFn: () => fetchAttendance(from, to),
  });
  const { data: leaves = [] } = useQuery({
    queryKey: ["hrms-leaves-since", since, to],
    queryFn: () => fetchLeaves({ since, until: to }),
  });
  const { data: slipRows = [] } = useQuery({
    queryKey: ["hrms-salary-slips", from],
    queryFn: async (): Promise<SalarySlipRow[]> => {
      const { data, error } = await hrmsDb().from("salary_slips").select("*").eq("month", from);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const { data: privates = [] } = useQuery({
    queryKey: ["hrms-employee-private"],
    queryFn: async (): Promise<EmployeePrivate[]> => {
      const { data } = await hrmsDb().from("employee_private").select("*");
      return data ?? [];
    },
  });
  const { data: departments = [] } = useQuery({
    queryKey: ["hrms-departments"],
    queryFn: async (): Promise<Department[]> => {
      const { data } = await hrmsDb().from("departments").select("*").order("name");
      return data ?? [];
    },
  });
  const { data: offices = [] } = useQuery({
    queryKey: ["hrms-offices"],
    queryFn: async (): Promise<OfficeLocation[]> => {
      const { data } = await hrmsDb().from("office_locations").select("*").order("name");
      return data ?? [];
    },
  });

  const rows: SlipRowView[] = useMemo(() => {
    const group = <T extends { employee_id: string }>(list: T[]) => {
      const m = new Map<string, T[]>();
      for (const x of list) m.set(x.employee_id, [...(m.get(x.employee_id) ?? []), x]);
      return m;
    };
    const att = group(attendance as AttendanceRow[]);
    const lv = group(leaves as LeaveRequest[]);
    const sal = new Map(salaries.map((s) => [s.employee_id, s]));
    const slips = new Map(slipRows.map((r) => [r.employee_id, r]));
    const priv = new Map(privates.map((p) => [p.employee_id, p]));
    const dept = new Map(departments.map((d) => [d.id, d.name]));
    return employees
      .filter((e) => {
        const joined = !e.joining_date || e.joining_date <= to;
        const notLeft = !e.exit_date || e.exit_date >= from;
        return (joined && notLeft && !INACTIVE.has(e.employment_status)) || slips.has(e.id);
      })
      .map((e) => {
        const row = slips.get(e.id);
        const structure = toStructure(sal.get(e.id));
        if (row?.status === "final" && row.snapshot) {
          const snapshot = row.snapshot as SlipSnapshot;
          return { employee: e, structure, row, slip: snapshot.slip, snapshot, warnings: [] };
        }
        const month = buildEmployeeMonth({
          employee: e,
          year: ym.year,
          month: ym.month,
          today,
          records: att.get(e.id) ?? [],
          holidays,
          settings,
          leaves: lv.get(e.id) ?? [],
        });
        const st = month.stats;
        const warnings = [
          to >= today ? "month not over yet" : null,
          st.actionNeeded ? `${st.actionNeeded} missing logout` : null,
          st.remotePending ? `${st.remotePending} WFH pending` : null,
          st.pendingLeave ? `${st.pendingLeave} leave pending` : null,
          !structure ? "no salary structure" : null,
        ].filter(Boolean) as string[];
        // Days outside employment (before joining / after exit) are unpaid.
        const notEmployed = month.days.filter((d) => d.kind === "not_employed").length;
        const lop = lopDays(st) + notEmployed;
        const slip = structure
          ? computeSlip({
              structure,
              daysInMonth: month.days.length,
              lopDays: lop,
              adjustments: toAdjustments(row),
            })
          : null;
        const p = priv.get(e.id);
        const snapshot: SlipSnapshot | null = slip
          ? {
              slip,
              month: monthKey,
              company: { name: "EaseMyOffice", office: offices[0]?.name ?? null },
              employee: {
                name: employeeName(e),
                code: e.employee_code,
                designation: e.designation,
                department: e.department_id ? (dept.get(e.department_id) ?? null) : null,
                joining_date: e.joining_date,
                pan: p?.pan ?? null,
                uan: p?.uan ?? null,
                esi_number: p?.esi_number ?? null,
                bank_name: p?.bank_name ?? null,
                bank_account_no: p?.bank_account_no ?? null,
                bank_ifsc: p?.bank_ifsc ?? null,
              },
              attendance: {
                present: st.present,
                short: st.short,
                halfDays: st.halfDays,
                absent: st.absent,
                paidLeave: st.paidLeave,
                unpaidLeave: st.unpaidLeave,
                remoteDays: st.remoteDays,
                workedMinutes: st.workedMinutes,
                requiredMinutes: st.requiredMinutes,
              },
              note: row?.note ?? null,
              generated_at: new Date().toISOString(),
            }
          : null;
        return { employee: e, structure, row, slip, snapshot, warnings };
      });
  }, [
    employees,
    salaries,
    slipRows,
    attendance,
    leaves,
    holidays,
    settings,
    privates,
    departments,
    offices,
    ym,
    today,
    from,
    to,
    monthKey,
  ]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["hrms-salary-slips", from] });

  const finalize = useMutation({
    mutationFn: async (list: SlipRowView[]) => {
      for (const r of list) {
        if (!r.snapshot || r.row?.status === "final") continue;
        const { error } = await hrmsDb()
          .from("salary_slips")
          .upsert(
            {
              employee_id: r.employee.id,
              month: from,
              ...(r.row ? {} : toAdjustments(undefined)),
              status: "final",
              snapshot: r.snapshot,
              net_pay: r.snapshot.slip.netPay,
              finalized_at: new Date().toISOString(),
              finalized_by: user?.id ?? null,
            },
            { onConflict: "employee_id,month" },
          );
        if (error) throw new Error(`${employeeName(r.employee)}: ${error.message}`);
      }
    },
    onSuccess: () => {
      toast.success("Salary slip(s) finalised and locked");
      refresh();
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  const reopen = useMutation({
    mutationFn: async (r: SlipRowView) => {
      const { error } = await hrmsDb()
        .from("salary_slips")
        .update({ status: "draft" })
        .eq("id", r.row!.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Slip reopened as draft");
      refresh();
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  const drafts = rows.filter((r) => r.slip && r.row?.status !== "final");
  const totals = rows.reduce(
    (t, r) => ({
      gross: t.gross + (r.slip?.grossEarnings ?? 0),
      ded: t.ded + (r.slip?.totalDeductions ?? 0),
      net: t.net + (r.slip?.netPay ?? 0),
    }),
    { gross: 0, ded: 0, net: 0 },
  );
  const fmtDays = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

  return (
    <Card>
      <CardContent className="space-y-3 p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <MonthNav
            year={ym.year}
            month={ym.month}
            onChange={(year, month) => setYm({ year, month })}
            maxYearMonth={today.slice(0, 7)}
          />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              Net payout{" "}
              <strong className="tabular-nums text-foreground">{formatINR(totals.net)}</strong>
            </span>
            <Button
              size="sm"
              disabled={finalize.isPending || drafts.length === 0}
              onClick={() => {
                const warned = drafts.filter((d) => d.warnings.length);
                if (
                  warned.length &&
                  !window.confirm(
                    `${warned.length} slip(s) have open items (missing logout, pending WFH/leave, month not over). Finalise anyway?`,
                  )
                )
                  return;
                finalize.mutate(drafts);
              }}
            >
              <Lock className="mr-1 h-3.5 w-3.5" /> Finalise all ({drafts.length})
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead className="text-right">LOP</TableHead>
                <TableHead className="text-right">Paid days</TableHead>
                <TableHead className="text-right">Fixed gross</TableHead>
                <TableHead className="text-right">Basic</TableHead>
                <TableHead className="text-right">HRA</TableHead>
                <TableHead className="text-right">Allowances</TableHead>
                <TableHead className="text-right">Incentive / bonus</TableHead>
                <TableHead className="text-right">Gross earned</TableHead>
                <TableHead className="text-right">PF</TableHead>
                <TableHead className="text-right">ESI</TableHead>
                <TableHead className="text-right">PT</TableHead>
                <TableHead className="text-right">TDS</TableHead>
                <TableHead className="text-right">Other ded.</TableHead>
                <TableHead className="text-right">Net pay</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={18}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    No employees for {monthLabel(monthKey)}.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => {
                const s = r.slip;
                const amt = (key: string, list: "earnings" | "deductions") =>
                  s ? (s[list].find((l) => l.key === key)?.amount ?? 0) : 0;
                const allowances =
                  amt("conveyance", "earnings") +
                  amt("medical", "earnings") +
                  amt("special_allowance", "earnings") +
                  amt("other_allowance", "earnings");
                const variable =
                  amt("incentive", "earnings") +
                  amt("bonus", "earnings") +
                  amt("other_earnings", "earnings");
                const otherDed =
                  amt("advance_recovery", "deductions") + amt("other_deductions", "deductions");
                const final = r.row?.status === "final";
                return (
                  <TableRow key={r.employee.id}>
                    <TableCell className="font-medium">
                      {employeeName(r.employee)}
                      {r.warnings.length > 0 && (
                        <div className="flex items-center gap-1 text-[11px] text-amber-600">
                          <AlertTriangle className="h-3 w-3" /> {r.warnings.join(" · ")}
                        </div>
                      )}
                    </TableCell>
                    {s ? (
                      <>
                        <TableCell className="text-right tabular-nums">{s.daysInMonth}</TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            s.lopDays > 0 && "text-rose-600",
                          )}
                        >
                          {fmtDays(s.lopDays)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtDays(s.paidDays)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatINR(s.fixedGross)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatINR(amt("basic", "earnings"))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatINR(amt("hra", "earnings"))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatINR(allowances)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatINR(variable)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatINR(s.grossEarnings)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatINR(amt("pf", "deductions"))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatINR(amt("esi", "deductions"))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatINR(amt("professional_tax", "deductions"))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatINR(amt("tds", "deductions"))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatINR(otherDed)}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums text-emerald-600">
                          {formatINR(s.netPay)}
                        </TableCell>
                      </>
                    ) : (
                      <TableCell colSpan={15} className="text-sm text-muted-foreground">
                        Set a salary structure first (Salary structure tab).
                      </TableCell>
                    )}
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                          final
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {final && <Lock className="h-3 w-3" />}
                        {final ? "Final" : "Draft"}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <div className="inline-flex gap-1">
                        {!final && s && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            title="Incentive, bonus & deductions"
                            onClick={() => setAdjusting(r)}
                          >
                            <IndianRupee className="h-4 w-4" />
                          </Button>
                        )}
                        {r.snapshot && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            title="View / print slip"
                            onClick={() => {
                              try {
                                openSalarySlip(r.snapshot!);
                              } catch (e) {
                                toast.error(getErrorMessage(e));
                              }
                            }}
                          >
                            <Printer className="h-4 w-4" />
                          </Button>
                        )}
                        {!final && r.snapshot && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            title="Finalise & lock"
                            disabled={finalize.isPending}
                            onClick={() => {
                              if (
                                r.warnings.length &&
                                !window.confirm(
                                  `Open items: ${r.warnings.join(", ")}. Finalise anyway?`,
                                )
                              )
                                return;
                              finalize.mutate([r]);
                            }}
                          >
                            <Lock className="h-4 w-4" />
                          </Button>
                        )}
                        {final && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            title="Reopen as draft"
                            disabled={reopen.isPending}
                            onClick={() => {
                              if (window.confirm("Reopen this finalised slip for editing?"))
                                reopen.mutate(r);
                            }}
                          >
                            <LockOpen className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-start gap-2 px-4 pb-4 text-[11px] text-muted-foreground">
          <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          LOP = absent days (incl. rejected WFH) + ½ per half day + unpaid leave + days before
          joining / after exit. Week-offs and holidays are paid; &quot;left early&quot; days are not
          deducted. Finalising freezes the slip; later attendance or salary edits don&apos;t change
          it until it is reopened.
        </div>
      </CardContent>
      <AdjustDialog
        view={adjusting}
        month={from}
        onClose={() => setAdjusting(null)}
        onSaved={refresh}
      />
    </Card>
  );
}

function AdjustDialog({
  view,
  month,
  onClose,
  onSaved,
}: {
  view: SlipRowView | null;
  month: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!view) return;
    const a = toAdjustments(view.row);
    setF({
      incentive: String(a.incentive || ""),
      bonus: String(a.bonus || ""),
      other_earnings: String(a.other_earnings || ""),
      advance_recovery: String(a.advance_recovery || ""),
      other_deductions: String(a.other_deductions || ""),
      tds_override: a.tds_override == null ? "" : String(a.tds_override),
      note: view.row?.note ?? "",
    });
  }, [view]);

  const save = useMutation({
    mutationFn: async () => {
      if (!view) return;
      const { error } = await hrmsDb()
        .from("salary_slips")
        .upsert(
          {
            employee_id: view.employee.id,
            month,
            status: "draft",
            incentive: n(f.incentive),
            bonus: n(f.bonus),
            other_earnings: n(f.other_earnings),
            advance_recovery: n(f.advance_recovery),
            other_deductions: n(f.other_deductions),
            tds_override: f.tds_override === "" ? null : n(f.tds_override),
            note: f.note || null,
          },
          { onConflict: "employee_id,month" },
        );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Adjustments saved");
      onSaved();
      onClose();
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  const field = (key: string, label: string, placeholder?: string) => (
    <div key={key}>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min={0}
        placeholder={placeholder}
        value={f[key] ?? ""}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <Dialog open={!!view} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {view ? employeeName(view.employee) : ""} — {monthLabel(month.slice(0, 7))}
          </DialogTitle>
          <DialogDescription>This month only. Leave blank for zero.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {field("incentive", "Incentive")}
          {field("bonus", "Bonus")}
          {field("other_earnings", "Other earnings")}
          {field("advance_recovery", "Advance recovery")}
          {field("other_deductions", "Other deductions")}
          {field(
            "tds_override",
            "TDS this month",
            view?.structure ? `default ${view.structure.tds}` : undefined,
          )}
          <div className="col-span-2">
            <Label className="text-xs">Note on slip</Label>
            <Textarea
              rows={2}
              value={f.note ?? ""}
              onChange={(e) => setF({ ...f, note: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
