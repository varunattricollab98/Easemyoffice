import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Mail, ExternalLink, UserPlus, Search, RefreshCcw, ChevronLeft, ChevronRight, CheckCircle2, Hand, Reply, Send } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { fetchInbox, fetchThread, claimEmailInGmail, parseFrom, claimedOwner, normalizeOwnerTag, parseWeb3FormLead, isThrowawayAddress, htmlToText, type InboxEmail, type ThreadMessage } from "@/lib/gmail";

function esc(s: unknown) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Stitch every message in the thread into one continuous HTML document, so the
// whole conversation reads in a single scroll (no separate boxes per message).
function buildThreadHtml(messages: { from: string; date: string; html?: string; body: string }[]) {
  const sep = '<div style="border-top:2px solid #94a3b8;margin:24px 0 12px;padding-top:12px;font:11px Arial,sans-serif;color:#64748b;letter-spacing:.05em;text-transform:uppercase">\u2014 older message \u2014</div>';
  // Draw a separator line before quoted/older replies. Covers the common
  // "On <date>, <name> wrote:" divider and the "-----Original Message-----" style,
  // plus Gmail's .gmail_quote container.
  const withSeparators = (html: string) =>
    html
      .replace(/(On\b[^<>]{3,160}?wrote:)/i, sep + "$1")
      .replace(/(-{2,}\s*Original Message\s*-{2,})/i, sep + "$1")
      .replace(/(<(?:div|blockquote)[^>]*class="[^"]*gmail_quote[^"]*"[^>]*>)/i, (mtch, p1) =>
        html.includes("wrote:") ? p1 : sep + p1,
      );
  const parts = (messages || []).map((m) => {
    const header = `<div style="font:12px/1.5 Arial,sans-serif;color:#64748b;margin:20px 0 8px">📧 <b style="color:#0f172a">${esc(m.from)}</b> · ${esc(new Date(m.date).toLocaleString())}</div>`;
    const content = m.html && m.html.trim()
      ? withSeparators(m.html)
      : `<pre style="white-space:pre-wrap;font:14px/1.6 Arial,sans-serif;color:#0f172a;margin:0">${esc(m.body)}</pre>`;
    return header + `<div>${content}</div>`;
  });
  const style = "<style>img{max-width:100%;height:auto}body{margin:0}blockquote{margin:0 0 0 8px}</style>";
  return `${style}<div style="font-family:Arial,Helvetica,sans-serif;padding:10px 14px;color:#0f172a;max-width:100%">${parts.join('<hr style="border:none;border-top:1px dashed #cbd5e1;margin:24px 0">')}</div>`;
}

export const Route = createFileRoute("/_authenticated/inbox")({
  head: () => ({ meta: [{ title: "Lead Inbox — EaseMyOffice CRM" }] }),
  component: LeadInboxPage,
});

type Filter = "all" | "unclaimed" | "mine";

type TeamMember = { id: string; full_name: string | null; email: string | null };

// Map a Gmail owner tag ("Hardik's", "Kishan") to a team member by name.
// Tries exact full-name, then first-name, then a "starts with" match.
function matchOwnerToUser(ownerTag: string | null, team: TeamMember[]): TeamMember | null {
  const norm = normalizeOwnerTag(ownerTag).toLowerCase();
  if (!norm) return null;
  const byFull = team.find((p) => (p.full_name || "").trim().toLowerCase() === norm);
  if (byFull) return byFull;
  const byFirst = team.find((p) => (p.full_name || "").trim().toLowerCase().split(/\s+/)[0] === norm);
  if (byFirst) return byFirst;
  const byStarts = team.find((p) => (p.full_name || "").trim().toLowerCase().startsWith(norm + " "));
  return byStarts ?? null;
}

