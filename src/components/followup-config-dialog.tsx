import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type EmailConfig = {
  snippetId?: string;
  intervalDays: number;
  stopDays: number;
  sendAt: string;
};

type FollowupConfigDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  clientName: string;
  clientEmail?: string | null;
  userId: string;
  onConfirm: (config: EmailConfig) => void;
  onCancel?: () => void;
};

export function FollowupConfigDialog({
  open,
  onOpenChange,
  leadId: _leadId,
  clientName,
  clientEmail,
  userId: _userId,
  onConfirm,
  onCancel,
}: FollowupConfigDialogProps) {
  // Default: 1 hour from now
  const getDefaultSendAt = () => {
    const d = new Date(Date.now() + 60 * 60000);
    d.setSeconds(0, 0);
    return d.toISOString().slice(0, 16);
  };

  const [snippetId, setSnippetId] = useState<string>("default");
  const [intervalDays, setIntervalDays] = useState<string>("1");
  const [stopDays, setStopDays] = useState<number>(7);
  const [sendAt, setSendAt] = useState<string>(getDefaultSendAt);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setSnippetId("default");
      setIntervalDays("1");
      setStopDays(7);
      setSendAt(getDefaultSendAt());
    }
  }, [open]);

  // Fetch email snippets
  const { data: snippets } = useQuery({
    queryKey: ["email-snippets-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("email_snippets")
        .select("id, name, subject, body_html")
        .order("name");
      return data ?? [];
    },
    enabled: open,
  });

  const handleConfirm = () => {
    const config: EmailConfig = {
      snippetId: snippetId === "default" ? undefined : snippetId,
      intervalDays: Number(intervalDays),
      stopDays,
      sendAt: new Date(sendAt).toISOString(),
    };
    onConfirm(config);
    onOpenChange(false);
  };

  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleCancel(); else onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Configure Email Reminders</DialogTitle>
          <DialogDescription>
            Set up automated email reminders for{" "}
            <span className="font-medium text-foreground">{clientName}</span>
            {clientEmail ? ` (${clientEmail})` : " (no email on file)"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Email Snippet Selection */}
          <div className="space-y-1.5">
            <Label className="text-xs">Email Snippet</Label>
            <Select value={snippetId} onValueChange={setSnippetId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a snippet" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default template</SelectItem>
                {(snippets ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Start Date & Time */}
          <div className="space-y-1.5">
            <Label className="text-xs">Start sending at</Label>
            <Input
              type="datetime-local"
              value={sendAt}
              min={new Date().toISOString().slice(0, 16)}
              onChange={(e) => setSendAt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              First email will be sent at this date and time
            </p>
          </div>

          {/* Frequency */}
          <div className="space-y-1.5">
            <Label className="text-xs">Frequency</Label>
            <Select value={intervalDays} onValueChange={setIntervalDays}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Daily</SelectItem>
                <SelectItem value="2">Alternate days</SelectItem>
                <SelectItem value="7">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Stop After X Days */}
          <div className="space-y-1.5">
            <Label className="text-xs">Stop after (days)</Label>
            <Input
              type="number"
              min={1}
              max={365}
              value={stopDays}
              onChange={(e) => setStopDays(Math.max(1, Number(e.target.value)))}
            />
            <p className="text-xs text-muted-foreground">
              Email reminders will stop after this many days
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleCancel}>
            Cancel (use defaults)
          </Button>
          <Button onClick={handleConfirm} disabled={!clientEmail}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
