// Role lookup for route guards (beforeLoad), cached.
//
// The guards used to call supabase.auth.getUser() — a network round trip to
// the auth server — plus a user_roles query on EVERY navigation, and the
// router preloads on hover, so hovering an admin link fired both again. Now:
// the session comes from local storage (getSession), and the roles are cached
// in react-query for 5 minutes, shared by every guard.
//
// This is a UX guard only; RLS is the real boundary, so a slightly stale role
// list can at worst render a page whose queries come back empty.

import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export async function guardRoles(
  queryClient: QueryClient,
  allowed: string[],
): Promise<{ userId: string; roles: string[] }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw redirect({ to: "/login" });
  const roles = await queryClient.ensureQueryData({
    queryKey: ["guard-roles", userId],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
      return ((data ?? []) as { role: string }[]).map((r) => r.role);
    },
  });
  if (!roles.some((r) => allowed.includes(r))) throw redirect({ to: "/dashboard" });
  return { userId, roles };
}
