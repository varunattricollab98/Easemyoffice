import {
  LayoutDashboard, Users, Kanban, Bell, CheckSquare, FileText, Receipt,
  RefreshCcw, Activity, BarChart3, Settings, UsersRound, Building2, BookOpen,
  UserCheck, FileSignature, Calendar, Inbox, Trophy, Mail, AlarmClock, Phone,
  CalendarCheck, ShieldCheck, Upload, History, Handshake, Share2,
} from "lucide-react";
import type { AppRole } from "@/lib/auth";

// Single source of truth for the app navigation tree. Both the sidebar
// (app-shell.tsx) and the global search palette (global-search.tsx) consume
// this, so the two can never drift. Icons are plain lucide components, which is
// why the data lives in its own module (no React component / context imports)
// to keep it cheap to import from anywhere.

// roles: undefined = visible to all authenticated users
export type NavItem = { to: string; label: string; icon: typeof Users; roles?: AppRole[] };

/** A sidebar node is either a plain leaf link or a collapsible group header. */
export type NavGroup = {
  label: string;
  icon: typeof Users;
  roles?: AppRole[];
  children: NavItem[];
};
export type NavNode = NavItem | NavGroup;

export function isNavGroup(n: NavNode): n is NavGroup {
  return "children" in n;
}

// ---------------------------------------------------------------------------
// Sales section (flat items, grouped for visual clarity)
// ---------------------------------------------------------------------------
export const SALES_NAV: NavNode[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  {
    label: "Sales",
    icon: Users,
    roles: ["admin", "sales", "bd"],
    children: [
      { to: "/pipeline", label: "Pipeline", icon: Kanban, roles: ["admin", "sales", "bd"] },
      { to: "/inbox", label: "Lead Inbox", icon: Mail, roles: ["admin", "sales", "bd"] },
      { to: "/calls", label: "Calls", icon: Phone, roles: ["admin", "sales", "bd"] },
      { to: "/leads", label: "Leads", icon: Users, roles: ["admin", "sales", "bd"] },
      { to: "/activity", label: "Activity", icon: Activity, roles: ["admin", "sales", "bd"] },
      {
        to: "/admin/sales-performance",
        label: "Sales Performance",
        icon: Trophy,
        roles: ["admin", "sales", "bd"],
      },
    ],
  },
  {
    label: "Renewals",
    icon: RefreshCcw,
    roles: ["admin", "renewals"],
    children: [
      { to: "/renewals/inbox", label: "Renewal Inbox", icon: Mail, roles: ["admin", "renewals"] },
      { to: "/renewals/leads", label: "Renewal Leads", icon: Users, roles: ["admin", "renewals"] },
      { to: "/renewals/pipeline", label: "Renewal Pipeline", icon: Kanban, roles: ["admin", "renewals"] },
    ],
  },
  { to: "/clients", label: "Clients", icon: UserCheck, roles: ["admin", "sales", "bd", "renewals", "accounts"] },
  { to: "/follow-ups", label: "Follow-ups", icon: Bell, roles: ["admin", "sales", "bd", "renewals"] },
  { to: "/reminders", label: "Reminders", icon: AlarmClock, roles: ["admin", "sales", "bd", "renewals"] },
  { to: "/calendar", label: "Calendar", icon: Calendar },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/attendance", label: "My Attendance", icon: CalendarCheck },
  { to: "/my-payroll", label: "My Payroll", icon: Receipt },
  { to: "/notifications", label: "Notifications", icon: Inbox },
  { to: "/documentation", label: "Documentation Pipeline", icon: FileText, roles: ["admin", "documentation", "sales"] },
  { to: "/bookings", label: "Bookings", icon: BookOpen, roles: ["admin", "sales", "bd", "accounts", "renewals"] },
  { to: "/invoices", label: "Invoices", icon: FileSignature, roles: ["admin", "accounts"] },
  { to: "/payments", label: "Payments", icon: Receipt, roles: ["admin", "accounts", "sales"] },
  { to: "/reports", label: "Reports", icon: BarChart3, roles: ["admin"] },
];

