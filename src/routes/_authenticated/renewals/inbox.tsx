import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Mail, ExternalLink, UserPlus, Search, RefreshCcw, ChevronLeft, ChevronRight, Hand } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fetchInbox,
  fetchThread,
  claimEmailInGmail,
  parseFrom,
  claimedOwner,
  parseWeb3FormLead,
  isThrowawayAddress,
  htmlToText,
  type InboxEmail,
  type ThreadMessage,
} from "@/lib/gmail";

// Renewals inbox reads the renewals@easemyoffice.in mailbox through the
// renewals-gmail-bridge edge function (the sales inbox uses "gmail-bridge").
const BRIDGE = "renewals-gmail-bridge" as const;
const PAGE_SIZE = 25;

export const Route = createFileRoute("/_authenticated/renewals/inbox")({
  head: () => ({ meta: [{ title: "Renewal Inbox — EaseMyOffice CRM" }] }),
  loader: ({ context }) => {
    context.queryClient.prefetchQuery({
      queryKey: ["renewal-inbox", 0],
      queryFn: () => fetchInbox(PAGE_SIZE, 0, BRIDGE),
      staleTime: 30 * 1000,
    });
  },
  component: RenewalInboxPage,
});

function esc(s: unknown) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildThreadHtml(messages: ThreadMessage[]) {
  const parts = (messages || []).map((m) => {
    const header = `<div style="font:12px/1.5 Arial,sans-serif;color:#64748b;margin:20px 0 8px">${esc(m.from)} &middot; ${esc(new Date(m.date).toLocaleString())}</div>`;
    const content = m.html && m.html.trim()
      ? m.html
      : `<pre style="white-space:pre-wrap;font:14px/1.6 Arial,sans-serif;color:#0f172a;margin:0">${esc(m.body)}</pre>`;
    return header + `<div>${content}</div>`;
  });
  const style = "<style>img{max-width:100%;height:auto}body{margin:0}blockquote{margin:0 0 0 8px}</style>";
  return `${style}<div style="font-family:Arial,Helvetica,sans-serif;padding:10px 14px;color:#0f172a;max-width:100%">${parts.join('<hr style="border:none;border-top:1px dashed #cbd5e1;margin:24px 0">')}</div>`;
}

type Filter = "all" | "unclaimed" | "mine";

