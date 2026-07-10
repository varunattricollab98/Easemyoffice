import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ROLES = ["admin", "sales", "documentation", "accounts", "renewals", "bd"] as const;

// Validate the caller's Supabase access token (passed explicitly from the client)
// against the Supabase auth server, then confirm they are an admin. This avoids
// relying on request-header middleware, which was not reliably forwarding the token.
async function requireAdmin(token: unknown): Promise<string> {
  if (typeof token !== "string" || !token) {
    throw new Error("Not authenticated: missing session token. Please sign out and back in.");
  }
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user?.id) {
    throw new Error(`Not authenticated: ${error?.message ?? "invalid session token"}`);
  }
  const uid = data.user.id;
  const { data: adminRow, error: roleErr } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", uid)
    .eq("role", "admin")
    .maybeSingle();
  if (roleErr) throw new Error(`Role check failed: ${roleErr.message}`);
  if (!adminRow) throw new Error("Forbidden: admin only");
  return uid;
}

const CreateUserInput = z.object({
  _token: z.string().optional(),
  full_name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(72),
  role: z.enum(ROLES),
  department: z.string().trim().max(60).optional().nullable(),
});

export const createTeamUser = createServerFn({ method: "POST" })
  .inputValidator((d) => CreateUserInput.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data._token);

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Failed to create user");

    const uid = created.user.id;

    // Trigger handle_new_user creates a default "sales" role; align it to selected role.
    if (data.role !== "sales") {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", uid).eq("role", "sales");
      await supabaseAdmin.from("user_roles").upsert({ user_id: uid, role: data.role });
    }
    if (data.department) {
      await supabaseAdmin.from("profiles").update({ department: data.department }).eq("id", uid);
    }
    return { id: uid, email: data.email };
  });

export const listTeamUsers = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ _token: z.string().optional() }).parse(d))
  .handler(async ({ data }) => {
    try {
      await requireAdmin(data._token);
      // Source of truth = auth.users (always populated), enriched with profiles + roles.
      const { data: authList, error: authErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (authErr) throw new Error(`auth list failed: ${authErr.message}`);
      const [profRes, roleRes] = await Promise.all([
        supabaseAdmin.from("profiles").select("id, full_name, email, department"),
        supabaseAdmin.from("user_roles").select("user_id, role"),
      ]);
      if (profRes.error) throw new Error(`profiles query failed: ${profRes.error.message}`);
      if (roleRes.error) throw new Error(`user_roles query failed: ${roleRes.error.message}`);
      const profById = new Map((profRes.data ?? []).map((p: any) => [p.id, p]));
      const byUser = new Map<string, string[]>();
      (roleRes.data ?? []).forEach((r: any) => {
        const arr = byUser.get(r.user_id) ?? [];
        arr.push(r.role);
        byUser.set(r.user_id, arr);
      });
      const users = (authList?.users ?? []).map((u: any) => {
        const p: any = profById.get(u.id) ?? {};
        return {
          id: u.id,
          email: u.email ?? p.email ?? null,
          full_name: p.full_name ?? u.user_metadata?.full_name ?? null,
          department: p.department ?? null,
          roles: byUser.get(u.id) ?? [],
          created_at: u.created_at,
        };
      });
      return { users, error: null as string | null };
    } catch (e: any) {
      console.error("listTeamUsers failed:", e);
      return { users: [] as any[], error: e?.message ?? "Failed to load users" };
    }
  });

export const sendPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ _token: z.string().optional(), email: z.string().trim().email().max(254) }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data._token);
    const origin = process.env.SITE_URL || process.env.VITE_SITE_URL || "";
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(data.email, {
      redirectTo: origin ? `${origin}/reset-password` : undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminSetPassword = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ _token: z.string().optional(), user_id: z.string().uuid(), password: z.string().min(8).max(72) }).parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data._token);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password: data.password,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ _token: z.string().optional(), user_id: z.string().uuid(), role: z.enum(ROLES) }).parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data._token);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    const { error } = await supabaseAdmin.from("user_roles").insert({ user_id: data.user_id, role: data.role });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
