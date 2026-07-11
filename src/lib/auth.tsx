import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { setAnalyticsActor } from "@/lib/analytics";

export type AppRole = "admin" | "sales" | "documentation" | "accounts" | "renewals" | "bd";

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  department: string | null;
  phone: string | null;
}

interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  roles: AppRole[];
  isAuthenticated: boolean;
  isAdmin: boolean;
  hasRole: (r: AppRole) => boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  const loadUserData = async (uid: string) => {
    const [{ data: prof }, { data: roleRows }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
    ]);
    const profile = (prof as Profile) ?? null;
    const roleList = ((roleRows ?? []) as { role: AppRole }[]).map((r) => r.role);
    setProfile(profile);
    setRoles(roleList);
    // Attribute analytics events to this user + team going forward.
    setAnalyticsActor({
      userId: uid,
      team: profile?.department ?? roleList[0] ?? null,
    });
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setLoading(false);
      if (sess?.user) {
        // load profile/roles in background — do not block UI
        setTimeout(() => loadUserData(sess.user.id), 0);
      } else {
        setProfile(null);
        setRoles([]);
        setAnalyticsActor({ userId: null, team: null });
      }
    });

    // Resolve session ASAP and unblock the app; profile/roles hydrate after.
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setLoading(false);
      if (s?.user) loadUserData(s.user.id);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthState = {
    loading,
    session,
    user: session?.user ?? null,
    profile,
    roles,
    isAuthenticated: !!session,
    isAdmin: roles.includes("admin"),
    hasRole: (r) => roles.includes(r),
    signOut: async () => {
      // "local" scope signs out only the current device/browser, leaving other
      // devices (e.g. phone) still logged in. This is the expected behavior for
      // a day-to-day CRM. (Use a dedicated "sign out everywhere" action for the
      // rare security case of revoking all sessions.)
      await supabase.auth.signOut({ scope: "local" });
    },
    refresh: async () => {
      if (session?.user) await loadUserData(session.user.id);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
