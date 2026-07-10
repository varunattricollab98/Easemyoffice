import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ROLES = ["admin", "sales", "documentation", "accounts", "renewals", "bd"] as const;
const CreateUserInput = z.object({
  full_name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(72),
  role: z.enum(ROLES),
  department: z.string().trim().max(60).optional().nullable(),
});

async function assertAdmin(supabase: ReturnType<typeof supabaseAdmin.from> extends infer _ ? any : never, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

export const createTeamUser = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d) => CreateUserInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(null as never, context.userId);

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

export const listTeamUsers = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      await assertAdmin(null as never, context.userId);
      const [profRes, roleRes] = await Promise.all([
        supabaseAdmin.from("profiles").select("id, full_name, email, department, created_at").order("created_at", { ascending: false }),
        supabaseAdmin.from("user_roles").select("user_id, role"),
      ]);
      if (profRes.error) throw new Error(`profiles query failed: ${profRes.error.message}`);
      if (roleRes.error) throw new Error(`user_roles query failed: ${roleRes.error.message}`);
      const profiles = profRes.data;
      const roles = roleRes.data;
      const byUser = new Map<string, string[]>();
      (roles ?? []).forEach((r: any) => {
        const arr = byUser.get(r.user_id) ?? [];
        arr.push(r.role);
        byUser.set(r.user_id, arr);
      });
      const users = (profiles ?? []).map((p: any) => ({ ...p, roles: byUser.get(p.id) ?? [] }));
      return { users, error: null as string | null };
    } catch (e: any) {
      console.error("listTeamUsers failed:", e);
      return { users: [] as any[], error: e?.message ?? "Failed to load users" };
    }
  });

export const sendPasswordReset = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d) => z.object({ email: z.string().trim().email().max(254) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(null as never, context.userId);
    const origin = process.env.SITE_URL || process.env.VITE_SITE_URL || "";
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(data.email, {
      redirectTo: origin ? `${origin}/reset-password` : undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminSetPassword = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ user_id: z.string().uuid(), password: z.string().min(8).max(72) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(null as never, context.userId);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password: data.password,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ user_id: z.string().uuid(), role: z.enum(ROLES) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(null as never, context.userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    const { error } = await supabaseAdmin.from("user_roles").insert({ user_id: data.user_id, role: data.role });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
