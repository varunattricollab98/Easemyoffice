// Admin-only user management using the Supabase service role.
// Edge functions automatically receive SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY as built-in secrets — no manual setup needed.
//
// Actions (POST body):
//   { action: "create", email, password, full_name, role, department }
//   { action: "delete", user_id }
//
// The caller's JWT is checked to ensure they are an admin before anything runs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const ROLES = ["sales", "bd", "documentation", "accounts", "renewals", "admin"];

// Protected super-admin account — cannot be deleted or have its role changed.
const PROTECTED_EMAIL = "varun@easemyoffice.in";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (req.method !== "POST") throw new Error("Use POST");

    // 1) Identify the caller from their JWT.
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !caller) throw new Error("Not signed in.");

    // 2) Confirm the caller is an admin (checked with the service client so RLS
    //    can't hide roles).
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: callerRoles } = await admin.from("user_roles").select("role").eq("user_id", caller.id);
    const isAdmin = (callerRoles ?? []).some((r: any) => r.role === "admin");
    if (!isAdmin) throw new Error("Only admins can manage team users.");

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    // ---- DELETE ---------------------------------------------------------
    if (action === "delete") {
      const targetId = body.user_id as string;
      if (!targetId) throw new Error("user_id is required.");
      if (targetId === caller.id) throw new Error("You can't delete your own account.");

      // Block deletion of the protected owner account.
      const { data: targetProfile } = await admin.from("profiles").select("email").eq("id", targetId).maybeSingle();
      if (targetProfile?.email === PROTECTED_EMAIL) {
        throw new Error("This account is protected and cannot be deleted.");
      }

      // Deleting the auth user cascades to profiles + user_roles (ON DELETE CASCADE).
      const { error } = await admin.auth.admin.deleteUser(targetId);
      if (error) throw new Error(error.message);
      return json({ ok: true, deleted: targetId });
    }

    // ---- CREATE ---------------------------------------------------------
    if (action === "create") {
      const email = String(body.email ?? "").trim();
      const password = String(body.password ?? "");
      const fullName = String(body.full_name ?? "").trim();
      const department = String(body.department ?? "").trim();
      const role = ROLES.includes(body.role) ? body.role : "sales";

      if (!email) throw new Error("Email is required.");
      if (password.length < 8) throw new Error("Password must be at least 8 characters.");

      // Create the login with email pre-confirmed (no confirmation email needed).
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (error) throw new Error(error.message);
      const uid = created.user?.id;
      if (!uid) throw new Error("User could not be created.");

      // Force exactly the chosen role (this also neutralises any DB triggers
      // that may have auto-assigned extra roles like admin).
      await admin.from("user_roles").delete().eq("user_id", uid);
      await admin.from("user_roles").insert({ user_id: uid, role });

      // Make sure the profile reflects the given name + department.
      const profilePatch: Record<string, string> = {};
      if (fullName) profilePatch.full_name = fullName;
      if (department) profilePatch.department = department;
      if (Object.keys(profilePatch).length) {
        await admin.from("profiles").update(profilePatch).eq("id", uid);
      }

      return json({ ok: true, id: uid });
    }

    throw new Error("Unknown action.");
  } catch (e) {
    // 200 + ok:false so the browser can read the real message.
    return json({ ok: false, error: (e as Error).message });
  }
});
