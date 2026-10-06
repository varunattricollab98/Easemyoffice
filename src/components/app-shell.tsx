import { Link, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard, Users, Kanban, Bell, CheckSquare, FileText, Receipt,
  RefreshCcw, Activity, BarChart3, Settings, UsersRound, LogOut, Building2, BookOpen,
  UserCheck, FileSignature, Calendar, Inbox, Trophy, Mail, AlarmClock, Phone, CalendarCheck, ShieldCheck, Upload, History,
  Handshake,
} from "lucide-react";
import { useAuth, type AppRole } from "@/lib/auth";
import { useGlobalSearch } from "@/lib/global-search-context";
import { Search } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/crm";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { usePwaInstall } from "@/lib/pwa";
import { Download, MoreHorizontal, Share } from "lucide-react";

// roles: undefined = visible to all authenticated users
type NavItem = { to: string; label: string; icon: typeof Users; roles?: AppRole[] };

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/pipeline", label: "Pipeline", icon: Kanban, roles: ["admin", "sales", "bd"] },
  { to: "/inbox", label: "Lead Inbox", icon: Mail, roles: ["admin", "sales", "bd"] },
  { to: "/calls", label: "Calls", icon: Phone, roles: ["admin", "sales", "bd"] },
  { to: "/leads", label: "Leads", icon: Users, roles: ["admin", "sales", "bd"] },
  { to: "/renewals/inbox", label: "Renewal Inbox", icon: Mail, roles: ["admin", "renewals"] },
  { to: "/renewals/leads", label: "Renewal Leads", icon: Users, roles: ["admin", "renewals"] },
  { to: "/renewals/pipeline", label: "Renewal Pipeline", icon: Kanban, roles: ["admin", "renewals"] },
  // "Renewal Bookings" was merged into Bookings, which now carries a
  // Fresh / Renewal filter and the renewal creation form.
  { to: "/clients", label: "Clients", icon: UserCheck, roles: ["admin", "sales", "bd", "renewals", "accounts"] },
  { to: "/follow-ups", label: "Follow-ups", icon: Bell, roles: ["admin", "sales", "bd", "renewals"] },
  { to: "/reminders", label: "Reminders", icon: AlarmClock, roles: ["admin", "sales", "bd", "renewals"] },
  { to: "/calendar", label: "Calendar", icon: Calendar },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
  // Everyone's own LOGIN / LOGOUT. The page explains itself when the login is
  // not linked to an employee record yet.
  { to: "/attendance", label: "My Attendance", icon: CalendarCheck },
  { to: "/notifications", label: "Notifications", icon: Inbox },
  { to: "/documentation", label: "Documentation", icon: FileText, roles: ["admin", "documentation", "sales"] },
  // "Documents" (a per-client KYC/agreement file browser) was removed — it sat
  // next to Documentation, which is the workflow the team actually uses.
  { to: "/bookings", label: "Bookings", icon: BookOpen, roles: ["admin", "sales", "bd", "accounts", "renewals"] },
  { to: "/invoices", label: "Invoices", icon: FileSignature, roles: ["admin", "accounts"] },
  { to: "/payments", label: "Payments", icon: Receipt, roles: ["admin", "accounts", "sales"] },
  { to: "/activity", label: "Activity", icon: Activity, roles: ["admin", "sales", "bd"] },
  { to: "/reports", label: "Reports", icon: BarChart3, roles: ["admin"] },
  // Rep-facing now, not an admin tool: the page scopes itself so a sales user
  // sees their own closures, activity and productivity index. Moved out of
  // ADMIN_NAV so it sits with the day-to-day items rather than after Settings.
  {
    to: "/admin/sales-performance",
    label: "Sales Performance",
    icon: Trophy,
    roles: ["admin", "sales", "bd"],
  },
  // --- B2B department -----------------------------------------------------
  // Scaffold for the new B2B (CA firm partnerships) department. Only the top
  // level "B2B Dashboard" entry exists this phase; the nested nav (accounts,
  // leads, pipeline, referrals, analytics) is added in later phases. Gated to
  // admin + b2b so it stays out of every other role's sidebar; admins still
  // see everything via visibleFor().
  { to: "/b2b", label: "B2B Dashboard", icon: Handshake, roles: ["admin", "b2b"] },
  // Prospecting group — the CA firm accounts, their contacts and the
  // prospecting leads that feed partnerships. Import Leads lands in FEAT-004.
  { to: "/b2b/leads", label: "B2B Leads", icon: Users, roles: ["admin", "b2b"] },
  { to: "/b2b/firms", label: "CA Firms", icon: Building2, roles: ["admin", "b2b"] },
  { to: "/b2b/contacts", label: "Contacts", icon: UserCheck, roles: ["admin", "b2b"] },
  { to: "/b2b/import", label: "Import Leads", icon: Upload, roles: ["admin", "b2b"] },
  { to: "/b2b/import-history", label: "Import History", icon: History, roles: ["admin", "b2b"] },
];

