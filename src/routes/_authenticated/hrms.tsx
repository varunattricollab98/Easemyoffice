import { Link, Outlet, createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { hrmsDb } from "@/lib/hrms";
import { supabase } from "@/integrations/supabase/client";
import { GLASS_TRACK, glassTabClass } from "@/components/hrms/glass-tab-styles";

// One admin hub for everything HR. There is no separate HR person — the admin
// runs employees, attendance and office rules — so these live together behind a
// single sidebar entry instead of three.
export const Route = createFileRoute("/_authenticated/hrms")({
  // Guards every child route. RLS remains the real boundary.
  beforeLoad: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/login" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
    if (!((roles ?? []) as { role: string }[]).some((r) => r.role === "admin")) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: HrmsLayout,
});

const SECTIONS = [
  { to: "/hrms/attendance", label: "Attendance" },
  { to: "/hrms/approvals", label: "Approvals" },
  { to: "/hrms/employees", label: "Employees" },
  { to: "/hrms/settings", label: "Office & Hours" },
] as const;

function HrmsLayout() {
  const { pathname } = useLocation();
  // Pending WFH + leave requests, shown on the Approvals tab.
  const { data: pending = 0 } = useQuery({
    queryKey: ["hrms-approval-counts"],
    refetchInterval: 60_000,
    queryFn: async (): Promise<number> => {
      const [a, b] = await Promise.all([
        hrmsDb()
          .from("attendance")
          .select("id", { count: "exact", head: true })
          .eq("remote_status", "pending"),
        hrmsDb()
          .from("leave_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
      ]);
      return (a.count ?? 0) + (b.count ?? 0);
    },
  });
  return (
    <div className="mx-auto max-w-7xl space-y-5 p-5 md:p-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold md:text-3xl">
            <ShieldCheck className="h-6 w-6 text-primary" /> Staff &amp; Attendance
          </h1>
          <p className="text-sm text-muted-foreground">
            Admin only — employees, attendance, office location and working hours in one place.
          </p>
        </div>
        <nav className={GLASS_TRACK} aria-label="Staff and attendance sections">
          {SECTIONS.map((s) => {
            const active = pathname === s.to || pathname.startsWith(`${s.to}/`);
            return (
              <Link
                key={s.to}
                to={s.to}
                aria-current={active ? "page" : undefined}
                className={glassTabClass(active)}
              >
                {s.label}
                {s.to === "/hrms/approvals" && pending > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[11px] tabular-nums",
                      "bg-rose-500/15 text-rose-600 ring-1 ring-rose-500/20 dark:text-rose-300",
                    )}
                  >
                    {pending}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
