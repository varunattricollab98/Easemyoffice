import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, UserPlus } from "lucide-react";
import { adminSetPassword, createTeamUser, listTeamUsers, sendPasswordReset, setUserRole } from "@/lib/admin-users.functions";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({ meta: [{ title: "Team Users — Admin" }] }),
  component: AdminUsersPage,
});

const ROLE_OPTIONS = ["sales", "bd", "documentation", "accounts", "renewals", "admin"] as const;

function AdminUsersPage() {
  const { isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(() => {
    if (!loading && !isAdmin) navigate({ to: "/dashboard" });
  }, [loading, isAdmin, navigate]);

  const fetchList = useServerFn(listTeamUsers);
  const createFn = useServerFn(createTeamUser);
  const setRoleFn = useServerFn(setUserRole);
  const resetFn = useServerFn(sendPasswordReset);
  const setPwFn = useServerFn(adminSetPassword);

  const usersQ = useQuery({
    queryKey: ["admin-team-users"],
    queryFn: () => fetchList(),
    enabled: !!isAdmin,
  });

  const [form, setForm] = useState({ full_name: "", email: "", password: "", role: "sales", department: "" });
  const createM = useMutation({
    mutationFn: () => createFn({ data: { ...form, role: form.role as (typeof ROLE_OPTIONS)[number], department: form.department || null } }),
    onSuccess: () => {
      toast.success("User created");
      setForm({ full_name: "", email: "", password: "", role: "sales", department: "" });
      qc.invalidateQueries({ queryKey: ["admin-team-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const roleM = useMutation({
    mutationFn: (v: { user_id: string; role: (typeof ROLE_OPTIONS)[number] }) => setRoleFn({ data: v }),
    onSuccess: () => { toast.success("Role updated"); qc.invalidateQueries({ queryKey: ["admin-team-users"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetM = useMutation({
    mutationFn: (email: string) => resetFn({ data: { email } }),
    onSuccess: () => toast.success("Password reset email sent"),
    onError: (e: Error) => toast.error(e.message),
  });

  const setPwM = useMutation({
    mutationFn: (v: { user_id: string; password: string }) => setPwFn({ data: v }),
    onSuccess: () => toast.success("Password updated"),
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading || !isAdmin) return <div className="p-8 text-muted-foreground">Loading…</div>;

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
            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
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
              </tr>
            </thead>
            <tbody>
              {(usersQ.data?.users ?? []).map((u: any) => (
                <tr key={u.id} className="border-t">
                  <td className="px-4 py-2">{u.full_name ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-2">{u.department ?? "—"}</td>
                  <td className="px-4 py-2">{(u.roles ?? []).join(", ") || "—"}</td>
                  <td className="px-4 py-2">
                    <Select
                      onValueChange={(v) => roleM.mutate({ user_id: u.id, role: v as (typeof ROLE_OPTIONS)[number] })}
                    >
                      <SelectTrigger className="h-8 w-[140px]"><SelectValue placeholder="Change…" /></SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={resetM.isPending || !u.email}
                        onClick={() => resetM.mutate(u.email)}
                      >
                        Send reset
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const pw = window.prompt(`Set new password for ${u.email} (min 8 chars):`);
                          if (!pw) return;
                          if (pw.length < 8) return toast.error("Password must be at least 8 characters");
                          setPwM.mutate({ user_id: u.id, password: pw });
                        }}
                      >
                        Set password
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {usersQ.isLoading && <tr><td className="px-4 py-6 text-muted-foreground" colSpan={6}>Loading…</td></tr>}
              {usersQ.isError && <tr><td className="px-4 py-6 text-destructive" colSpan={6}>Failed to load users: {(usersQ.error as Error)?.message ?? "Unknown error"}</td></tr>}
              {usersQ.data?.error && <tr><td className="px-4 py-6 text-destructive" colSpan={6}>{usersQ.data.error}</td></tr>}
              {usersQ.data && !usersQ.data.error && (usersQ.data.users?.length ?? 0) === 0 && <tr><td className="px-4 py-6 text-muted-foreground" colSpan={6}>No users yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
