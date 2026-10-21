import { Link, useLocation } from "@tanstack/react-router";
import {
  LogOut, Building2, ChevronDown, Bell,
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

// Nav link styles shared by top-level items and group children. The active
// item is a soft indigo pill with a brand-gradient marker on the left edge.
const NAV_BASE =
  "group/nav relative flex items-center gap-3 rounded-lg px-3 text-[13.5px] transition-[background-color,color] duration-150";
const NAV_ACTIVE =
  "bg-sidebar-accent text-sidebar-accent-foreground font-medium [&_svg]:text-primary before:absolute before:-left-3 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r-full before:bg-[image:var(--gradient-brand)]";
const NAV_IDLE =
  "text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground";

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-semibold tabular-nums text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

const isActivePath = (pathname: string, to: string) =>
  to === "/b2b" ? pathname === "/b2b" : pathname === to || pathname.startsWith(to + "/");

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
  const childActive = group.children.some((c) => isActivePath(pathname, c.to));
  const [open, setOpen] = useState(childActive);

  // Keep group open if user navigates into it from another route.
  useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);

  const Icon = group.icon;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          NAV_BASE,
          "w-full py-2",
          childActive
            ? "font-medium text-foreground [&_svg]:text-primary"
            : NAV_IDLE,
        )}
      >
        <Icon className="h-[18px] w-[18px]" />
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform duration-200", !open && "-rotate-90")}
        />
      </button>
      {open && (
        <div className="ml-[21px] mt-0.5 space-y-0.5 border-l border-sidebar-border pl-3">
          {group.children.map((item) => {
            const active = isActivePath(pathname, item.to);
            const ChildIcon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(NAV_BASE, "py-1.5", active ? NAV_ACTIVE : NAV_IDLE)}
              >
                <ChildIcon className="h-4 w-4" />
                <span className="flex-1 truncate">{item.label}</span>
                {item.to === "/notifications" && <UnreadBadge count={unreadCount} />}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AppSidebar() {
  const { isAdmin, signOut, user, roles } = useAuth();
  const loc = useLocation();
  const nodes = visibleNodes(NAV_TREE, roles, isAdmin);

  const unreadCount = useUnreadCount(user?.id);

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <div className="grid size-9 place-items-center rounded-xl bg-[image:var(--gradient-brand)] text-white shadow-[0_6px_16px_-6px_rgb(49_94_251/0.6)]">
          <Building2 className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold leading-tight tracking-tight">EaseMyOffice</div>
          <div className="text-[11px] text-muted-foreground">CRM</div>
        </div>
      </div>

      <div className="px-5 pb-2 pt-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
        Main menu
      </div>
      <nav className="scrollbar-modern flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
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
          const active = isActivePath(loc.pathname, item.to);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(NAV_BASE, "py-2", active ? NAV_ACTIVE : NAV_IDLE)}
            >
              <Icon className="h-[18px] w-[18px]" />
              <span className="flex-1 truncate">{item.label}</span>
              {item.to === "/notifications" && <UnreadBadge count={unreadCount} />}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <button
          type="button"
          onClick={() => signOut()}
          className={cn(NAV_BASE, "w-full py-2", NAV_IDLE)}
        >
          <LogOut className="h-[18px] w-[18px]" />
          <span>Log out</span>
        </button>
      </div>
    </aside>
  );
}

/** Label of the nav item for the current page, e.g. "Sales / Leads". */
function useCurrentPageLabel(): { section: string | null; page: string } {
  const loc = useLocation();
  const { roles, isAdmin } = useAuth();
  return useMemo(() => {
    let best: { section: string | null; page: string; len: number } = {
      section: null,
      page: "",
      len: -1,
    };
    for (const node of visibleNodes(NAV_TREE, roles, isAdmin)) {
      const items = isNavGroup(node)
        ? node.children.map((c) => ({ c, section: node.label }))
        : [{ c: node as NavItem, section: null }];
      for (const { c, section } of items) {
        if (isActivePath(loc.pathname, c.to) && c.to.length > best.len) {
          best = { section, page: c.label, len: c.to.length };
        }
      }
    }
    return { section: best.section, page: best.page };
  }, [loc.pathname, roles, isAdmin]);
}

/**
 * Desktop top bar: where-am-I, search, theme, notifications and profile —
 * the same controls the sidebar used to hold, moved to where the references
 * (and most SaaS apps) put them. Hidden on phones, which use the tab bar.
 */
export function AppHeader() {
  const { profile, isAdmin, user, roles } = useAuth();
  const search = useGlobalSearch();
  const unreadCount = useUnreadCount(user?.id);
  const { section, page } = useCurrentPageLabel();

  return (
    <header className="sticky top-0 z-30 hidden h-16 items-center gap-4 border-b border-border/80 bg-background/80 px-6 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 lg:flex">
      <div className="min-w-0 flex-1 truncate text-sm">
        {section && <span className="text-muted-foreground">{section} / </span>}
        <span className="font-semibold text-foreground">{page}</span>
      </div>

      <button
        type="button"
        onClick={() => search.open()}
        className="flex h-9 w-72 items-center gap-2 rounded-lg border border-input bg-card px-3 text-sm text-muted-foreground shadow-[var(--shadow-xs)] transition-colors duration-150 hover:border-primary/40 hover:text-foreground"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 truncate whitespace-nowrap text-left">Search leads, bookings…</span>
        <kbd className="pointer-events-none select-none rounded-md border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      <ThemeToggle />

      <Link
        to="/notifications"
        aria-label={unreadCount ? `Notifications (${unreadCount} unread)` : "Notifications"}
        className="relative grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-background" />
        )}
      </Link>

      <div className="flex items-center gap-2.5 border-l border-border pl-4">
        <Avatar className="h-8 w-8">
          <AvatarFallback className="bg-accent text-[12px] font-semibold text-accent-foreground">
            {initials(profile?.full_name ?? user?.email)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 leading-tight">
          <div className="max-w-40 truncate text-sm font-medium">
            {profile?.full_name ?? user?.email}
          </div>
          <div className="max-w-40 truncate text-[11px] capitalize text-muted-foreground">
            {isAdmin ? "Admin" : (roles[0] ?? "")}
          </div>
        </div>
      </div>
    </header>
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
