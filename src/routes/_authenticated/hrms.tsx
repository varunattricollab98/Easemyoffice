import { Link, Outlet, createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
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
  { to: "/hrms/employees", label: "Employees" },
  { to: "/hrms/settings", label: "Office & Hours" },
] as const;

function HrmsLayout() {
  const { pathname } = useLocation();
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
              </Link>
            );
          })}
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
