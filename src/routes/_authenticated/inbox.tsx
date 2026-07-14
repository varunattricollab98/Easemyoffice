import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Mail, ExternalLink, UserPlus, Search, RefreshCcw } from "lucide-react";
import { fetchInbox, claimEmailInGmail, parseFrom, claimedOwner, type InboxEmail } from "@/lib/gmail";

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

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["lead-inbox"],
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: () => fetchInbox(40),
  });

  const emails = data?.emails ?? [];
  const connected = data?.ok ?? false;

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
                <div key={e.threadId} className="flex items-start gap-3 px-4 py-3 border-b last:border-b-0">
                  <div className="flex-1 min-w-0">
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
                    <div className="text-xs text-muted-foreground truncate">{e.snippet}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{address} · {formatDistanceToNow(new Date(e.date), { addSuffix: true })}</div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <a href={e.url} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
                      <ExternalLink className="h-3 w-3" /> Open in Gmail
                    </a>
                    {!owner && (
                      <Button size="sm" disabled={claim.isPending} onClick={() => claim.mutate(e)}>
                        <UserPlus className="h-4 w-4 mr-1" /> Claim as my lead
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