const ADMIN_NAV: NavItem[] = [
  // HRMS — one admin hub (Attendance / Employees / Office & Hours tabs): there
  // is no separate HR person, the admin runs all of it. RLS is the real
  // boundary; this entry just keeps the pages out of a rep's sidebar.
  { to: "/hrms", label: "Staff & Attendance", icon: ShieldCheck, roles: ["admin"] },
  // Analytics and Activity Log were removed: Analytics duplicated Reports and
  // Sales Performance, and Activity Log read the audit trail that Activity
  // already sits next to in the nav. The audit_log table keeps being written,
  // so a viewer can be brought back without any data loss.
  { to: "/admin/email-automation", label: "Email Automation", icon: Mail, roles: ["admin"] },
  // The old read-only /team page was removed and this one took its label: it is
  // the same list plus the role/department editing and user create/delete that
  // /team said was "coming next phase".
  { to: "/admin/users", label: "Team", icon: UsersRound, roles: ["admin"] },
  { to: "/settings", label: "Settings", icon: Settings },
];

/**
 * Unread notifications badge. One shared query for the sidebar and the phone
 * tab bar (both are mounted at once; they used to poll separately, every 15s
 * and 30s). New rows arrive over realtime and invalidate this key, so the
 * interval is only a safety net.
 */
function useUnreadCount(userId: string | undefined) {
  const { data = 0 } = useQuery({
    queryKey: ["notif-unread-count", userId],
    enabled: !!userId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId!)
        .eq("read", false as never);
      return count ?? 0;
    },
  });
  return data;
}

function visibleFor(items: NavItem[], roles: AppRole[], isAdmin: boolean) {
  if (isAdmin) return items;
  return items.filter((i) => !i.roles || i.roles.some((r) => roles.includes(r)));
}

