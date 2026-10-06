// Admin command-center dashboard body (spec section 23).
//
// Heavy by design — it loads a cross-module dataset (Sales, B2B, Renewals,
// Documentation, Attendance, Payroll) and renders seven grouped KPI blocks — so
// it lives here in src/components/dashboard and is lazy-loaded from the
// dashboard route only for admins. That keeps it (and the command-center query
// module) out of the entry chunk and off every non-admin's dashboard.
//
// Every number comes from the pure, tested maths in src/lib/command-center.ts
// and src/lib/b2b-analytics.ts; this component only fetches via
// commandCenterQuery and renders. KPI tiles that drill down pass a TanStack
// Router `to` + `search` so clicking one opens the underlying filtered list.

import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Building2,
  Handshake,
  Share2,
  BookOpen,
  IndianRupee,
  TrendingUp,
  Target,
  GitBranch,
  Phone,
  CalendarCheck,
  RefreshCcw,
  Clock,
  AlertTriangle,
  CheckCircle2,
  FileText,
  UserCheck,
  UserX,
  CalendarClock,
  Wallet,
  Trophy,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiTile } from "@/components/dashboard/widgets/kpi-tile";
import { formatINR } from "@/lib/utils";
import { commandCenterQuery } from "@/lib/command-center-queries";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {children}
      </div>
    </section>
  );
}

/** A revenue / money tile — KpiTile only animates integers, so money gets its
 * own tile (mirrors the B2B dashboard's RevenueTile rationale). */
function MoneyTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | undefined;
  icon: typeof IndianRupee;
}) {
  return (
    <div className="surface-card relative flex h-full flex-col justify-between overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-success/15 to-transparent" />
      <div className="relative flex items-start justify-between gap-2">
        <div className="text-[11px] font-medium uppercase leading-tight tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-success/20 bg-success/10 p-1.5 text-success">
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="relative mt-3">
        <div className="text-2xl font-semibold leading-none tabular-nums">
          {value === undefined ? "—" : formatINR(value)}
        </div>
        <div className="mt-1 min-h-4 text-[11px] text-muted-foreground" />
      </div>
    </div>
  );
}

