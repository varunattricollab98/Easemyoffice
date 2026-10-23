import { useState } from "react";
import { CalendarOff, Clock, Home, Loader2, SunMedium } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { hrRequest, type Fix } from "@/lib/attendance-client";
import { istParts } from "@/lib/attendance-rules";
import { cn, getErrorMessage } from "@/lib/utils";

export type LoginOption = "late" | "wfh" | "half_day" | "leave";

/**
 * "late": the person can log in (at the office) but is past the on-time start.
 * "blocked": the login was refused (outside the office, poor GPS, too many
 * attempts), so a normal login is not possible right now.
 */
export type LoginOptionsMode = "late" | "blocked";

export interface LoginOptionsOffer {
  mode: LoginOptionsMode;
  fix: Fix;
  message: string;
  /**
   * False once it is too late for a full day (see `lateLoginAllowed`): the
   * "Late login" choice is withdrawn and Half day becomes the default, so
   * nobody can book a full day they cannot work.
   */
  allowLate?: boolean;
}

export interface PunchOpts {
  remote?: boolean;
  reason?: string;
  fix?: Fix;
  lateReason?: string;
}

const OPTIONS: {
  id: LoginOption;
  label: string;
  hint: Record<LoginOptionsMode, string>;
  icon: typeof Clock;
}[] = [
  {
    id: "late",
    label: "Late login",
    hint: {
      late: "Log in now; the reason is saved with today's attendance.",
      blocked: "Sends your login time to the admin for approval.",
    },
    icon: Clock,
  },
  {
    id: "wfh",
    label: "Work from home",
    hint: {
      late: "Log in from home; the admin approves the day.",
      blocked: "Log in from home; the admin approves the day.",
    },
    icon: Home,
  },
  {
    id: "half_day",
    label: "Half day",
    hint: {
      late: "Half-day leave request, then log in now.",
      blocked: "Sends a half-day leave request for today.",
    },
    icon: SunMedium,
  },
  {
    id: "leave",
    label: "Leave",
    hint: {
      late: "Full-day leave request for today. No login.",
      blocked: "Full-day leave request for today. No login.",
    },
    icon: CalendarOff,
  },
];

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * Late or refused login: the person picks Late login / Work from home / Half
 * day / Leave and gives a reason. Punch-based choices go through `doPunch`
 * (the caller's punch mutation); leave and approval requests go to hr-requests.
 */
export function useLoginOptions({
  doPunch,
  onRequestSent,
}: {
  doPunch: (opts: PunchOpts) => void;
  onRequestSent: () => void;
}) {
  const [offer, setOffer] = useState<LoginOptionsOffer | null>(null);
  const [choice, setChoice] = useState<LoginOption>("late");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const open = (o: LoginOptionsOffer) => {
    setChoice(o.allowLate === false ? "half_day" : o.mode === "late" ? "late" : "wfh");
    setReason("");
    setOffer(o);
  };
  const close = () => setOffer(null);

  const submit = async () => {
    if (!offer) return;
    const r = reason.trim();
    const today = istParts(new Date()).date;
    try {
      setBusy(true);
      if (choice === "wfh") {
        close();
        doPunch({ remote: true, reason: r, fix: offer.fix });
      } else if (choice === "late") {
        if (offer.mode === "late") {
          close();
          doPunch({ fix: offer.fix, lateReason: r });
        } else {
          await hrRequest({
            action: "apply_attendance_request",
            type: "missed_login_regularization",
            work_date: today,
            reason: `Late login: ${r}`,
            login: hhmm(istParts(new Date()).minutes),
          });
          toast.success("Late login sent to the admin for approval");
          onRequestSent();
          close();
        }
      } else {
        const half = choice === "half_day";
        await hrRequest({
          action: "apply_leave",
          from: today,
          to: today,
          half_day: half,
          reason: r,
        });
        if (half && offer.mode === "late") {
          close();
          doPunch({ fix: offer.fix, lateReason: `Half day: ${r}` });
          toast.success("Half-day leave sent to the admin");
        } else {
          toast.success(
            half ? "Half-day leave sent to the admin" : "Leave request sent to the admin",
          );
          onRequestSent();
          close();
        }
      }
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const dialog = (
    <Dialog open={!!offer} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-w-md">
        {offer && (
          <>
            <DialogHeader>
              <DialogTitle>
                {offer.allowLate === false
                  ? "Too late for a full day"
                  : offer.mode === "late"
                    ? "You are logging in late"
                    : "Can't log in normally"}
              </DialogTitle>
              <DialogDescription>{offer.message} Choose one and add a reason.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Login option">
              {OPTIONS.filter((o) => o.id !== "late" || offer.allowLate !== false).map((o) => {
                const active = choice === o.id;
                const Icon = o.icon;
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setChoice(o.id)}
                    className={cn(
                      "rounded-xl border p-3 text-left transition",
                      active
                        ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                        : "hover:bg-muted/50",
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-sm font-semibold">
                      <Icon className="h-4 w-4" />
                      {o.label}
                    </div>
                    <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
                      {o.hint[offer.mode]}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Reason</Label>
              <Textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Stuck in traffic, client meeting, feeling unwell…"
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button disabled={busy || reason.trim().length < 3} onClick={() => void submit()}>
                {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Submit
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );

  return { open, dialog };
}
