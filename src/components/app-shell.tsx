import { Link, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard, Users, Kanban, Bell, CheckSquare, FileText, Receipt,
  RefreshCcw, Activity, BarChart3, Settings, UsersRound, LogOut, Building2, UserCog, BookOpen,
  UserCheck, FileSignature, Calendar, FolderOpen, Inbox, TrendingUp, Trophy, Mail, AlarmClock,
} from "lucide-react";
import { useAuth, type AppRole } from "@/lib/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/crm";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// roles: undefined = visible to all authenticated users
type NavItem = { to: string; label: string; icon: typeof Users; roles?: AppRole[] };

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "sales", "bd", "documentation", "accounts"] },
  { to: "/renewals", label: "Dashboard", icon: LayoutDashboard, roles: ["renewals"] },
  { to: "/inbox", label: "Lead Inbox", icon: Mail, roles: ["admin", "sales", "bd"] },
  { to: "/leads", label: "Leads", icon: Users, roles: ["admin", "sales", "bd"] },
  { to: "/pipeline", label: "Pipeline", icon: Kanban, roles: ["admin", "sales", "bd"] },
  { to: "/renewals/leads", label: "Renewal Leads", icon: Users, roles: ["admin", "renewals"] },
  { to: "/renewals/pipeline", label: "Renewal Pipeline", icon: Kanban, roles: ["admin", "renewals"] },
  { to: "/clients", label: "Clients", icon: UserCheck, roles: ["admin", "sales", "bd", "renewals", "accounts"] },
  { to: "/follow-ups", label: "Follow-ups", icon: Bell, roles: ["admin", "sales", "bd", "renewals"] },
  { to: "/reminders", label: "Reminders", icon: AlarmClock, roles: ["admin", "sales", "bd", "renewals", "accounts"] },
  { to: "/calendar", label: "Calendar", icon: Calendar },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/notifications", label: "Notifications", icon: Inbox },
  { to: "/documentation", label: "Documentation", icon: FileText, roles: ["admin", "documentation", "sales"] },
  { to: "/documents", label: "Documents", icon: FolderOpen, roles: ["admin", "documentation", "accounts"] },
  { to: "/bookings", label: "Bookings", icon: BookOpen, roles: ["admin", "sales", "bd", "accounts", "renewals"] },
  { to: "/invoices", label: "Invoices", icon: FileSignature, roles: ["admin", "accounts"] },
  { to: "/payments", label: "Payments", icon: Receipt, roles: ["admin", "accounts", "sales"] },
  { to: "/activity", label: "Activity", icon: Activity, roles: ["admin", "sales", "bd"] },
  { to: "/reports", label: "Reports", icon: BarChart3, roles: ["admin"] },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/admin/analytics", label: "Analytics", icon: TrendingUp, roles: ["admin"] },
  { to: "/admin/sales-performance", label: "Sales Performance", icon: Trophy, roles: ["admin"] },
  { to: "/admin/email-automation", label: "Email Automation", icon: Mail, roles: ["admin"] },
  { to: "/team", label: "Team", icon: UsersRound, roles: ["admin"] },
  { to: "/admin/users", label: "Users", icon: UserCog, roles: ["admin"] },
  { to: "/settings", label: "Settings", icon: Settings },
];

function visibleFor(items: NavItem[], roles: AppRole[], isAdmin: boolean) {
  if (isAdmin) return items;
  return items.filter((i) => !i.roles || i.roles.some((r) => roles.includes(r)));
}

export function AppSidebar() {
  const { profile, isAdmin, signOut, user, roles } = useAuth();
  const loc = useLocation();
  const items = [...visibleFor(NAV, roles, isAdmin), ...visibleFor(ADMIN_NAV, roles, isAdmin)];

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["notif-unread-count"],
    enabled: !!user?.id,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .eq("read", false as never);
      return count ?? 0;
    },
  });

  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="px-5 py-5 border-b flex items-center gap-2">
        <div className="size-9 rounded-lg bg-gradient-to-br from-primary to-primary/70 grid place-items-center text-primary-foreground">
          <Building2 className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="font-semibold leading-tight">EaseMyOffice</div>
          <div className="text-xs text-muted-foreground">Sales CRM</div>
        </div>
        <ThemeToggle />
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {items.map((item) => {
          const active = loc.pathname === item.to || loc.pathname.startsWith(item.to + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              {item.to === "/notifications" && unreadCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-rose-600 text-white text-[11px] font-semibold">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-3 flex items-center gap-3">
        <Avatar className="h-9 w-9">
          <AvatarFallback>{initials(profile?.full_name ?? user?.email)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{profile?.full_name ?? user?.email}</div>
          <div className="text-xs text-muted-foreground truncate">
            {isAdmin ? "Admin" : roles[0] ?? user?.email}
          </div>
        </div>
        <Button size="icon" variant="ghost" onClick={() => signOut()} title="Sign out">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </aside>
  );
}

export function MobileTabBar() {
  const loc = useLocation();
  const { roles, isAdmin } = useAuth();
  const items = visibleFor(NAV, roles, isAdmin).slice(0, 5);
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="grid grid-cols-5">
        {items.map((item) => {
          const active = loc.pathname === item.to || loc.pathname.startsWith(item.to + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2.5 text-[11px]",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
