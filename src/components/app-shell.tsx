import { Link, useLocation } from "@tanstack/react-router";
import {
  LogOut, Building2, ChevronDown, ChevronRight,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  NAV_TREE,
  flattenNodes,
  visibleNodes,
  isNavGroup,
  type NavItem,
  type NavGroup,
} from "@/lib/nav";
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

/** Collapsible nav group in the sidebar. */
function SidebarGroup({
  group,
  pathname,
  unreadCount,
}: {
  group: NavGroup;
  pathname: string;
  unreadCount: number;
}) {
  // Auto-expand when any child route is active.
  const childActive = group.children.some(
    (c) => pathname === c.to || pathname.startsWith(c.to + "/"),
  );
  const [open, setOpen] = useState(childActive);

  // Keep group open if user navigates into it from another route.
  useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);

  const Icon = group.icon;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
          childActive
            ? "text-sidebar-accent-foreground font-medium"
            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
        <span className="flex-1 text-left">{group.label}</span>
        <Chevron className="h-3.5 w-3.5 opacity-50" />
      </button>
      {open && (
        <div className="ml-3 border-l border-sidebar-accent/40 pl-1 space-y-0.5">
          {group.children.map((item) => {
            const active = pathname === item.to || pathname.startsWith(item.to + "/");
            const ChildIcon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                <ChildIcon className="h-3.5 w-3.5" />
                <span className="flex-1">{item.label}</span>
                {item.to === "/notifications" && unreadCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-rose-600 text-white text-[11px] font-semibold">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AppSidebar() {
  const { profile, isAdmin, signOut, user, roles } = useAuth();
  const loc = useLocation();
  const search = useGlobalSearch();
  const nodes = visibleNodes(NAV_TREE, roles, isAdmin);

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
        {nodes.map((node) => {
          if (isNavGroup(node)) {
            return (
              <SidebarGroup
                key={node.label}
                group={node}
                pathname={loc.pathname}
                unreadCount={unreadCount}
              />
            );
          }
          const item = node;
          // B2B Dashboard uses exact match to avoid being active on every /b2b/* page.
          const active =
            item.to === "/b2b"
              ? loc.pathname === "/b2b"
              : loc.pathname === item.to || loc.pathname.startsWith(item.to + "/");
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

  // Everything this user may open, in sidebar order (flattened from the tree).
  const all = useMemo(() => {
    const visible = visibleNodes(NAV_TREE, roles, isAdmin);
    return flattenNodes(visible);
  }, [roles, isAdmin]);

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