function LeadInboxPage() {
  const { user, profile, isAdmin } = useAuth();
  const qc = useQueryClient();
  const myName = profile?.full_name ?? "";
  const [filter, setFilter] = useState<Filter>(isAdmin ? "all" : "unclaimed");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [reading, setReading] = useState<InboxEmail | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const PAGE_SIZE = 25;

  const threadQ = useQuery({
    queryKey: ["gmail-thread", reading?.threadId],
    enabled: !!reading,
    queryFn: () => fetchThread(reading!.threadId),
  });

  // Reset the reply composer whenever a different email is opened / closed.
  useEffect(() => { setReplyOpen(false); setReplyText(""); }, [reading?.threadId]);

  // Who a reply should go to: the real customer address. Web3Forms relays put
  // the customer's email in the body, so parse that first; otherwise fall back
  // to the first non-relay sender in the thread.
  const replyTo = useMemo(() => {
    if (!reading) return null;
    const msgs = threadQ.data?.messages ?? [];
    const bodyText = msgs.map((m) => (m.body && m.body.trim() ? m.body : htmlToText(m.html || ""))).join("\n");
    const parsed = parseWeb3FormLead(bodyText);
    if (parsed.email && !isThrowawayAddress(parsed.email)) return parsed.email;
    for (const m of msgs) {
      const a = parseFrom(m.from).address;
      if (a && !isThrowawayAddress(a)) return a;
    }
    const a = parseFrom(reading.from).address;
    return a && !isThrowawayAddress(a) ? a : null;
  }, [reading, threadQ.data]);

  const replySubject = reading
    ? (/^\s*re:/i.test(reading.subject || "") ? (reading.subject || "") : `Re: ${reading.subject || "(no subject)"}`)
    : "";

  // Send a reply to the customer via Resend (send-client-email). The function
  // sends from the CRM address and BCCs the shared inbox, so a copy threads in
  // Gmail and is labelled CRM-Sent.
  const reply = useMutation({
    mutationFn: async (vars: { to: string; subject: string; text: string }) => {
      const { data, error } = await supabase.functions.invoke("send-client-email", {
        body: { to: vars.to, subject: vars.subject, text: vars.text },
      });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) throw new Error(data.error || "Send failed");
      return data;
    },
    onSuccess: () => {
      toast.success("Reply sent — a copy is saved to the shared inbox");
      setReplyText("");
      setReplyOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["lead-inbox", page],
    staleTime: 3 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    queryFn: () => fetchInbox(PAGE_SIZE, page * PAGE_SIZE),
  });

  const emails = data?.emails ?? [];
  const connected = data?.ok ?? false;
  const hasMore = data?.hasMore ?? false;

  // Team members — used to map a Gmail owner tag (e.g. "Hardik's") to the
  // actual salesperson so tagged emails can flow into *their* leads.
  const { data: team = [] } = useQuery({
    queryKey: ["inbox-team"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").order("full_name");
      return (data ?? []) as TeamMember[];
    },
  });

  // Existing email-sourced leads — to dedup (avoid re-creating) and to show
  // which inbox emails already became leads.
  const { data: emailLeads = [] } = useQuery({
    queryKey: ["email-leads"],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from("leads").select("id, email, assigned_to").eq("source", "email" as never);
      return (data ?? []) as { id: string; email: string | null; assigned_to: string | null }[];
    },
  });

  const leadByEmail = useMemo(() => {
    const m = new Map<string, { id: string; assigned_to: string | null }>();
    for (const l of emailLeads) if (l.email) m.set(l.email.trim().toLowerCase(), { id: l.id, assigned_to: l.assigned_to });
    return m;
  }, [emailLeads]);

  // Warm up the next page in the background so "Older" opens instantly.
  useEffect(() => {
    if (connected && hasMore) {
      qc.prefetchQuery({
        queryKey: ["lead-inbox", page + 1],
        queryFn: () => fetchInbox(PAGE_SIZE, (page + 1) * PAGE_SIZE),
        staleTime: 60 * 1000,
      });
    }
  }, [connected, hasMore, page, qc]);

  // Prefetch a thread's full content when the user hovers a row, so the reader opens instantly.
  const prefetchThread = (threadId: string) =>
    qc.prefetchQuery({ queryKey: ["gmail-thread", threadId], queryFn: () => fetchThread(threadId), staleTime: 60 * 1000 });

  // Resolve REAL lead fields for an inbox email by reading the thread body.
  // Web3Forms / contact-form submissions carry the customer's actual name,
  // email, phone & location in the body — the sender is only a relay address
  // (e.g. notify+xxx@web3forms.com), so we must parse the body, not the header.
  const resolveLeadFields = async (email: InboxEmail) => {
    let messages: ThreadMessage[] = [];
    try {
      const thread = await qc.fetchQuery({
        queryKey: ["gmail-thread", email.threadId],
        queryFn: () => fetchThread(email.threadId),
        staleTime: 60 * 1000,
      });
      messages = thread?.messages ?? [];
    } catch { /* fall back to header-only fields below */ }

    const bodyText = messages
      .map((m) => (m.body && m.body.trim() ? m.body : htmlToText(m.html || "")))
      .join("\n");
    const parsed = parseWeb3FormLead(bodyText);

    const fromParsed = parseFrom(email.from);
    const senderAddr = fromParsed.address.trim().toLowerCase();
    const realEmail = parsed.email || (isThrowawayAddress(fromParsed.address) ? "" : fromParsed.address);
    const clientName =
      parsed.name ||
      (isThrowawayAddress(fromParsed.address) ? "" : fromParsed.name) ||
      realEmail ||
      email.subject ||
      "Email lead";

    const notes = [
      `From email: ${email.subject}`,
      email.url,
      parsed.location ? `Location: ${parsed.location}` : "",
      parsed.company ? `Company: ${parsed.company}` : "",
      parsed.message ? `Message: ${parsed.message}` : "",
    ].filter(Boolean).join("\n");

    return {
      fields: {
        client_name: clientName,
        email: realEmail || null,
        mobile: parsed.phone || "",
        city: parsed.location || null,
        company_name: parsed.company || null,
        source: "email" as never,
        notes,
      },
      // Dedup keys: the real customer email AND the throwaway sender address
      // (covers new leads and any created before this parsing existed).
      dedupKeys: [realEmail.trim().toLowerCase(), senderAddr].filter(Boolean),
    };
  };

  // Find an existing email-lead by any of the dedup keys (real email / sender).
  const existingLeadFor = (dedupKeys: string[]) => {
    for (const k of dedupKeys) {
      const hit = leadByEmail.get(k);
      if (hit) return hit;
    }
    return undefined;
  };

  const claim = useMutation({
    mutationFn: async (email: InboxEmail) => {
      if (!user) throw new Error("Not signed in");
      const { fields, dedupKeys } = await resolveLeadFields(email);
      const existing = existingLeadFor(dedupKeys);
      // 1) Create (or, if it somehow already exists, take over) the lead as mine.
      if (existing) {
        if (existing.assigned_to !== user.id) {
          // .select() so we can detect a silent RLS denial (0 rows changed, no
          // error) — otherwise the lead stays owned by someone else and never
          // shows in this rep's Pipeline/Leads despite the "Claimed" toast.
          const { data: moved, error } = await supabase.from("leads").update({ assigned_to: user.id }).eq("id", existing.id).select("id");
          if (error) throw new Error(error.message);
          if (!moved || moved.length === 0) throw new Error("Couldn't claim this lead — it's already assigned to another rep. Ask an admin to reassign it to you.");
        }
      } else {
        const { error } = await supabase.from("leads").insert({
          ...fields,
          assigned_to: user.id,
          created_by: user.id,
        });
        if (error) throw new Error(error.message);
      }
      // 2) Label the Gmail thread with my name (best-effort).
      const res = await claimEmailInGmail(email.threadId, `${myName || "Me"} lead`);
      return { labelled: res.ok };
    },
    onSuccess: (r) => {
      toast.success(r.labelled ? "Claimed — added to your leads & labelled in Gmail" : "Added to your leads (Gmail label pending)");
      qc.invalidateQueries({ queryKey: ["lead-inbox"] });
      qc.invalidateQueries({ queryKey: ["email-leads"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Take over an already-tagged email: move (or create) the lead under ME and
  // relabel the Gmail thread with my name.
  const markMine = useMutation({
    mutationFn: async (email: InboxEmail) => {
      if (!user) throw new Error("Not signed in");
      const { fields, dedupKeys } = await resolveLeadFields(email);
      const existing = existingLeadFor(dedupKeys);
      if (existing) {
        if (existing.assigned_to !== user.id) {
          const { data: moved, error } = await supabase.from("leads").update({ assigned_to: user.id }).eq("id", existing.id).select("id");
          if (error || !moved || moved.length === 0) throw new Error("Couldn't reassign this lead — it may belong to another rep. Ask an admin to move it.");
        }
      } else {
        const { error } = await supabase.from("leads").insert({
          ...fields,
          assigned_to: user.id,
          created_by: user.id,
        });
        if (error) throw new Error(error.message);
      }
      const res = await claimEmailInGmail(email.threadId, `${myName || "Me"} lead`);
      return { labelled: res.ok };
    },
    onSuccess: (r) => {
      toast.success(r.labelled ? "Marked as yours — moved to your leads & relabelled in Gmail" : "Marked as yours (Gmail label pending)");
      qc.invalidateQueries({ queryKey: ["lead-inbox"] });
      qc.invalidateQueries({ queryKey: ["email-leads"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Admin-only: assign (or reassign) an email's lead to ANY team member and
  // relabel the Gmail thread with that person's name.
  const assign = useMutation({
    mutationFn: async ({ email, target }: { email: InboxEmail; target: TeamMember }) => {
      if (!user) throw new Error("Not signed in");
      const { fields, dedupKeys } = await resolveLeadFields(email);
      const existing = existingLeadFor(dedupKeys);
      if (existing) {
        if (existing.assigned_to !== target.id) {
          const { data: moved, error } = await supabase.from("leads").update({ assigned_to: target.id }).eq("id", existing.id).select("id");
          if (error) throw new Error(error.message);
          if (!moved || moved.length === 0) throw new Error("Couldn't assign this lead — please check permissions and try again.");
        }
      } else {
        const { error } = await supabase.from("leads").insert({
          ...fields,
          assigned_to: target.id,
          created_by: user.id,
        });
        if (error) throw new Error(error.message);
      }
      const res = await claimEmailInGmail(email.threadId, `${target.full_name || "Team"} lead`);
      return { labelled: res.ok, name: target.full_name || target.email || "team member" };
    },
    onSuccess: (r) => {
      toast.success(`Assigned to ${r.name}${r.labelled ? " & labelled in Gmail" : " (Gmail label pending)"}`);
      qc.invalidateQueries({ queryKey: ["lead-inbox"] });
      qc.invalidateQueries({ queryKey: ["email-leads"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Auto-sync (admins only): when the inbox loads, any email tagged with a
  // known salesperson's name that isn't a lead yet is created in *their* leads.
  // Deduped by email address + guarded per-session so it runs at most once each.
  const syncedRef = useRef<Set<string>>(new Set());
  const syncTagged = useMutation({
    mutationFn: async (list: { email: InboxEmail; owner: TeamMember }[]) => {
      if (!user || list.length === 0) return { created: 0 };
      // Read each thread body to extract real customer details, then dedup.
      const resolved = await Promise.all(
        list.map(async ({ email, owner }) => {
          const { fields, dedupKeys } = await resolveLeadFields(email);
          return { fields, dedupKeys, owner };
        }),
      );
      const rows = resolved
        .filter((r) => !existingLeadFor(r.dedupKeys))
        .map((r) => ({ ...r.fields, assigned_to: r.owner.id, created_by: user.id }));
      if (rows.length === 0) return { created: 0 };
      const { error } = await supabase.from("leads").insert(rows);
      if (error) throw new Error(error.message);
      return { created: rows.length };
    },
    onSuccess: (r) => {
      if (r.created > 0) {
        toast.success(`Synced ${r.created} tagged email${r.created > 1 ? "s" : ""} to their owners' leads`);
        qc.invalidateQueries({ queryKey: ["email-leads"] });
        qc.invalidateQueries({ queryKey: ["leads"] });
      }
    },
    onError: (e: Error) => toast.error(`Tag sync failed: ${e.message}`),
  });

  useEffect(() => {
    if (!isAdmin || !connected || emails.length === 0 || team.length === 0) return;
    const pending: { email: InboxEmail; owner: TeamMember }[] = [];
    for (const e of emails) {
      if (syncedRef.current.has(e.threadId)) continue;
      const owner = matchOwnerToUser(claimedOwner(e.labels), team);
      if (!owner) continue;
      const { address } = parseFrom(e.from);
      if (address && leadByEmail.has(address.trim().toLowerCase())) { syncedRef.current.add(e.threadId); continue; }
      syncedRef.current.add(e.threadId);
      pending.push({ email: e, owner });
    }
    if (pending.length > 0 && !syncTagged.isPending) syncTagged.mutate(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, connected, emails, team, leadByEmail]);

  // Is this email tagged to the current user?
  const isMine = (e: InboxEmail) => {
    const o = matchOwnerToUser(claimedOwner(e.labels), team);
    return !!(o && user && o.id === user.id);
  };

  // The team-member id this email's lead is currently assigned to (from the
  // existing lead if any, else inferred from the Gmail owner tag). Drives the
  // admin "Assign to…" dropdown's selected value.
  const currentAssigneeId = (e: InboxEmail): string | undefined => {
    const { address } = parseFrom(e.from);
    const lead = address ? leadByEmail.get(address.trim().toLowerCase()) : undefined;
    if (lead?.assigned_to) return lead.assigned_to;
    return matchOwnerToUser(claimedOwner(e.labels), team)?.id ?? undefined;
  };

  // Reusable "Assign to…" dropdown for admins (used in both the row and dialog).
  const AssignDropdown = ({ email, className }: { email: InboxEmail; className?: string }) => (
    <Select
      value={currentAssigneeId(email)}
      disabled={assign.isPending || team.length === 0}
      onValueChange={(id) => {
        const target = team.find((t) => t.id === id);
        if (target) assign.mutate({ email, target });
      }}
    >
      <SelectTrigger className={className ?? "h-8 w-[170px] text-xs"}>
        <SelectValue placeholder="Assign to…" />
      </SelectTrigger>
      <SelectContent>
        {team.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.full_name || t.email || "Unnamed"}{user && t.id === user.id ? " (me)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const rows = emails.filter((e) => {
    const owner = claimedOwner(e.labels);
    if (filter === "unclaimed" && owner) return false;
    if (filter === "mine" && !isMine(e)) return false;
    if (q.trim()) {
      const s = q.toLowerCase();
      if (![e.from, e.subject, e.snippet].some((v) => String(v ?? "").toLowerCase().includes(s))) return false;
    }
    return true;
  });

  const counts = {
    all: emails.length,
    unclaimed: emails.filter((e) => !claimedOwner(e.labels)).length,
    mine: emails.filter((e) => isMine(e)).length,
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2"><Mail className="h-6 w-6 text-primary" /> Lead Inbox</h1>
          <p className="text-sm text-muted-foreground">New leads from your shared mailbox. Claim one to add it to your leads.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCcw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {(["all", "unclaimed", "mine"] as Filter[]).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)} className="capitalize">
                {f === "mine" ? "My leads" : f} <span className="ml-1 opacity-70">({counts[f]})</span>
              </Button>
            ))}
          </div>
          <div className="relative flex-1 min-w-48">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9 h-9" placeholder="Search sender, subject…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-3 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-3 border-b animate-pulse">
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-1/3" />
                    <div className="h-3 bg-muted rounded w-2/3" />
                    <div className="h-3 bg-muted rounded w-1/2" />
                  </div>
                  <div className="h-8 w-24 bg-muted rounded" />
                </div>
              ))}
            </div>
          ) : !connected ? (
            <div className="p-10 text-center space-y-2">
              <div className="text-muted-foreground">Gmail inbox isn't connected yet.</div>
              {data?.error && (
                <div className="text-xs font-mono text-rose-600 bg-rose-50 dark:bg-rose-950/30 inline-block px-3 py-1.5 rounded max-w-full break-words">
                  {data.error}
                </div>
              )}
              <div className="text-xs text-muted-foreground">Finish setup: Apps Script + the <code>gmail-bridge</code> function + its two secrets.</div>
            </div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No emails match this filter.</div>
          ) : (
            rows.map((e) => {
              const owner = claimedOwner(e.labels);
              const { name, address } = parseFrom(e.from);
              const mine = isMine(e);
              const hasLead = address ? leadByEmail.has(address.trim().toLowerCase()) : false;
              return (
                <div key={e.threadId} className="flex items-start gap-3 px-4 py-3 border-b last:border-b-0 hover:bg-accent/30 transition-colors">
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setReading(e)} onMouseEnter={() => prefetchThread(e.threadId)} title="Click to read">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{name || address || "Unknown sender"}</span>
                      {e.unread && <span className="h-2 w-2 rounded-full bg-primary" title="Unread" />}
                      {owner ? (
                        <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">🏷 {owner}</Badge>
                      ) : (
                        <Badge variant="outline">Unclaimed</Badge>
                      )}
                    </div>
                    <div className="text-sm truncate">{e.subject || "(no subject)"}</div>
                    {e.snippet && <div className="text-xs text-muted-foreground truncate">{e.snippet}</div>}
                    <div className="text-[11px] text-muted-foreground mt-0.5">{address} · {formatDistanceToNow(new Date(e.date), { addSuffix: true })}</div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {isAdmin ? (
                      <>
                        <AssignDropdown email={e} />
                        {owner && <span className="text-[10px] text-muted-foreground">Currently: {owner}</span>}
                      </>
                    ) : !owner ? (
                      <Button size="sm" disabled={claim.isPending} onClick={() => claim.mutate(e)}>
                        <UserPlus className="h-4 w-4 mr-1" /> Claim as my lead
                      </Button>
                    ) : mine ? (
                      <span className="text-[11px] text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" /> In your leads
                      </span>
                    ) : (
                      <Button size="sm" variant="outline" disabled={markMine.isPending} onClick={() => markMine.mutate(e)}>
                        <Hand className="h-4 w-4 mr-1" /> Mark as yours
                      </Button>
                    )}
                    {!isAdmin && owner && !mine && hasLead && (
                      <span className="text-[10px] text-muted-foreground">In {owner}'s leads</span>
                    )}
                    <a href={e.url} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
                      <ExternalLink className="h-3 w-3" /> Open in Gmail
                    </a>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Pagination: 40 per page, navigate to older/newer emails */}
      {connected && (page > 0 || hasMore) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            Showing {emails.length} email{emails.length !== 1 ? "s" : ""} on this page {isFetching && "· loading…"}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 0 || isFetching} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Newer
            </Button>
            <div className="flex items-center gap-1 text-sm">
              <span className="text-muted-foreground">Page</span>
              <Input
                type="number"
                min={1}
                value={page + 1}
                onChange={(ev) => { const n = parseInt(ev.target.value, 10); if (!isNaN(n) && n >= 1) setPage(n - 1); }}
                className="w-14 h-8 text-center px-1"
              />
            </div>
            <Button variant="outline" size="sm" disabled={!hasMore || isFetching} onClick={() => setPage((p) => p + 1)}>
              Older <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Read the full email inside the CRM */}
      <Dialog open={!!reading} onOpenChange={(v) => { if (!v) setReading(null); }}>
        <DialogContent className="max-w-2xl h-[85vh] p-4 flex flex-col gap-3">
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-base pr-8">{reading?.subject || "(no subject)"}</DialogTitle>
          </DialogHeader>
          {threadQ.isLoading ? (
            <div className="flex-1 grid place-items-center text-sm text-muted-foreground">Loading email…</div>
          ) : !threadQ.data?.ok ? (
            <div className="flex-1 grid place-items-center text-sm text-destructive text-center px-4">Couldn't load this email{threadQ.data?.error ? `: ${threadQ.data.error}` : ""}.</div>
          ) : (
            <>
              {/* Whole conversation in one continuous view; only this area scrolls,
                  so the popup's close ✕ (top-right) always stays visible. */}
              <iframe
                title="email"
                sandbox=""
                srcDoc={buildThreadHtml(threadQ.data.messages ?? [])}
                className="w-full flex-1 min-h-0 rounded-md border bg-white"
              />
              {(() => {
                const atts = (threadQ.data.messages ?? []).flatMap((m) => m.attachments ?? []);
                return atts.length > 0 ? (
                  <div className="space-y-1 shrink-0">
                    <div className="flex flex-wrap gap-2">
                      {atts.map((a, j) => (
                        <span key={j} className="text-xs inline-flex items-center gap-1 rounded border px-2 py-1 bg-muted/40">📎 {a.name}</span>
                      ))}
                    </div>
                    <div className="text-xs text-muted-foreground">To download an attachment (e.g. a quotation PDF), use "Open in Gmail" below.</div>
                  </div>
                ) : null;
              })()}
              {/* In-CRM reply composer */}
              {replyOpen && (
                <div className="shrink-0 rounded-md border bg-muted/20 p-3 space-y-2">
                  <div className="text-xs text-muted-foreground">
                    Reply to{" "}
                    {replyTo
                      ? <span className="font-medium text-foreground">{replyTo}</span>
                      : <span className="text-destructive">no customer address found — use "Open in Gmail" instead</span>}
                    {replyTo && " · sent from your CRM, a copy is saved to the shared inbox"}
                  </div>
                  <Textarea
                    rows={4}
                    autoFocus
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Type your reply…"
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setReplyOpen(false)}>Cancel</Button>
                    <Button
                      size="sm"
                      disabled={reply.isPending || !replyText.trim() || !replyTo}
                      onClick={() => reply.mutate({ to: replyTo as string, subject: replySubject, text: replyText.trim() })}
                    >
                      <Send className="h-4 w-4 mr-1" /> {reply.isPending ? "Sending…" : "Send reply"}
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-3 shrink-0">
                {reading && isAdmin && (
                  <div className="flex items-center gap-2 mr-auto">
                    <span className="text-xs text-muted-foreground">Assign to</span>
                    <AssignDropdown email={reading} className="h-8 w-[180px] text-xs" />
                  </div>
                )}
                {reading && !isAdmin && (() => {
                  const owner = claimedOwner(reading.labels);
                  if (!owner) {
                    return (
                      <Button size="sm" disabled={claim.isPending} onClick={() => { claim.mutate(reading); setReading(null); }}>
                        <UserPlus className="h-4 w-4 mr-1" /> Claim as my lead
                      </Button>
                    );
                  }
                  if (isMine(reading)) {
                    return (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                        <CheckCircle2 className="h-4 w-4" /> In your leads
                      </span>
                    );
                  }
                  return (
                    <Button size="sm" variant="outline" disabled={markMine.isPending} onClick={() => { markMine.mutate(reading); setReading(null); }}>
                      <Hand className="h-4 w-4 mr-1" /> Mark as yours
                    </Button>
                  );
                })()}
                {replyTo && !replyOpen && (
                  <Button size="sm" onClick={() => setReplyOpen(true)}>
                    <Reply className="h-4 w-4 mr-1" /> Reply in CRM
                  </Button>
                )}
                {(threadQ.data.url || reading?.url) && (
                  <a href={threadQ.data.url || reading?.url} target="_blank" rel="noreferrer" className="text-sm text-primary inline-flex items-center gap-1 hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" /> Open in Gmail
                  </a>
                )}
                <Button size="sm" variant="outline" onClick={() => setReading(null)}>Close</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
