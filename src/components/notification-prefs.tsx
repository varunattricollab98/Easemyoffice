import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Bell, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Prefs = {
  user_id: string;
  in_app_enabled: boolean;
  email_enabled: boolean;
  remind_minutes_before: number;
  daily_digest: boolean;
  email_address: string | null;
};

const DEFAULTS: Omit<Prefs, "user_id"> = {
  in_app_enabled: true,
  email_enabled: false,
  remind_minutes_before: 15,
  daily_digest: false,
  email_address: null,
};

export function NotificationPrefs() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<Omit<Prefs, "user_id">>(DEFAULTS);

  const { data, isLoading } = useQuery({
    queryKey: ["notification-prefs", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_prefs")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Prefs | null;
    },
  });

  useEffect(() => {
    if (data) {
      setForm({
        in_app_enabled: data.in_app_enabled,
        email_enabled: data.email_enabled,
        remind_minutes_before: data.remind_minutes_before,
        daily_digest: data.daily_digest,
        email_address: data.email_address ?? user?.email ?? null,
      });
    } else if (user?.email && !form.email_address) {
      setForm((f) => ({ ...f, email_address: user.email ?? null }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, user?.email]);

  const save = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Not signed in");
      const { error } = await supabase
        .from("notification_prefs")
        .upsert({ user_id: user.id, ...form }, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Notification preferences saved");
      qc.invalidateQueries({ queryKey: ["notification-prefs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="h-4 w-4" /> Follow-up reminders
        </CardTitle>
        <CardDescription>
          Choose how and when you're reminded about due follow-ups.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="py-4 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <Row
              title="In-app alerts"
              description="Show toast & badge when a follow-up becomes due."
              control={
                <Switch
                  checked={form.in_app_enabled}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, in_app_enabled: v }))}
                  aria-label="Toggle in-app alerts"
                />
              }
            />
            <Row
              title="Email reminders"
              description="Get an email at the chosen time before a follow-up is due."
              control={
                <Switch
                  checked={form.email_enabled}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, email_enabled: v }))}
                  aria-label="Toggle email reminders"
                />
              }
            />
            {form.email_enabled && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-1">
                <div>
                  <Label className="text-xs">Email address</Label>
                  <Input
                    type="email"
                    value={form.email_address ?? ""}
                    placeholder={user?.email ?? "you@example.com"}
                    onChange={(e) => setForm((f) => ({ ...f, email_address: e.target.value }))}
                  />
                </div>
                <div>
                  <Label className="text-xs">Remind me</Label>
                  <Select
                    value={String(form.remind_minutes_before)}
                    onValueChange={(v) => setForm((f) => ({ ...f, remind_minutes_before: Number(v) }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">At due time</SelectItem>
                      <SelectItem value="5">5 minutes before</SelectItem>
                      <SelectItem value="15">15 minutes before</SelectItem>
                      <SelectItem value="30">30 minutes before</SelectItem>
                      <SelectItem value="60">1 hour before</SelectItem>
                      <SelectItem value="240">4 hours before</SelectItem>
                      <SelectItem value="1440">1 day before</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <Row
              title="Daily digest"
              description="Get a single morning email with all of today's follow-ups."
              control={
                <Switch
                  checked={form.daily_digest}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, daily_digest: v }))}
                  aria-label="Toggle daily digest"
                />
              }
            />
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save preferences
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ title, description, control }: { title: string; description: string; control: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 p-3 border rounded-lg">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      {control}
    </div>
  );
}
