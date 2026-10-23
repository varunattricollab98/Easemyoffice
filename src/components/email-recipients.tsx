// One recipient editor for every outgoing client email.
//
// A client can have several addresses — their own, an accountant's, a
// founder's — and before this the payment acknowledgment and the lead email
// each sent to exactly one, with a BCC hard-coded in the code. The quotation
// dialog had grown its own To-chips + CC UI; this is that pattern extracted so
// all of them behave the same.
//
// The primary address (the one on the lead or booking) cannot be removed —
// removing it would quietly send the client's own paperwork to someone else
// instead of to them. Extra addresses can be added and removed freely.

import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { clientRecipients, isEmailAddress, parseEmailList } from "@/lib/email-utils";

export interface Recipients {
  /** Everyone the client will see in To, in order. */
  to: string[];
  cc: string[];
  bcc: string[];
}

export interface UseEmailRecipientsOptions {
  /** The address on the record. Shown first and not removable. */
  primary?: string | null;
  /** Alternates we already hold (e.g. a booking's alternate email). */
  alsoTo?: (string | null | undefined)[];
  /** Pre-filled BCC, e.g. the shared inbox. The user can still edit it. */
  defaultBcc?: string;
  /** Re-seed the fields when a dialog opens. */
  resetKey?: unknown;
}

/**
 * Returns the resolved recipients plus the fields to render. Follows the
 * `useLoginOptions` shape already used in this codebase: state and markup
 * together, so a caller cannot wire half of it.
 */
export function useEmailRecipients(options: UseEmailRecipientsOptions = {}) {
  const { primary, alsoTo, defaultBcc = "", resetKey } = options;

  const seeded = useMemo(() => clientRecipients(primary, ...(alsoTo ?? [])), [primary, alsoTo]);

  const [extra, setExtra] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState(defaultBcc);

  useEffect(() => {
    setExtra([]);
    setDraft("");
    setCc("");
    setBcc(defaultBcc);
  }, [resetKey, defaultBcc]);

  const to = useMemo(() => clientRecipients(...seeded, ...extra), [seeded, extra]);
  const ccList = useMemo(() => parseEmailList(cc), [cc]);
  const bccList = useMemo(() => parseEmailList(bcc), [bcc]);

  const add = () => {
    const value = draft.trim();
    if (!isEmailAddress(value)) {
      toast.error("Enter a valid email address");
      return;
    }
    if (to.some((e) => e.toLowerCase() === value.toLowerCase())) {
      toast.error("That email is already added");
      return;
    }
    setExtra((list) => [...list, value]);
    setDraft("");
  };

  const recipients: Recipients = { to, cc: ccList, bcc: bccList };

  const fields = (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">
          To <span className="font-normal text-muted-foreground">(add more if needed)</span>
        </Label>
        {to.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {to.map((email) => {
              const locked = seeded.some((e) => e.toLowerCase() === email.toLowerCase());
              return (
                <span
                  key={email}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2.5 py-1 text-xs"
                >
                  {email}
                  {!locked && (
                    <button
                      type="button"
                      aria-label={`Remove ${email}`}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        setExtra((list) =>
                          list.filter((e) => e.toLowerCase() !== email.toLowerCase()),
                        )
                      }
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="Add another recipient email"
            type="email"
          />
          <Button type="button" variant="outline" onClick={add} disabled={!draft.trim()}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">
            CC <span className="font-normal text-muted-foreground">(comma-separated)</span>
          </Label>
          <Input
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            placeholder="accounts@company.com, founder@company.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">
            BCC <span className="font-normal text-muted-foreground">(comma-separated)</span>
          </Label>
          <Input
            value={bcc}
            onChange={(e) => setBcc(e.target.value)}
            placeholder="contact@easemyoffice.in"
          />
        </div>
      </div>
    </div>
  );

  return { recipients, fields, hasRecipients: to.length > 0 };
}
