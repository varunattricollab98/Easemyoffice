// Server-side scheduled sync: guarantees EVERY Gmail thread tagged with a
// "<Name> lead" label becomes a lead assigned to that salesperson, across the
// FULL mailbox, independent of who is logged in or which tab is open.
//
// Triggered by pg_cron (see setup/ADD_GMAIL_TAG_SYNC_CRON.sql) every 10 minutes.
//
// Required Edge Function secrets (Supabase -> Edge Functions -> Secrets):
//   GMAIL_WEBHOOK_URL     -> the Gmail Apps Script Web App /exec URL
//   GMAIL_TOKEN           -> shared secret; must match TOKEN in the Apps Script
//   CRON_SECRET           -> shared word; cron sends it in body.secret
//   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically)
//
// Calls the Apps Script `tagged` action DIRECTLY (avoids an extra hop through
// gmail-bridge and any JWT/RLS concerns). Pages start=0,PAGE_SIZE,... until
// hasMore is false or a generous safety cap (MAX_PAGES × PAGE_SIZE threads) is
// hit.
//
// BACKLOG COVERAGE (why the cap is generous, not tiny): the Apps Script still
// RETURNS threads that are already leads (they keep their "<Name> lead" label),
// and dedup below skips them — but the pagination window always restarts at
// start=0 each run, so a backlog LARGER than one run's cap would re-scan the
// same head every run and never reach the tail. To make "every tagged email
// eventually becomes a lead" true for realistic mailboxes, the per-run cap is
// large enough to sweep the whole tagged set in a single run (MAX_PAGES ×
// PAGE_SIZE). If a mailbox ever exceeds even that, the run does NOT pretend to
// have finished: `cap_hit:true` is returned AND a best-effort email_log row is
// written, so the truncation is visible instead of looking like a clean sweep.
//
// For each tagged thread: match the owner tag to a profile, parse the real
// customer fields (name, email, phone, etc.) from the thread body, dedup on
// [realEmail, senderAddr] lowercased (the SAME rule as the client in
// src/routes/_authenticated/inbox.tsx resolveLeadFields), and insert the lead
// via the service-role client (bypasses RLS). Unmatched owner tags are NOT
// silently dropped: they appear in the response `unmatched` array and a
// best-effort row is written to email_log (source='gmail-tag-sync',
// status='unmatched').

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  parseFrom,
  claimedOwner,
  matchOwnerTagToName,
  isThrowawayAddress,
  htmlToText,
  parseWeb3FormLead,
} from "../_shared/gmail-parse.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GMAIL_WEBHOOK_URL = Deno.env.get("GMAIL_WEBHOOK_URL") ?? "";
const GMAIL_TOKEN = Deno.env.get("GMAIL_TOKEN") ?? "";

/** Threads per page when calling the Apps Script tagged action (Apps Script
 * caps `max` at 100). */
const PAGE_SIZE = 100;
/** Maximum pages to fetch from Gmail per run (safety cap against a runaway
 * loop). 200 pages * 100 = 20,000 threads swept per run — large enough to
 * fully drain any realistic tagged backlog in a single run so the window never
 * gets stuck re-scanning the same head. If this cap is actually reached the run
 * reports cap_hit:true (see below) rather than silently truncating. */
const MAX_PAGES = 200;

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Fetch one page of tagged threads directly from the Apps Script.
async function fetchTaggedPage(
  start: number,
  max: number,
): Promise<{ ok: boolean; emails: any[]; hasMore: boolean; error?: string }> {
  const url =
    `${GMAIL_WEBHOOK_URL}?action=tagged&max=${max}&start=${start}&token=${encodeURIComponent(GMAIL_TOKEN)}`;
  const res = await fetch(url, { method: "GET", redirect: "follow" });
  const text = await res.text();
  let parsed: any = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, emails: [], hasMore: false, error: `Bad response: ${text.slice(0, 150)}` };
  }
  if (parsed.ok === false) return { ok: false, emails: [], hasMore: false, error: parsed.error };
  return { ok: true, emails: parsed.emails ?? [], hasMore: !!parsed.hasMore };
}

