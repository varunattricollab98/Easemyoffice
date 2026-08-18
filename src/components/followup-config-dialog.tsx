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
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
  Mail,
  CalendarClock,
  Repeat,
  TimerOff,
  Sparkles,
  Send,
} from "lucide-react";

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

const pad = (n: number) => String(n).padStart(2, "0");

function toLocalInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const FREQUENCY_OPTIONS = [
  { value: "1", label: "Daily", description: "Every day" },
  { value: "2", label: "Alternate", description: "Every 2 days" },
  { value: "7", label: "Weekly", description: "Once a week" },
] as const;

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
  const getDefaultSendAt = () => {
    const d = new Date(Date.now() + 60 * 60000);
    d.setSeconds(0, 0);
    return toLocalInput(d);
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

  const estimatedEmails = Math.max(1, Math.floor(stopDays / Number(intervalDays)));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleCancel(); else onOpenChange(o); }}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        {/* Header with gradient accent */}
        <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-6 pt-6 pb-4">
          <DialogHeader className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <DialogTitle className="text-lg">Configure Email Reminders</DialogTitle>
            </div>
            <DialogDescription className="text-sm pl-10">
              Set up automated emails for{" "}
              <span className="font-medium text-foreground">{clientName}</span>
              {clientEmail ? (
                <Badge variant="secondary" className="ml-1.5 text-xs font-normal">{clientEmail}</Badge>
              ) : (
                <Badge variant="destructive" className="ml-1.5 text-xs font-normal">no email on file</Badge>
              )}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Form sections */}
        <div className="px-6 py-5 space-y-6">
          {/* Email Snippet Selection */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Email Template</Label>
            </div>
            <Select value={snippetId} onValueChange={setSnippetId}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Choose a template..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">
                  <span className="flex items-center gap-2">
                    Default template
                  </span>
                </SelectItem>
                {(snippets ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Start Date & Time with custom DateTimePicker */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Start Sending At</Label>
            </div>
            <DateTimePicker value={sendAt} onChange={setSendAt} />
            <p className="text-xs text-muted-foreground pl-6">
              First email goes out at this date and time
            </p>
          </div>

          {/* Frequency - Segmented Pill Toggle */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Repeat className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Frequency</Label>
            </div>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-muted/50 rounded-lg border">
              {FREQUENCY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setIntervalDays(opt.value)}
                  className={`
                    relative flex flex-col items-center gap-0.5 rounded-md px-3 py-2.5 text-sm font-medium
                    transition-all duration-200 ease-out
                    ${intervalDays === opt.value
                      ? "bg-background text-foreground shadow-sm ring-1 ring-border/50"
                      : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                    }
                  `}
                >
                  <span className="text-sm font-medium">{opt.label}</span>
                  <span className="text-[10px] text-muted-foreground font-normal">{opt.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Stop After X Days - Slider */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TimerOff className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-medium">Duration</Label>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="tabular-nums font-mono text-xs">
                  {stopDays} {stopDays === 1 ? "day" : "days"}
                </Badge>
              </div>
            </div>
            <div className="px-1">
              <Slider
                value={[stopDays]}
                onValueChange={([v]) => setStopDays(v)}
                min={1}
                max={60}
                step={1}
                className="w-full"
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
              <span>1 day</span>
              <span>60 days</span>
            </div>
            <div className="flex items-center gap-1.5 pl-6 text-xs text-muted-foreground">
              <Send className="h-3 w-3" />
              <span>~{estimatedEmails} email{estimatedEmails !== 1 ? "s" : ""} will be sent over {stopDays} day{stopDays !== 1 ? "s" : ""}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t bg-muted/30">
          <div className="flex items-center justify-between w-full gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={handleCancel}
              className="text-muted-foreground"
            >
              Skip (use defaults)
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={!clientEmail}
              className="gap-2 px-5"
            >
              <Send className="h-3.5 w-3.5" />
              Confirm Schedule
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
