import { supabase } from "@/integrations/supabase/client";

export interface InboxEmail {
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  labels: string[];
  url: string;
}

// Fetch recent lead emails from the shared Gmail inbox (via the gmail-bridge
// edge function). Fails soft (empty list) if not connected.
export async function fetchInbox(max = 30): Promise<{ ok: boolean; emails: InboxEmail[]; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("gmail-bridge", { body: { action: "inbox", max } });
    if (error) return { ok: false, emails: [], error: "not connected" };
    if (!data?.ok) return { ok: false, emails: [], error: data?.error || "not connected" };
    return { ok: true, emails: Array.isArray(data.emails) ? data.emails : [] };
  } catch {
    return { ok: false, emails: [], error: "not connected" };
  }
}

// Label a Gmail thread as "<Name> lead" and mark it read.
export async function claimEmailInGmail(threadId: string, label: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("gmail-bridge", { body: { action: "claim", threadId, label } });
    if (error) return { ok: false, error: error.message };
    if (!data?.ok) return { ok: false, error: data?.error || "claim failed" };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "claim failed" };
  }
}

// Split "Name <email@x.com>" into its parts.
export function parseFrom(from: string): { name: string; address: string } {
  if (!from) return { name: "", address: "" };
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: (m[1] || "").trim(), address: (m[2] || "").trim() };
  if (from.includes("@")) return { name: "", address: from.trim() };
  return { name: from.trim(), address: "" };
}

// Which person has claimed an email, from its Gmail labels ("<Name> lead"),
// or null if unclaimed.
export function claimedOwner(labels: string[]): string | null {
  const l = (labels || []).find((x) => /\blead$/i.test(x.trim()));
  return l ? l.replace(/\s*lead$/i, "").trim() : null;
}
