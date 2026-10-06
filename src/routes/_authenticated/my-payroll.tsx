// My Payroll — the employee-facing payroll-readiness summary.
//
// SALARY ISOLATION (hard requirement): this page NEVER reads salary figures.
// It derives working days / present / half-days / absent / paid & unpaid leave
// / LOP / hours / overtime and the current month's payroll status STRICTLY from
// the signed-in user's OWN attendance and leave, exactly like the My Attendance
// page. The salary tables (public.salary_slips, public.employee_salary) are
// admin-only even for reads (migration 20260516000008) and are deliberately NOT
// queried here — an employee's own salary slip is delivered by the admin, per
// the owner's V1 decision.
//
// Tables read (all RLS-scoped to the caller, see migrations 20260516000005 /
// 20260516000006):
//   - public.employees        (own row only: profile_id = auth.uid())
//   - public.hr_settings       (reference, readable by all authenticated)
//   - public.holidays          (reference, readable by all authenticated)
//   - public.attendance        (own rows: employee_id ∈ my employee ids)
//   - public.leave_requests    (own rows: employee_id = my employee id)
// It reads NO salary table and NO other employee's data.
//
// Role-agnostic like /attendance: every employee (including B2B department
// staff) sees their own readiness here. The LOP / paid-days computation reuses
// the pure, tested src/lib/payroll.ts helpers so "payroll days" match the slip
// the admin finalises, without exposing any amount.

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Loader2, Receipt, ShieldAlert, CalendarCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { hrmsDb, type Employee } from "@/lib/hrms";
import { daysInMonth, istParts } from "@/lib/attendance-rules";
import {
  buildEmployeeMonth,
  fetchAttendance,
  fetchHolidays,
  fetchHrSettings,
  fetchLeaves,
  monthRange,
} from "@/lib/attendance-queries";
import { lopDays as computeLopDays } from "@/lib/payroll";
import { MonthStatsGrid, LeaveBalance, MonthNav } from "@/components/hrms/attendance-month";

export const Route = createFileRoute("/_authenticated/my-payroll")({
  head: () => ({ meta: [{ title: "My Payroll — EaseMyOffice CRM" }] }),
  component: MyPayrollPage,
});

function MyPayrollPage() {
  const { user } = useAuth();
  const today = istParts(new Date()).date;
  const [ym, setYm] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
  }));

  const { data: employee, isLoading: loadingEmployee } = useQuery({
    queryKey: ["my-employee", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Employee | null> => {
      const { data } = await hrmsDb()
        .from("employees")
        .select("*")
        .eq("profile_id", user!.id)
        .maybeSingle();
      return data ?? null;
    },
  });

  if (loadingEmployee) {
    return (
      <div className="flex justify-center p-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-5 md:p-10">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold md:text-3xl">
          <Receipt className="h-6 w-6 text-primary" /> My Payroll
        </h1>
        <p className="text-sm text-muted-foreground">
          Your own attendance, leave and loss-of-pay for the month — the days your salary is
          computed on. Salary amounts and slips are shared by the admin.
        </p>
      </div>

      {!employee ? (
        <Card>
          <CardContent className="flex items-start gap-3 p-6 text-sm">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-500" />
            <div>
              <div className="font-medium">Your login is not linked to an employee record yet.</div>
              <div className="text-muted-foreground">
                Ask the admin to add you under Employees and link your CRM login. Your payroll
                readiness appears right after.
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <PayrollMonth
          employee={employee}
          year={ym.year}
          month={ym.month}
          today={today}
          onMonth={(year, month) => setYm({ year, month })}
        />
      )}
    </div>
  );
}

function PayrollMonth({
  employee,
  year,
  month,
  today,
  onMonth,
}: {
  employee: Employee;
  year: number;
  month: number;
  today: string;
  onMonth: (year: number, month: number) => void;
}) {
  const { from, to } = monthRange(year, month);

  const { data: settings } = useQuery({ queryKey: ["hrms-settings"], queryFn: fetchHrSettings });
  const { data: holidays = [] } = useQuery({
    queryKey: ["my-holidays", from],
    queryFn: () => fetchHolidays(from, to),
  });
  // employee.id is the caller's own employee row (RLS already restricts the
  // employees read to profile_id = auth.uid()), so attendance / leave reads are
  // their own data only.
  const { data: rows = [] } = useQuery({
    queryKey: ["my-attendance-month", employee.id, from],
    queryFn: () => fetchAttendance(from, to, employee.id),
  });
  const { data: leaves = [] } = useQuery({
    queryKey: ["my-leaves", employee.id],
    queryFn: () =>
      fetchLeaves({ employeeId: employee.id, since: "2000-01-01", until: "2100-01-01" }),
  });

  const view = useMemo(
    () =>
      buildEmployeeMonth({
        employee,
        year,
        month,
        today,
        records: rows,
        holidays,
        settings,
        leaves,
      }),
    [employee, year, month, today, rows, holidays, settings, leaves],
  );

  // LOP + paid days via the SAME pure helper the salary slip uses, so the days
  // the employee sees match the admin's finalised slip — amounts excluded.
  const dim = daysInMonth(year, month);
  const lop = useMemo(
    () =>
      computeLopDays({
        absent: view.stats.absent,
        halfDays: view.stats.halfDays,
        unpaidLeave: view.stats.unpaidLeave,
      }),
    [view.stats],
  );
  const paidDays = Math.max(0, dim - Math.min(dim, lop));

  const isCurrentMonth = `${year}-${String(month).padStart(2, "0")}` === today.slice(0, 7);
  const statusBadge = isCurrentMonth
    ? { label: "In progress", className: "bg-amber-500/90 text-white hover:bg-amber-500/90" }
    : { label: "Month closed", className: "bg-emerald-500/90 text-white hover:bg-emerald-500/90" };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarCheck className="h-4 w-4" /> Payroll readiness
            <Badge className={statusBadge.className}>{statusBadge.label}</Badge>
          </CardTitle>
          <MonthNav year={year} month={month} onChange={onMonth} maxYearMonth={today.slice(0, 7)} />
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Payroll-day summary derived from own attendance (no salary). */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <PayStat label="Days in month" value={String(dim)} />
            <PayStat
              label="Loss of pay (LOP)"
              value={lop % 1 === 0 ? String(lop) : lop.toFixed(1)}
              tone={lop ? "text-rose-600" : undefined}
              hint="absent + half + unpaid leave"
            />
            <PayStat
              label="Paid days"
              value={paidDays % 1 === 0 ? String(paidDays) : paidDays.toFixed(1)}
              tone="text-emerald-600"
            />
            <PayStat
              label="Payroll status"
              value={statusBadge.label}
              hint={isCurrentMonth ? "finalised after month-end" : "ready for the admin"}
            />
          </div>

          {view.stats.actionNeeded > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              {view.stats.actionNeeded} day(s) have a login without a logout, so their hours are not
              counted. Tell the admin so they can be corrected before month-end.
            </div>
          )}

          {/* Full attendance stat grid (working days, present, hours, etc.). */}
          <MonthStatsGrid stats={view.stats} />

          {/* Leave balance for the month. */}
          <LeaveBalance ledger={view.ledger} pending={view.stats.pendingLeave} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          Salary amounts, allowances and deductions are not shown here. Your salary slip is prepared
          and shared by the admin once the month is finalised.
        </CardContent>
      </Card>
    </>
  );
}

function PayStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
