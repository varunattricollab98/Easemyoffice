import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { initials } from "@/lib/crm";

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({ meta: [{ title: "Team — EaseMyOffice CRM" }] }),
  component: TeamPage,
});

function TeamPage() {
  const { data } = useQuery({
    queryKey: ["team"],
    queryFn: async () => {
      const { data: profiles } = await supabase.from("profiles").select("*");
      const { data: roles } = await supabase.from("user_roles").select("user_id, role");
      return (profiles ?? []).map((p: any) => ({
        ...p,
        roles: (roles ?? []).filter((r: any) => r.user_id === p.id).map((r: any) => r.role),
      }));
    },
  });

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Team</h1>
        <p className="text-sm text-muted-foreground">All members and their roles. Role assignment UI coming next phase.</p>
      </div>
      <Card><CardHeader><CardTitle className="text-base">Members</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {data?.map((m: any) => (
            <div key={m.id} className="flex items-center gap-3 py-3">
              <Avatar><AvatarFallback>{initials(m.full_name ?? m.email)}</AvatarFallback></Avatar>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{m.full_name ?? "Unnamed"}</div>
                <div className="text-xs text-muted-foreground truncate">{m.email}</div>
              </div>
              <div className="flex flex-wrap gap-1">
                {m.roles.length === 0 && <Badge variant="outline">no role</Badge>}
                {m.roles.map((r: string) => <Badge key={r} variant="secondary">{r}</Badge>)}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