export function AdminCommandCenter() {
  const { data, isLoading } = useQuery(commandCenterQuery());
  const v = <T,>(x: T): T | undefined => (isLoading ? undefined : x);

  const bo = data?.businessOverview;
  const sales = data?.sales;
  const b2b = data?.b2b;
  const ren = data?.renewals;
  const doc = data?.documentation;
  const att = data?.attendance;
  const pay = data?.payroll;

  return (
    <div className="space-y-7">
      <header className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
          <GitBranch className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Command Center</h1>
          <p className="text-sm text-muted-foreground">
            Cross-module KPIs across Sales, B2B, Renewals, Documentation and HR. Click any tile to
            drill into the records behind it.
          </p>
        </div>
      </header>

      {/* Business Overview */}
      <Section title="Business Overview">
        <KpiTile
          label="Total Sales Leads"
          value={v(bo?.totalSalesLeads ?? 0)}
          icon={Users}
          to="/leads"
        />
        <KpiTile
          label="Total B2B Prospects"
          value={v(bo?.totalB2BProspects ?? 0)}
          icon={Building2}
          accent="info"
          to="/b2b/leads"
        />
        <KpiTile
          label="Active CA Partners"
          value={v(bo?.activeCaPartners ?? 0)}
          icon={Handshake}
          accent="success"
          to="/b2b/partners"
          search={{ status: "active" }}
        />
        <KpiTile
          label="Total Referrals"
          value={v(bo?.totalReferrals ?? 0)}
          icon={Share2}
          accent="info"
          to="/b2b/referrals"
        />
        <KpiTile
          label="Total Bookings"
          value={v(bo?.totalBookings ?? 0)}
          icon={BookOpen}
          accent="primary"
          to="/bookings"
        />
        <MoneyTile label="Total Revenue" value={v(bo?.totalRevenue ?? 0)} icon={IndianRupee} />
      </Section>

      {/* Sales Performance */}
      <Section title="Sales Performance">
        <KpiTile label="Leads" value={v(sales?.totalLeads ?? 0)} icon={Users} to="/leads" />
        <KpiTile
          label="Closures"
          value={v(sales?.closures ?? 0)}
          icon={Target}
          accent="success"
          to="/leads"
          search={{ stage: "completed" }}
        />
        <KpiTile
          label="Conversion %"
          value={v(sales?.conversion ?? 0)}
          icon={TrendingUp}
          accent="info"
        />
        <KpiTile
          label="Open Pipeline"
          value={v(sales?.pipelineOpen ?? 0)}
          icon={GitBranch}
          accent="warning"
          to="/pipeline"
        />
        <KpiTile
          label="Bookings"
          value={v(sales?.totalBookings ?? 0)}
          icon={BookOpen}
          to="/bookings"
        />
        <MoneyTile label="Revenue" value={v(sales?.totalRevenue ?? 0)} icon={IndianRupee} />
      </Section>

      {/* B2B Performance */}
      <Section title="B2B Performance">
        <KpiTile
          label="Prospects"
          value={v(b2b?.prospects ?? 0)}
          icon={Building2}
          to="/b2b/leads"
        />
        <KpiTile
          label="Contact Rate %"
          value={v(b2b?.contactRate ?? 0)}
          icon={Phone}
          accent="info"
        />
        <KpiTile
          label="Meetings"
          value={v(b2b?.meetings ?? 0)}
          icon={CalendarCheck}
          to="/b2b/activities/meetings"
        />
        <KpiTile
          label="Partners"
          value={v(b2b?.activePartners ?? 0)}
          icon={Handshake}
          accent="success"
          to="/b2b/partners"
          search={{ status: "active" }}
        />
        <KpiTile
          label="Referrals"
          value={v(b2b?.referrals ?? 0)}
          icon={Share2}
          accent="info"
          to="/b2b/referrals"
        />
        <KpiTile
          label="B2B Bookings"
          value={v(b2b?.b2bBookings ?? 0)}
          icon={BookOpen}
          accent="success"
          to="/bookings"
          search={{ source: "b2b" }}
        />
        <MoneyTile label="B2B Revenue" value={v(b2b?.b2bRevenue ?? 0)} icon={IndianRupee} />
        <KpiTile
          label="Overdue Follow-ups"
          value={v(b2b?.overdueFollowups ?? 0)}
          icon={AlertTriangle}
          accent="destructive"
          to="/b2b/activities/followups"
          search={{ bucket: "overdue" }}
        />
      </Section>

      {/* Top performers */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-4 w-4 text-amber-500" /> Top B2B Employees
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!b2b || b2b.topEmployees.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <ol className="space-y-2">
                {b2b.topEmployees.map((e, i) => (
                  <li
                    key={e.employeeId}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="truncate">
                      <span className="mr-2 text-muted-foreground">{i + 1}.</span>
                      {e.employeeId.slice(0, 8)}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {e.referrals} refs · {formatINR(e.revenue)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Handshake className="h-4 w-4 text-emerald-500" /> Top CA Partners
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!b2b || b2b.topPartners.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No partners yet.</p>
            ) : (
              <ol className="space-y-2">
                {b2b.topPartners.map((p, i) => (
                  <li key={p.firmId} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">
                      <span className="mr-2 text-muted-foreground">{i + 1}.</span>
                      {p.firmName}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {p.referrals} refs · {formatINR(p.revenue)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Renewals */}
      <Section title="Renewals">
        <KpiTile
          label="Due"
          value={v(ren?.due ?? 0)}
          icon={CalendarClock}
          accent="warning"
          to="/renewals"
        />
        <KpiTile
          label="Pending"
          value={v(ren?.pending ?? 0)}
          icon={Clock}
          accent="info"
          to="/renewals"
        />
        <KpiTile
          label="Completed"
          value={v(ren?.completed ?? 0)}
          icon={CheckCircle2}
          accent="success"
          to="/renewals"
        />
        <KpiTile
          label="Dormant"
          value={v(ren?.dormant ?? 0)}
          icon={AlertTriangle}
          accent="destructive"
          to="/renewals"
        />
      </Section>

      {/* Documentation */}
      <Section title="Documentation">
        <KpiTile
          label="Pending"
          value={v(doc?.pending ?? 0)}
          icon={FileText}
          accent="warning"
          to="/documentation"
        />
        <KpiTile
          label="Delayed"
          value={v(doc?.delayed ?? 0)}
          icon={AlertTriangle}
          accent="destructive"
          to="/documentation"
        />
        <KpiTile
          label="Completed"
          value={v(doc?.completed ?? 0)}
          icon={CheckCircle2}
          accent="success"
          to="/documentation"
        />
        <KpiTile
          label="TAT Breaches"
          value={v(doc?.tatBreaches ?? 0)}
          icon={Clock}
          accent="destructive"
          to="/documentation"
        />
      </Section>

      {/* Attendance (today) */}
      <Section title="Attendance (Today)">
        <KpiTile
          label="Present"
          value={v(att?.present ?? 0)}
          icon={UserCheck}
          accent="success"
          to="/hrms"
        />
        <KpiTile
          label="Absent"
          value={v(att?.absent ?? 0)}
          icon={UserX}
          accent="destructive"
          to="/hrms"
        />
        <KpiTile label="Late" value={v(att?.late ?? 0)} icon={Clock} accent="warning" to="/hrms" />
        <KpiTile
          label="On Leave"
          value={v(att?.onLeave ?? 0)}
          icon={CalendarClock}
          accent="info"
          to="/hrms"
        />
        <KpiTile
          label="Missing Checkout"
          value={v(att?.missingCheckout ?? 0)}
          icon={AlertTriangle}
          accent="warning"
          to="/hrms"
        />
        <KpiTile
          label="Working Hours"
          value={v(att ? Math.round(att.workingHours) : 0)}
          icon={Clock}
          accent="primary"
          hint={att ? `${att.workingHours.toFixed(1)} h total` : undefined}
        />
      </Section>

      {/* Payroll (this month) */}
      <Section title="Payroll (This Month)">
        <KpiTile
          label="Pending"
          value={v(pay?.pending ?? 0)}
          icon={Clock}
          accent="warning"
          to="/hrms"
        />
        <KpiTile
          label="Processed"
          value={v(pay?.processed ?? 0)}
          icon={CheckCircle2}
          accent="success"
          to="/hrms"
        />
        <MoneyTile label="Total Cost" value={v(pay?.totalCost ?? 0)} icon={Wallet} />
        <KpiTile
          label="LOP Days"
          value={v(pay ? Math.round(pay.totalLop) : 0)}
          icon={AlertTriangle}
          accent="destructive"
          hint={pay ? `${pay.totalLop.toFixed(1)} days` : undefined}
        />
      </Section>

      {pay && pay.byDepartment.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Payroll by Department</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 text-left">Department</th>
                    <th className="text-right">Employees</th>
                    <th className="text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pay.byDepartment.map((d) => (
                    <tr key={d.department} className="hover:bg-muted/30">
                      <td className="py-2 font-medium">{d.department}</td>
                      <td className="text-right tabular-nums">{d.count}</td>
                      <td className="text-right tabular-nums">{formatINR(d.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
