import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Mail, ExternalLink, UserPlus, Search, RefreshCcw, ChevronLeft, ChevronRight, Hand, Reply, Send, FileText } from "lucide-react";
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
import { SendQuotationDialog } from "@/components/send-quotation-dialog";

// Renewals inbox reads the renewals@easemyoffice.in mailbox through the
// renewals-gmail-bridge edge function (the sales inbox uses "gmail-bridge").
const BRIDGE = "renewals-gmail-bridge" as const;
const PAGE_SIZE = 25;
// Renewal emails go OUT from the renewals mailbox (safeFrom in send-client-email
// allows any @easemyoffice.in sender). A BCC keeps a copy in its Sent folder.
const RENEWALS_FROM = "EaseMyOffice Renewals <renewals@easemyoffice.in>";
const RENEWALS_BCC = "renewals@easemyoffice.in";

// Built-in plain-text templates (same set as the sales inbox), plus any custom
// snippets from the shared email_snippets table.
const TEMPLATES = [
  { id: "quotation", label: "Quotation" },
  { id: "welcome", label: "Welcome / Intro" },
  { id: "followup", label: "Renewal follow-up" },
  { id: "documents", label: "Documents required" },
  { id: "payment", label: "Payment reminder" },
  { id: "thankyou", label: "Thank you" },
  { id: "custom", label: "Blank (write my own)" },
] as const;

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
  // Reply composer
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replySnippetId, setReplySnippetId] = useState("custom");
  // Inline (plain-text) quotation composer
  const [quotationOpen, setQuotationOpen] = useState(false);
  const [quotationSubject, setQuotationSubject] = useState("");
  const [quotationBody, setQuotationBody] = useState("");
  const [quotationSnippetId, setQuotationSnippetId] = useState("quotation");
  // Premium (branded HTML) quotation dialog
  const [premiumOpen, setPremiumOpen] = useState(false);

  // Reset composers when a different email is opened.
  useEffect(() => {
    setReplyOpen(false); setReplyText(""); setReplySnippetId("custom");
    setQuotationOpen(false); setQuotationBody(""); setQuotationSnippetId("quotation");
  }, [reading?.threadId]);

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

  // Shared custom snippets (same table the sales inbox uses).
  const { data: emailSnippets = [] } = useQuery({
    queryKey: ["email-snippets-list"],
    queryFn: async () => {
      const { data } = await supabase.from("email_snippets").select("id, name, subject, body_html").order("name");
      return (data ?? []) as { id: string; name: string; subject: string; body_html: string }[];
    },
    enabled: quotationOpen || replyOpen,
  });

  // Real customer reply address: parse the thread body, skip relay/throwaway.
  const replyTo = useMemo(() => {
    if (!reading) return null;
    const msgs = thread?.messages ?? [];
    const bodyText = msgs.map((m) => (m.body && m.body.trim() ? m.body : htmlToText(m.html || ""))).join("\n");
    const parsed = parseWeb3FormLead(bodyText);
    if (parsed.email && !isThrowawayAddress(parsed.email)) return parsed.email;
    for (const m of msgs) {
      const a = parseFrom(m.from).address;
      if (a && !isThrowawayAddress(a)) return a;
    }
    const a = parseFrom(reading.from).address;
    return a && !isThrowawayAddress(a) ? a : null;
  }, [reading, thread]);

  const replySubject = reading
    ? (/^\s*re:/i.test(reading.subject || "") ? (reading.subject || "") : `Re: ${reading.subject || "(no subject)"}`)
    : "";

  // Build a plain-text template body (+ subject) for a built-in template id.
  const buildTemplate = (id: string, clientName: string): { subject: string; body: string } => {
    const name = clientName || "there";
    const sign = `\n\nWarm regards,\n${myName || "Team EaseMyOffice"}\nEaseMyOffice Renewals`;
    switch (id) {
      case "welcome":
        return { subject: `Welcome — EaseMyOffice`, body: `Dear ${name},\n\nThank you for connecting with EaseMyOffice. We're here to help with your renewal.${sign}` };
      case "followup":
        return { subject: `Renewal follow-up — EaseMyOffice`, body: `Dear ${name},\n\nJust following up on your upcoming renewal. Please let us know if you'd like to proceed so we can keep your services active without interruption.${sign}` };
      case "documents":
        return { subject: `Documents required — EaseMyOffice`, body: `Dear ${name},\n\nTo process your renewal, please share the following documents:\n\n• [document 1]\n• [document 2]${sign}` };
      case "payment":
        return { subject: `Payment reminder — EaseMyOffice`, body: `Dear ${name},\n\nThis is a gentle reminder for the pending renewal payment. Kindly complete it at your earliest so your services continue uninterrupted.${sign}` };
      case "thankyou":
        return { subject: `Thank you — EaseMyOffice`, body: `Dear ${name},\n\nThank you for renewing with EaseMyOffice. We truly value your continued trust.${sign}` };
      case "custom":
        return { subject: replySubject, body: "" };
      case "quotation":
      default:
        return { subject: `Renewal Quotation — EaseMyOffice`, body: `Dear ${name},\n\nHere is your renewal quotation:\n\n• Service: [service]\n• Price: [enter amount]\n• Validity: 15 days\n\nPlease let me know if you have any questions.${sign}` };
    }
  };

  const snippetToPlain = (bodyHtml: string) =>
    bodyHtml ? bodyHtml.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ") : "";

  const clientNameFromThread = () => {
    const msgs = thread?.messages ?? [];
    const bodyText = msgs.map((m) => (m.body && m.body.trim() ? m.body : htmlToText(m.html || ""))).join("\n");
    return parseWeb3FormLead(bodyText).name || "";
  };

  const applyReplyTemplate = (id: string) => {
    setReplySnippetId(id);
    const snip = emailSnippets.find((s) => s.id === id);
    if (snip) setReplyText(snippetToPlain(snip.body_html));
    else setReplyText(buildTemplate(id, clientNameFromThread()).body);
  };

  const applyQuotationTemplate = (id: string) => {
    setQuotationSnippetId(id);
    const snip = emailSnippets.find((s) => s.id === id);
    if (snip) { setQuotationBody(snippetToPlain(snip.body_html)); if (snip.subject) setQuotationSubject(snip.subject); }
    else { const t = buildTemplate(id, clientNameFromThread()); setQuotationBody(t.body); setQuotationSubject(t.subject); }
  };

  const openQuotationComposer = () => {
    const t = buildTemplate("quotation", clientNameFromThread());
    setQuotationSubject(t.subject);
    setQuotationBody(t.body);
    setQuotationSnippetId("quotation");
    setQuotationOpen(true);
  };

  // Send a plain-text email (reply or inline quotation) FROM the renewals mailbox.
  const sendEmail = useMutation({
    mutationFn: async (vars: { to: string; subject: string; text: string }) => {
      const { data, error } = await supabase.functions.invoke("send-client-email", {
        body: { to: vars.to, subject: vars.subject, text: vars.text, from: RENEWALS_FROM, bcc: RENEWALS_BCC, replyTo: user?.email, created_by: user?.id },
      });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) throw new Error(data.error || "Send failed");
      return data;
    },
    onSuccess: () => {
      toast.success("Email sent from renewals@ — a copy is in its Sent folder");
      setReplyText(""); setReplyOpen(false);
      setQuotationOpen(false); setQuotationBody("");
    },
    onError: (e: Error) => toast.error(e.message),
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

          {/* Inline reply composer */}
          {replyOpen && (
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground truncate">Reply to <b>{replyTo}</b> — from renewals@easemyoffice.in</div>
                <Select value={replySnippetId} onValueChange={applyReplyTemplate}>
                  <SelectTrigger className="h-8 w-56"><SelectValue placeholder="Template" /></SelectTrigger>
                  <SelectContent>
                    {TEMPLATES.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                    {emailSnippets.length > 0 && <SelectItem value="__div" disabled>--- Custom Snippets ---</SelectItem>}
                    {emailSnippets.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Textarea rows={6} value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Write your reply…" />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setReplyOpen(false)}>Cancel</Button>
                <Button size="sm" disabled={sendEmail.isPending || !replyText.trim() || !replyTo} onClick={() => sendEmail.mutate({ to: replyTo as string, subject: replySubject, text: replyText.trim() })}>
                  <Send className="h-4 w-4 mr-1" /> {sendEmail.isPending ? "Sending…" : "Send reply"}
                </Button>
              </div>
            </div>
          )}

          {/* Inline quotation composer */}
          {quotationOpen && (
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground truncate">Quotation to <b>{replyTo}</b> — from renewals@easemyoffice.in</div>
                <Select value={quotationSnippetId} onValueChange={applyQuotationTemplate}>
                  <SelectTrigger className="h-8 w-56"><SelectValue placeholder="Template" /></SelectTrigger>
                  <SelectContent>
                    {TEMPLATES.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                    {emailSnippets.length > 0 && <SelectItem value="__div" disabled>--- Custom Snippets ---</SelectItem>}
                    {emailSnippets.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Subject</Label><Input value={quotationSubject} onChange={(e) => setQuotationSubject(e.target.value)} /></div>
              <Textarea rows={8} value={quotationBody} onChange={(e) => setQuotationBody(e.target.value)} placeholder="Quotation body…" />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setQuotationOpen(false)}>Cancel</Button>
                <Button size="sm" disabled={sendEmail.isPending || !quotationBody.trim() || !replyTo} onClick={() => sendEmail.mutate({ to: replyTo as string, subject: quotationSubject || "Renewal Quotation — EaseMyOffice", text: quotationBody.trim() })}>
                  <Send className="h-4 w-4 mr-1" /> {sendEmail.isPending ? "Sending…" : "Send quotation"}
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {replyTo && !replyOpen && (
              <Button size="sm" onClick={() => setReplyOpen(true)}><Reply className="h-4 w-4 mr-1" /> Reply</Button>
            )}
            {replyTo && !quotationOpen && (
              <Button size="sm" variant="secondary" onClick={openQuotationComposer}><FileText className="h-4 w-4 mr-1" /> Send Quotation</Button>
            )}
            {replyTo && (
              <Button size="sm" variant="default" onClick={() => setPremiumOpen(true)}><FileText className="h-4 w-4 mr-1" /> Premium Quotation</Button>
            )}
            {reading && !claimedOwner(reading.labels) && (
              <Button variant="outline" disabled={claim.isPending} onClick={() => { claim.mutate(reading); setReading(null); }}>
                <Hand className="h-4 w-4 mr-1" /> Claim as my renewal lead
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Premium (branded HTML) quotation — sent from the renewals mailbox */}
      {replyTo && (
        <SendQuotationDialog
          open={premiumOpen}
          onOpenChange={setPremiumOpen}
          clientName={clientNameFromThread()}
          clientEmail={replyTo}
          fromEmail={RENEWALS_FROM}
          bccEmail={RENEWALS_BCC}
          onSent={() => toast.success("Premium quotation sent from renewals@")}
        />
      )}
    </div>
  );
}