// ---------------------------------------------------------------------------
// B2B department: collapsible groups per user spec
// ---------------------------------------------------------------------------
export const B2B_NAV: NavNode[] = [
  { to: "/b2b", label: "B2B Dashboard", icon: Handshake, roles: ["admin", "b2b"] },
  {
    label: "Prospecting",
    icon: Users,
    roles: ["admin", "b2b"],
    children: [
      { to: "/b2b/leads", label: "B2B Leads", icon: Users, roles: ["admin", "b2b"] },
      { to: "/b2b/firms", label: "CA Firms", icon: Building2, roles: ["admin", "b2b"] },
      { to: "/b2b/contacts", label: "Contacts", icon: UserCheck, roles: ["admin", "b2b"] },
      { to: "/b2b/import", label: "Import Leads", icon: Upload, roles: ["admin", "b2b"] },
      {
        to: "/b2b/import-history",
        label: "Import History",
        icon: History,
        roles: ["admin", "b2b"],
      },
    ],
  },
  {
    label: "Activities",
    icon: Activity,
    roles: ["admin", "b2b"],
    children: [
      { to: "/b2b/activities", label: "My Tasks", icon: CheckSquare, roles: ["admin", "b2b"] },
      { to: "/b2b/activities/followups", label: "Follow-ups", icon: Bell, roles: ["admin", "b2b"] },
      { to: "/b2b/activities/calls", label: "B2B Calls", icon: Phone, roles: ["admin", "b2b"] },
      {
        to: "/b2b/activities/meetings",
        label: "Meetings",
        icon: CalendarCheck,
        roles: ["admin", "b2b"],
      },
      {
        to: "/b2b/activities/history",
        label: "Activity History",
        icon: Activity,
        roles: ["admin", "b2b"],
      },
    ],
  },
  {
    label: "Partnerships",
    icon: Handshake,
    roles: ["admin", "b2b"],
    children: [
      { to: "/b2b/pipeline", label: "Partnership Pipeline", icon: Kanban, roles: ["admin", "b2b"] },
      { to: "/b2b/partners", label: "Active Partners", icon: Handshake, roles: ["admin", "b2b"] },
      { to: "/b2b/referrals", label: "Referrals", icon: Share2, roles: ["admin", "b2b"] },
      {
        to: "/b2b/partner-performance",
        label: "Partner Performance",
        icon: Trophy,
        roles: ["admin", "b2b"],
      },
    ],
  },
  {
    label: "Analytics",
    icon: BarChart3,
    roles: ["admin", "b2b"],
    children: [
      {
        to: "/b2b/analytics/performance",
        label: "B2B Performance",
        icon: BarChart3,
        roles: ["admin", "b2b"],
      },
      {
        to: "/b2b/analytics/source",
        label: "Source Analytics",
        icon: Share2,
        roles: ["admin", "b2b"],
      },
      {
        to: "/b2b/analytics/employee",
        label: "Employee Performance",
        icon: UsersRound,
        roles: ["admin", "b2b"],
      },
      {
        to: "/b2b/analytics/revenue",
        label: "Revenue Analytics",
        icon: Receipt,
        roles: ["admin", "b2b"],
      },
    ],
  },
  { to: "/b2b/renewals", label: "B2B Renewals", icon: RefreshCcw, roles: ["admin", "b2b"] },
  { to: "/b2b/documentation", label: "B2B Documentation", icon: FileText, roles: ["admin", "b2b"] },
];

// ---------------------------------------------------------------------------
// Admin section
// ---------------------------------------------------------------------------
export const ADMIN_NAV: NavNode[] = [
  { to: "/hrms", label: "Staff & Attendance", icon: ShieldCheck, roles: ["admin"] },
  { to: "/admin/email-automation", label: "Email Automation", icon: Mail, roles: ["admin"] },
  { to: "/admin/users", label: "Team", icon: UsersRound, roles: ["admin"] },
  { to: "/settings", label: "Settings", icon: Settings },
];

/** The full ordered nav tree. */
export const NAV_TREE: NavNode[] = [...SALES_NAV, ...B2B_NAV, ...ADMIN_NAV];

/** Flatten every NavNode to its leaf NavItems (used by MobileTabBar + search). */
export function flattenNodes(nodes: NavNode[]): NavItem[] {
  const out: NavItem[] = [];
  for (const n of nodes) {
    if (isNavGroup(n)) {
      out.push(...n.children);
    } else {
      out.push(n);
    }
  }
  return out;
}

/** Filter a NavNode tree by role, dropping groups whose visible children are empty. */
export function visibleNodes(nodes: NavNode[], roles: AppRole[], isAdmin: boolean): NavNode[] {
  if (isAdmin) return nodes;
  return nodes
    .map((n) => {
      if (isNavGroup(n)) {
        const kids = n.children.filter((c) => !c.roles || c.roles.some((r) => roles.includes(r)));
        if (kids.length === 0) return null;
        return { ...n, children: kids } as NavGroup;
      }
      if (n.roles && !n.roles.some((r) => roles.includes(r))) return null;
      return n;
    })
    .filter(Boolean) as NavNode[];
}