export function AppSidebar() {
  const { profile, isAdmin, signOut, user, roles } = useAuth();
  const loc = useLocation();
  const search = useGlobalSearch();
  const items = [...visibleFor(NAV, roles, isAdmin), ...visibleFor(ADMIN_NAV, roles, isAdmin)];

  const unreadCount = useUnreadCount(user?.id);

  return (
    <aside className="hidden lg:flex sticky top-0 h-screen w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
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

      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={() => search.open()}
          className="flex w-full items-center gap-2 rounded-md border bg-background/50 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="pointer-events-none hidden select-none rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
            ⌘K
          </kbd>
        </button>
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
  const { roles, isAdmin, user, profile, signOut } = useAuth();
  const search = useGlobalSearch();
  const pwa = usePwaInstall();
  const [moreOpen, setMoreOpen] = useState(false);

  // Everything this user may open, in sidebar order.
  const all = useMemo(
    () => [...visibleFor(NAV, roles, isAdmin), ...visibleFor(ADMIN_NAV, roles, isAdmin)],
    [roles, isAdmin],
  );

  // Four direct tabs + "More". Attendance is always a tab: most punches happen
  // on a phone. The work tab depends on the role.
  const tabs = useMemo(() => {
    const isRenewal =
      !isAdmin && roles.includes("renewals") && !roles.includes("sales") && !roles.includes("bd");
    const priority = isRenewal
      ? ["/dashboard", "/attendance", "/renewals/leads", "/follow-ups"]
      : ["/dashboard", "/attendance", "/leads", "/follow-ups", "/tasks", "/notifications"];
    const picked = priority
      .map((to) => all.find((i) => i.to === to))
      .filter(Boolean) as NavItem[];
    for (const i of all) if (picked.length < 4 && !picked.includes(i)) picked.push(i);
    return picked.slice(0, 4);
  }, [all, roles, isAdmin]);
  const rest = all.filter((i) => !tabs.includes(i));

  // Close the sheet whenever the route changes (a link inside it was tapped).
  useEffect(() => setMoreOpen(false), [loc.pathname]);

  const unreadCount = useUnreadCount(user?.id);

  const isActive = (to: string) => loc.pathname === to || loc.pathname.startsWith(to + "/");
  const moreActive = rest.some((i) => isActive(i.to));
  const shortLabel = (label: string) =>
    label.replace("Renewal ", "").replace("Dashboard", "Home").replace("My Attendance", "Attendance");

  const tabClass = (active: boolean) =>
    cn(
      "relative flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors active:scale-95",
      active ? "text-primary" : "text-muted-foreground",
    );

  return (
    <>
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5 max-w-lg mx-auto">
          {tabs.map((item) => {
            const active = isActive(item.to);
            const Icon = item.icon;
            return (
              <Link key={item.to} to={item.to} className={tabClass(active)}>
                <div className="relative">
                  <Icon className={cn("h-5 w-5", active && "scale-110")} />
                  {item.to === "/notifications" && unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1.5 h-4 min-w-[16px] rounded-full bg-rose-600 text-white text-[9px] font-bold grid place-items-center px-1">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </div>
                {shortLabel(item.label)}
                {active && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-primary" />
                )}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={tabClass(moreActive || moreOpen)}
            aria-label="More"
          >
            <div className="relative">
              <MoreHorizontal className="h-5 w-5" />
              {unreadCount > 0 && !tabs.some((t) => t.to === "/notifications") && (
                <span className="absolute -top-1 -right-1.5 h-2.5 w-2.5 rounded-full bg-rose-600" />
              )}
            </div>
            More
            {moreActive && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-primary" />
            )}
          </button>
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85vh] overflow-y-auto rounded-t-3xl px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted" />

          <div className="mb-3 flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback>{initials(profile?.full_name ?? user?.email)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {profile?.full_name ?? user?.email}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {isAdmin ? "Admin" : (roles[0] ?? user?.email)}
              </div>
            </div>
            <ThemeToggle />
          </div>

          {(pwa.canPrompt || pwa.showIosHint) && (
            <div className="mb-3 flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-3">
              <img src="/icon-192.png" alt="" className="h-10 w-10 rounded-xl border bg-white" />
              <div className="min-w-0 flex-1 text-xs">
                <div className="text-sm font-semibold">Install the CRM app</div>
                {pwa.canPrompt ? (
                  <div className="text-muted-foreground">
                    Opens full-screen from your home screen.
                  </div>
                ) : (
                  <div className="text-muted-foreground">
                    Tap <Share className="inline h-3.5 w-3.5 -mt-0.5" /> Share, then{" "}
                    <strong>Add to Home Screen</strong>.
                  </div>
                )}
              </div>
              {pwa.canPrompt && (
                <Button size="sm" onClick={() => void pwa.install()}>
                  <Download className="mr-1 h-4 w-4" /> Install
                </Button>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setMoreOpen(false);
              search.open();
            }}
            className="mb-3 flex w-full items-center gap-2 rounded-xl border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground"
          >
            <Search className="h-4 w-4" /> Search leads, clients, bookings…
          </button>

          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {rest.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "relative flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center text-[11px] font-medium transition-all active:scale-95",
                    active
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "bg-background text-foreground hover:bg-muted/50",
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span className="leading-tight">{item.label}</span>
                  {item.to === "/notifications" && unreadCount > 0 && (
                    <span className="absolute right-2 top-2 h-4 min-w-[16px] rounded-full bg-rose-600 px-1 text-[9px] font-bold text-white grid place-items-center">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          <Button variant="outline" className="mt-4 w-full" onClick={() => signOut()}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </SheetContent>
      </Sheet>
    </>
  );
}
