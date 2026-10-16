import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Admin-only: change someone's CRM login email via the manage-users edge
 * function (service role). The password stays the same.
 */
export function ChangeLoginEmail({
  userId,
  currentEmail,
  name,
  size = "icon",
}: {
  userId: string;
  currentEmail: string | null;
  name?: string | null;
  size?: "icon" | "button";
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(currentEmail ?? "");

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("manage-users", {
        body: { action: "update_email", user_id: userId, email: email.trim() },
      });
      if (error) throw new Error(error.message);
      const res = data as { ok?: boolean; error?: string } | null;
      if (!res?.ok) throw new Error(res?.error || "Could not change the email");
    },
    onSuccess: () => {
      toast.success("Login email updated. Same password, new email.");
      qc.invalidateQueries({ queryKey: ["admin-team-users"] });
      qc.invalidateQueries({ queryKey: ["hrms-profiles"] });
      qc.invalidateQueries({ queryKey: ["hrms-employees"] });
      qc.invalidateQueries({ queryKey: ["documentation-team-users"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const unchanged = email.trim().toLowerCase() === (currentEmail ?? "").toLowerCase();

  return (
    <>
      {size === "icon" ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          title="Change login email"
          onClick={() => {
            setEmail(currentEmail ?? "");
            setOpen(true);
          }}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setEmail(currentEmail ?? "");
            setOpen(true);
          }}
        >
          <Pencil className="mr-1.5 h-3.5 w-3.5" /> Change login email
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change login email{name ? ` — ${name}` : ""}</DialogTitle>
            <DialogDescription>
              They will sign in with the new email and the same password. CRM alerts and
              documentation emails go to the new address.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="login-email">New email</Label>
            <Input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && valid && !unchanged) save.mutate();
              }}
            />
            {currentEmail && (
              <p className="text-xs text-muted-foreground">Current: {currentEmail}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!valid || unchanged || save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