// Fetch the full thread body from the Apps Script (fallback when the tagged
// action did not include a body for a particular thread).
async function fetchThreadBody(threadId: string): Promise<string> {
  try {
    const url =
      `${GMAIL_WEBHOOK_URL}?action=thread&threadId=${encodeURIComponent(threadId)}&token=${encodeURIComponent(GMAIL_TOKEN)}`;
    const res = await fetch(url, { method: "GET", redirect: "follow" });
    const data = JSON.parse(await res.text());
    if (!data?.ok) return "";
    const msgs: any[] = data.messages ?? [];
    return msgs
      .map((m: any) =>
        m.body && m.body.trim() ? m.body : htmlToText(m.html || ""),
      )
      .join("\n");
  } catch {
    return "";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── Auth: CRON_SECRET (body.secret OR x-cron-secret header) ──────────
    let bodySecret = "";
    try {
      bodySecret = (await req.json())?.secret ?? "";
    } catch {
      /* no body / not JSON */
    }
    const headerSecret = req.headers.get("x-cron-secret") ?? "";
    if (
      !CRON_SECRET ||
      (bodySecret !== CRON_SECRET && headerSecret !== CRON_SECRET)
    ) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    if (!GMAIL_WEBHOOK_URL || !GMAIL_TOKEN) {
      return json({ ok: false, error: "GMAIL_WEBHOOK_URL or GMAIL_TOKEN not set" }, 200);
    }
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return json({ ok: false, error: "Supabase env missing" }, 200);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    // ── 1. Page through ALL tagged threads ─────────────────────────────────
    const allEmails: any[] = [];
    let start = 0;
    // capHit means we stopped because of MAX_PAGES while Gmail still reported
    // more threads — i.e. the mailbox has MORE tagged threads than one run
    // sweeps, so this run does NOT cover "every tagged email". We must NOT let
    // that look like a clean finish (issue #1).
    let capHit = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await fetchTaggedPage(start, PAGE_SIZE);
      if (!result.ok) {
        // Fail soft: return whatever we collected so far and report the error.
        return json({
          ok: false,
          error: `Tagged fetch failed at page ${page}: ${result.error}`,
          scanned: allEmails.length,
          created: 0,
          skipped_existing: 0,
          unmatched: [],
        }, 200);
      }
      allEmails.push(...result.emails);
      if (!result.hasMore) break;
      start += PAGE_SIZE;
      // Reached the last allowed page but Gmail still has more -> cap hit.
      if (page === MAX_PAGES - 1) capHit = true;
    }

    // ── 2. Load profiles (id, full_name) ───────────────────────────────────
    const { data: profiles, error: profErr } = await supabase
      .from("profiles")
      .select("id, full_name");
    if (profErr) throw new Error(`profiles: ${profErr.message}`);
    const profileList: { id: string; full_name: string }[] = profiles ?? [];
    const profileNames = profileList.map((p) => p.full_name);

    // ── 3. Load existing email-sourced leads for dedup ─────────────────────
    const { data: existingLeads, error: leadErr } = await supabase
      .from("leads")
      .select("id, email, assigned_to")
      .eq("source", "email");
    if (leadErr) throw new Error(`leads: ${leadErr.message}`);
    const leadByEmail = new Map<string, { id: string; assigned_to: string | null }>();
    for (const l of existingLeads ?? []) {
      if (l.email) leadByEmail.set(l.email.trim().toLowerCase(), { id: l.id, assigned_to: l.assigned_to });
    }

    // ── 4-7. Process each tagged thread ────────────────────────────────────
    let created = 0;
    let skippedExisting = 0;
    const unmatched: { owner: string; threadId: string; subject: string }[] = [];
    const insertBatch: Record<string, unknown>[] = [];
    // Surface (instead of swallowing) the email_log failure that happens when
    // ADD_GMAIL_TAG_SYNC_CRON.sql hasn't widened the status CHECK to allow
    // 'unmatched' yet — a mis-ordered deploy otherwise loses the audit trail
    // silently (issue #3). We keep processing but report the first error.
    let emailLogError: string | null = null;

    for (const email of allEmails) {
      // 4. Extract owner from labels
      const owner = claimedOwner(email.labels ?? []);
      if (!owner) continue; // no lead label on this thread (shouldn't happen, but safe)

      // Match owner to a profile
      const ownerIdx = matchOwnerTagToName(owner, profileNames);
      if (ownerIdx === -1) {
        // Unmatched: collect for response + best-effort email_log row
        unmatched.push({ owner, threadId: email.threadId, subject: email.subject });
        // Best-effort audit row. If the status CHECK still rejects 'unmatched'
        // (SQL migration not applied yet), capture the error and surface it in
        // the response instead of dropping it silently.
        try {
          const { error: logErr } = await supabase.from("email_log").insert({
            to_email: "",
            subject: `[gmail-tag-sync] Unmatched owner: "${owner}" - ${email.subject || "(no subject)"}`,
            source: "gmail-tag-sync",
            status: "unmatched",
          });
          if (logErr && !emailLogError) emailLogError = logErr.message;
        } catch (e) {
          if (!emailLogError) emailLogError = (e as Error).message;
        }
        continue;
      }
      const profile = profileList[ownerIdx];

      // 5. Parse real customer fields from thread body
      let bodyText = email.body ?? "";
      if (!bodyText.trim()) {
        // Fallback: fetch the full thread (extra round-trip)
        bodyText = await fetchThreadBody(email.threadId);
      }
      const parsed = parseWeb3FormLead(bodyText);

      const fromParsed = parseFrom(email.from || "");
      const senderAddr = fromParsed.address.trim().toLowerCase();
      const realEmail =
        parsed.email ||
        (isThrowawayAddress(fromParsed.address) ? "" : fromParsed.address);
      const clientName =
        parsed.name ||
        (isThrowawayAddress(fromParsed.address) ? "" : fromParsed.name) ||
        realEmail ||
        email.subject ||
        "Email lead";

      // 6. Dedup: [realEmail, senderAddr] lowercased/trimmed -- SAME as client
      const dedupKeys = [realEmail.trim().toLowerCase(), senderAddr].filter(Boolean);
      let isDup = false;
      for (const k of dedupKeys) {
        if (leadByEmail.has(k)) {
          isDup = true;
          break;
        }
      }
      if (isDup) {
        skippedExisting++;
        continue;
      }

      // 7. Build the insert row
      const notes = [
        `From email: ${email.subject || ""}`,
        email.url || "",
        parsed.location ? `Location: ${parsed.location}` : "",
        parsed.company ? `Company: ${parsed.company}` : "",
        parsed.message ? `Message: ${parsed.message}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      insertBatch.push({
        client_name: clientName,
        email: realEmail || null,
        mobile: parsed.phone || "",
        city: parsed.location || null,
        company_name: parsed.company || null,
        source: "email",
        notes,
        assigned_to: profile.id,
        created_by: profile.id,
      });

      // Add newly-created keys to the in-memory map so the same run doesn't
      // double-insert across different threads that share the same customer.
      for (const k of dedupKeys) {
        if (k) leadByEmail.set(k, { id: "pending", assigned_to: profile.id });
      }
    }

    // Batch insert (chunks of 50 to stay within Supabase payload limits).
    const CHUNK = 50;
    for (let i = 0; i < insertBatch.length; i += CHUNK) {
      const chunk = insertBatch.slice(i, i + CHUNK);
      const { error: insErr } = await supabase.from("leads").insert(chunk);
      if (insErr) {
        // Partial failure: report what we have so far.
        return json({
          ok: false,
          error: `Insert batch at offset ${i}: ${insErr.message}`,
          scanned: allEmails.length,
          created,
          skipped_existing: skippedExisting,
          unmatched,
          cap_hit: capHit,
          email_log_error: emailLogError,
        }, 200);
      }
      created += chunk.length;
    }

    // If we stopped at the page cap while Gmail still had more, record a
    // best-effort audit row so an over-cap backlog is visible in email_log too,
    // not only in this response.
    if (capHit) {
      try {
        const { error: capLogErr } = await supabase.from("email_log").insert({
          to_email: "",
          subject: `[gmail-tag-sync] Page cap hit: swept ${allEmails.length} tagged threads (MAX_PAGES=${MAX_PAGES}); more remain — increase MAX_PAGES or investigate.`,
          source: "gmail-tag-sync",
          status: "unmatched",
        });
        if (capLogErr && !emailLogError) emailLogError = capLogErr.message;
      } catch (e) {
        if (!emailLogError) emailLogError = (e as Error).message;
      }
    }

    return json({
      ok: true,
      scanned: allEmails.length,
      created,
      skipped_existing: skippedExisting,
      unmatched,
      // true => this run did NOT cover the whole mailbox (backlog exceeds the
      // per-run cap); a clean finish is cap_hit:false.
      cap_hit: capHit,
      // non-null => the email_log audit insert failed (likely the status CHECK
      // was not widened by ADD_GMAIL_TAG_SYNC_CRON.sql before deploy).
      email_log_error: emailLogError,
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 200);
  }
});
