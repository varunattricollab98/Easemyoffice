import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { createClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, UserPlus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({ meta: [{ title: "Team Users — Admin" }] }),
  component: AdminUsersPage,
});

const ROLE_OPTIONS = ["sales", "bd", "documentation", "accounts", "renewals", "admin"] as const;
type Role = (typeof ROLE_OPTIONS)[number];

// A throwaway Supabase client used only to create new users via signUp, so it
// does NOT replace the current admin's session. Uses the public publishable key
// (safe in the browser). This avoids needing the server-side service role key.
const signupClient = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function AdminUsersPage() {
  const { isAdmin, loading, user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(() => {
    if (!loading && !isAdmin) navigate({ to: "/dashboard" });
  }, [loading, isAdmin, navigate]);

  const usersQ = useQuery({
    queryKey: ["admin-team-users"],
    enabled: !!isAdmin,
    queryFn: async () => {
      const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email, department, created_at").order("created_at", { ascending: false }),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (pErr) throw new Error(pErr.message);
      if (rErr) throw new Error(rErr.message);
      const byUser = new Map<string, string[]>();
      (roles ?? []).forEach((r: any) => {
        const arr = byUser.get(r.user_id) ?? [];
        arr.push(r.role);
        byUser.set(r.user_id, arr);
      });
      return (profiles ?? []).map((p: any) => ({ ...p, roles: byUser.get(p.id) ?? [] }));
    },
  });

  const [form, setForm] = useState({ full_name: "", email: "", password: "", role: "sales" as Role, department: "" });

  const createM = useMutation({
    mutationFn: async () => {
      if (!form.full_name.trim()) throw new Error("Please enter a full name");
      if (!form.email.trim()) throw new Error("Please enter an email");
      if (form.password.length < 8) throw new Error("Password must be at least 8 characters");

      // 1) Create the auth user (browser-side signUp, admin session stays intact).
      const { data, error } = await signupClient.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: { data: { full_name: form.full_name.trim() } },
      });
      if (error) throw new Error(error.message);
      const uid = data.user?.id;
      if (!uid) {
        throw new Error("User was not created. In Supabase, turn OFF 'Confirm email' (Authentication → Providers → Email), then try again.");
      }

      // 2) The DB trigger assigns a default 'sales' role. If a different role was
      //    chosen, replace it. Allowed by the 'admins manage user_roles' policy.
      if (form.role !== "sales") {
        await supabase.from("user_roles").delete().eq("user_id", uid);
        const { error: rErr } = await supabase.from("user_roles").insert({ user_id: uid, role: form.role });
        if (rErr) throw new Error(rErr.message);
      }

      // 3) Optional department on the profile.
      if (form.department.trim()) {
        await supabase.from("profiles").update({ department: form.department.trim() }).eq("id", uid);
      }
      return { id: uid };
    },
    onSuccess: () => {
      toast.success("User created");
      setForm({ full_name: "", email: "", password: "", role: "sales", department: "" });
      qc.invalidateQueries({ queryKey: ["admin-team-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const roleM = useMutation({
    mutationFn: async (v: { user_id: string; role: Role }) => {
      await supabase.from("user_roles").delete().eq("user_id", v.user_id);
      const { error } = await supabase.from("user_roles").insert({ user_id: v.user_id, role: v.role });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Role updated"); qc.invalidateQueries({ queryKey: ["admin-team-users"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetM = useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => toast.success("Password reset email sent"),
    onError: (e: Error) => toast.error(e.message),
  });

  const removeM = useMutation({
    mutationFn: async (userId: string) => {
      // Strip access + remove from the team list. (Fully deleting the login
      // itself requires the server admin key, which this hosting can't use —
      // do that from Supabase → Authentication → Users if needed.)
      await supabase.from("user_roles").delete().eq("user_id", userId);
      const { error } = await supabase.from("profiles").delete().eq("id", userId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("User removed from team"); qc.invalidateQueries({ queryKey: ["admin-team-users"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading || !isAdmin) return <div className="p-8 text-muted-foreground">Loading…</div>;

  const users = usersQ.data ?? [];

  return (
    <div className="p-4 md:p-8 max-w-[1100px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/dashboard" className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> Back to Dashboard
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Team Users</h1>
          <p className="text-sm text-muted-foreground">Create new sales / team accounts and manage their roles.</p>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <UserPlus className="h-4 w-4" /> <h2 className="font-medium">Add user</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          <div><Label className="text-xs">Full name</Label>
            <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
          <div><Label className="text-xs">Email</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><Label className="text-xs">Temp password (≥8)</Label>
            <Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          <div><Label className="text-xs">Role</Label>
            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as Role })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select></div>
          <div><Label className="text-xs">Department (optional)</Label>
            <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            disabled={createM.isPending || !form.email || !form.password || !form.full_name}
            onClick={() => createM.mutate()}
          >
            {createM.isPending ? "Creating…" : "Create user"}
          </Button>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b font-medium text-sm">Existing users</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-4 py-2">Email</th>
                <th className="text-left px-4 py-2">Department</th>
                <th className="text-left px-4 py-2">Roles</th>
                <th className="text-left px-4 py-2">Set role</th>
                <th className="text-left px-4 py-2">Password</th>
                <th className="text-left px-4 py-2">Remove</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u: any) => (
                <tr key={u.id} className="border-t">
                  <td className="px-4 py-2">{u.full_name ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-2">{u.department ?? "—"}</td>
                  <td className="px-4 py-2">{(u.roles ?? []).join(", ") || "—"}</td>
                  <td className="px-4 py-2">
                    <Select onValueChange={(v) => roleM.mutate({ user_id: u.id, role: v as Role })}>
                      <SelectTrigger className="h-8 w-[140px]"><SelectValue placeholder="Change…" /></SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resetM.isPending || !u.email}
                      onClick={() => resetM.mutate(u.email)}
                    >
                      Send reset
                    </Button>
                  </td>
                  <td className="px-4 py-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={u.id === user?.id || removeM.isPending}
                      title={u.id === user?.id ? "You can't remove yourself" : "Remove user from team"}
                      onClick={() => {
                        if (window.confirm(`Remove ${u.email || "this user"} from the team? They will lose all access.`)) {
                          removeM.mutate(u.id);
                        }
                      }}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
              {usersQ.isLoading && <tr><td className="px-4 py-6 text-muted-foreground" colSpan={7}>Loading…</td></tr>}
              {usersQ.isError && <tr><td className="px-4 py-6 text-destructive" colSpan={7}>Failed to load users: {(usersQ.error as Error)?.message ?? "Unknown error"}</td></tr>}
              {!usersQ.isLoading && !usersQ.isError && users.length === 0 && <tr><td className="px-4 py-6 text-muted-foreground" colSpan={7}>No users yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
