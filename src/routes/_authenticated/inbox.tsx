import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Mail, ExternalLink, UserPlus, Search, RefreshCcw, ChevronLeft, ChevronRight } from "lucide-react";
import { fetchInbox, fetchThread, claimEmailInGmail, parseFrom, claimedOwner, type InboxEmail } from "@/lib/gmail";

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

function LeadInboxPage() {
  const { user, profile, isAdmin } = useAuth();
  const qc = useQueryClient();
  const myName = profile?.full_name ?? "";
  const [filter, setFilter] = useState<Filter>(isAdmin ? "all" : "unclaimed");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [reading, setReading] = useState<InboxEmail | null>(null);
  const PAGE_SIZE = 40;

  const threadQ = useQuery({
    queryKey: ["gmail-thread", reading?.threadId],
    enabled: !!reading,
    queryFn: () => fetchThread(reading!.threadId),
  });

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["lead-inbox", page],
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    queryFn: () => fetchInbox(PAGE_SIZE, page * PAGE_SIZE),
  });

  const emails = data?.emails ?? [];
  const connected = data?.ok ?? false;
  const hasMore = data?.hasMore ?? false;

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

  const claim = useMutation({
    mutationFn: async (email: InboxEmail) => {
      if (!user) throw new Error("Not signed in");
      const { name, address } = parseFrom(email.from);
      // 1) Create the lead, assigned to me.
      const { data: created, error } = await supabase.from("leads").insert({
        client_name: name || address || email.subject || "Email lead",
        email: address || null,
        mobile: "",
        source: "email" as never,
        assigned_to: user.id,
        created_by: user.id,
        notes: `From email: ${email.subject}\n${email.url}`,
      }).select("id").single();
      if (error) throw new Error(error.message);
      // 2) Label the Gmail thread with my name (best-effort).
      const label = `${myName || "Me"} lead`;
      const res = await claimEmailInGmail(email.threadId, label);
      return { id: created?.id, labelled: res.ok, labelError: res.error };
    },
    onSuccess: (r) => {
      toast.success(r.labelled ? "Claimed — added to your leads & labelled in Gmail" : "Added to your leads (Gmail label pending)");
      qc.invalidateQueries({ queryKey: ["lead-inbox"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = emails.filter((e) => {
    const owner = claimedOwner(e.labels);
    if (filter === "unclaimed" && owner) return false;
    if (filter === "mine" && !(owner && myName && owner.toLowerCase() === myName.toLowerCase())) return false;
    if (q.trim()) {
      const s = q.toLowerCase();
      if (![e.from, e.subject, e.snippet].some((v) => String(v ?? "").toLowerCase().includes(s))) return false;
    }
    return true;
  });

  const counts = {
    all: emails.length,
    unclaimed: emails.filter((e) => !claimedOwner(e.labels)).length,
    mine: emails.filter((e) => { const o = claimedOwner(e.labels); return o && myName && o.toLowerCase() === myName.toLowerCase(); }).length,
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
            <div className="p-8 text-center text-sm text-muted-foreground">Loading inbox…</div>
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
                    {!owner && (
                      <Button size="sm" disabled={claim.isPending} onClick={() => claim.mutate(e)}>
                        <UserPlus className="h-4 w-4 mr-1" /> Claim as my lead
                      </Button>
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
              <div className="flex flex-wrap items-center justify-end gap-3 shrink-0">
                {reading && !claimedOwner(reading.labels) && (
                  <Button size="sm" disabled={claim.isPending} onClick={() => { claim.mutate(reading); setReading(null); }}>
                    <UserPlus className="h-4 w-4 mr-1" /> Claim as my lead
                  </Button>
                )}
                {(threadQ.data.url || reading?.url) && (
                  <a href={threadQ.data.url || reading?.url} target="_blank" rel="noreferrer" className="text-sm text-primary inline-flex items-center gap-1 hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" /> Open in Gmail to reply
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