function RenewalInboxPage() {
  const { user, profile, isAdmin } = useAuth();
  const qc = useQueryClient();
  const myName = profile?.full_name ?? "";
  const [filter, setFilter] = useState<Filter>(isAdmin ? "all" : "unclaimed");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [reading, setReading] = useState<InboxEmail | null>(null);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["renewal-inbox", page],
    queryFn: () => fetchInbox(PAGE_SIZE, page * PAGE_SIZE, BRIDGE),
    staleTime: 30 * 1000,
  });

  const emails = data?.emails ?? [];
  const notConnected = data && !data.ok;

  // Load the thread body for the reading dialog.
  const { data: thread } = useQuery({
    queryKey: ["renewal-gmail-thread", reading?.threadId],
    queryFn: () => fetchThread(reading!.threadId, BRIDGE),
    enabled: !!reading,
    staleTime: 60 * 1000,
  });

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return emails.filter((e) => {
      const owner = claimedOwner(e.labels);
      if (filter === "unclaimed" && owner) return false;
      if (filter === "mine" && (!owner || owner.toLowerCase() !== myName.toLowerCase().split(" ")[0] && owner.toLowerCase() !== myName.toLowerCase())) return false;
      if (!t) return true;
      return [e.from, e.subject, e.snippet].some((v) => String(v ?? "").toLowerCase().includes(t));
    });
  }, [emails, filter, q, myName]);

  const counts = useMemo(() => {
    let unclaimed = 0;
    let mine = 0;
    for (const e of emails) {
      const owner = claimedOwner(e.labels);
      if (!owner) unclaimed++;
      else if (owner.toLowerCase() === myName.toLowerCase() || owner.toLowerCase() === myName.toLowerCase().split(" ")[0]) mine++;
    }
    return { all: emails.length, unclaimed, mine };
  }, [emails, myName]);

  // Build the real renewal-lead fields from the email thread body.
  const resolveFields = async (email: InboxEmail) => {
    let messages: ThreadMessage[] = [];
    try {
      const t = await qc.fetchQuery({
        queryKey: ["renewal-gmail-thread", email.threadId],
        queryFn: () => fetchThread(email.threadId, BRIDGE),
        staleTime: 60 * 1000,
      });
      messages = t?.messages ?? [];
    } catch { /* header-only fallback */ }
    const bodyText = messages.map((m) => (m.body && m.body.trim() ? m.body : htmlToText(m.html || ""))).join("\n");
    const parsed = parseWeb3FormLead(bodyText);
    const fromParsed = parseFrom(email.from);
    const realEmail = parsed.email || (isThrowawayAddress(fromParsed.address) ? "" : fromParsed.address);
    const clientName =
      parsed.name || (isThrowawayAddress(fromParsed.address) ? "" : fromParsed.name) || realEmail || email.subject || "Renewal lead";
    const notes = [
      `From renewal email: ${email.subject}`,
      email.url,
      parsed.company ? `Company: ${parsed.company}` : "",
      parsed.message ? `Message: ${parsed.message}` : "",
    ].filter(Boolean).join("\n");
    return {
      client_name: clientName,
      email_id: realEmail || null,
      contact_no: parsed.phone || "",
      city: parsed.location || null,
      business_name: parsed.company || null,
    };
  };

  // Claim: create a renewal booking (renewal_status='pending') so it shows in
  // Renewal Leads/Pipeline, assigned to me, and label the Gmail thread.
  const claim = useMutation({
    mutationFn: async (email: InboxEmail) => {
      if (!user) throw new Error("Not signed in");
      const f = await resolveFields(email);
      const { error } = await supabase.from("bookings").insert({
        client_name: f.client_name,
        email_id: f.email_id,
        contact_no: f.contact_no,
        city: f.city,
        business_name: f.business_name,
        booking_source: "Email",
        sales_agent_name: myName || "Renewal Team",
        // plan_name is required (NOT NULL); the rep fills in the real plan later.
        plan_name: "Renewal (from email)",
        // Marks this as a renewal record so it appears in the Renewals section.
        renewal_status: "pending",
        renewal_assigned_to: user.id,
        renewal_stage_changed_at: new Date().toISOString(),
        // A plan expiry date is what the renewal pages key off; default to
        // today so it surfaces immediately for the rep to update.
        plan_expiry_date: new Date().toISOString().slice(0, 10),
        assigned_to: user.id,
        created_by: user.id,
      });
      if (error) throw new Error(error.message);
      const res = await claimEmailInGmail(email.threadId, `${myName || "Me"} lead`, BRIDGE);
      return { labelled: res.ok };
    },
    onSuccess: (r) => {
      toast.success(r.labelled ? "Added to Renewal Leads & labelled in Gmail" : "Added to Renewal Leads (Gmail label pending)");
      qc.invalidateQueries({ queryKey: ["renewal-inbox"] });
      qc.invalidateQueries({ queryKey: ["renewal-leads"] });
      qc.invalidateQueries({ queryKey: ["renewal-bookings-list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <Mail className="h-6 w-6 text-primary" /> Renewal Inbox
          </h1>
          <p className="text-sm text-muted-foreground">New emails from renewals@easemyoffice.in. Claim one to add it to Renewal Leads.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCcw className={cn("h-4 w-4 mr-1", isFetching && "animate-spin")} /> Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          {(["all", "unclaimed", "mine"] as Filter[]).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "ghost"} onClick={() => setFilter(f)} className="capitalize">
              {f === "mine" ? "My Leads" : f} <span className="ml-1 opacity-60">({counts[f]})</span>
            </Button>
          ))}
          <div className="relative flex-1 min-w-48">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search sender, subject…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 divide-y">
          {notConnected ? (
            <div className="p-10 text-center">
              <div className="text-muted-foreground">Renewals Gmail inbox isn't connected yet.</div>
              <div className="mt-2 text-xs text-destructive/80 max-w-lg mx-auto break-words">{data?.error}</div>
              <div className="mt-2 text-xs text-muted-foreground">Finish setup: deploy the renewals@ Apps Script + set RENEWALS_GMAIL_WEBHOOK_URL and RENEWALS_GMAIL_TOKEN.</div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">{isFetching ? "Loading…" : "No emails here."}</div>
          ) : filtered.map((e) => {
            const owner = claimedOwner(e.labels);
            const fromP = parseFrom(e.from);
            return (
              <div key={e.threadId} className="p-4 flex flex-wrap items-center gap-3 hover:bg-muted/30">
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setReading(e)}>
                  <div className="flex items-center gap-2">
                    <span className={cn("font-medium text-sm truncate", e.unread && "font-bold")}>{fromP.name || fromP.address || e.from}</span>
                    {owner ? <Badge variant="secondary" className="text-[10px]">{owner}</Badge> : <Badge variant="outline" className="text-[10px]">Unclaimed</Badge>}
                  </div>
                  <div className="text-sm truncate">{e.subject || "(no subject)"}</div>
                  <div className="text-xs text-muted-foreground truncate">{e.snippet}</div>
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">
                  {e.date ? formatDistanceToNow(new Date(e.date), { addSuffix: true }) : ""}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setReading(e)}>Read</Button>
                  {!owner && (
                    <Button size="sm" disabled={claim.isPending} onClick={() => claim.mutate(e)}>
                      <UserPlus className="h-3.5 w-3.5 mr-1" /> Claim
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {!notConnected && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Newer
          </Button>
          <span className="text-xs text-muted-foreground">Page {page + 1}</span>
          <Button variant="outline" size="sm" disabled={!data?.hasMore} onClick={() => setPage((p) => p + 1)}>
            Older <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      <Dialog open={!!reading} onOpenChange={(v) => { if (!v) setReading(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="pr-8">{reading?.subject || "(no subject)"}</DialogTitle>
          </DialogHeader>
          <div className="text-xs text-muted-foreground -mt-2">{reading ? parseFrom(reading.from).name || parseFrom(reading.from).address : ""}</div>
          {reading?.url && (
            <a href={reading.url} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1">
              Open in Gmail <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <div
            className="rounded-md border bg-white overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: thread?.messages ? buildThreadHtml(thread.messages) : "<div style='padding:24px;color:#64748b;font:14px Arial'>Loading…</div>" }}
          />
          {reading && !claimedOwner(reading.labels) && (
            <div className="flex justify-end">
              <Button disabled={claim.isPending} onClick={() => { claim.mutate(reading); setReading(null); }}>
                <Hand className="h-4 w-4 mr-1" /> Claim as my renewal lead
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
