// TeleCMI -> EaseMyOffice CRM call webhook.
//
// TeleCMI POSTs a call event to this function's public URL. We:
//   1. Store the RAW payload in telecmi_call_events (so real field names can be
//      verified from an actual call and nothing is ever lost).
//   2. Parse caller number, agent number (who picked / who missed), status
//      (answered vs missed), duration, direction, call id, time — using a set of
//      likely field names so it works even if TeleCMI's exact keys differ.
//   3. Match the agent to a CRM user by profiles.phone, and the caller to a lead
//      by leads.mobile (last-10-digits compare).
//   4. Apply the agreed rules:
//        ANSWERED (picked):
//          - caller has NO lead  -> create a new lead assigned to the picker
//                                   (source = direct_call), + a 'call' activity.
//          - caller HAS a lead   -> keep the existing owner; just add a 'call'
//                                   activity ("picked by <agent>").
//        MISSED:
//          - caller HAS a lead   -> notify ONLY that lead's owner
//                                   ("You missed your client's call").
//          - caller has NO lead  -> notify EVERYONE ("You missed a call — claim
//                                   this as your lead").
//
// Writes use the service-role key (bypasses RLS). Optional shared-secret guard:
// if TELECMI_WEBHOOK_SECRET is set, the request must include ?secret=... (or a
// `secret` body field) that matches.
//
// Required Edge Function secrets (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are
// injected automatically):
//   TELECMI_WEBHOOK_SECRET  (optional) shared secret to reject spoofed calls.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("TELECMI_WEBHOOK_SECRET") ?? "";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Case-insensitive lookup of the first present key from a list of candidates.
// TeleCMI field names are given as dashboard labels ("Caller", "Picked By",
// "Call Duration", "Missed call"), but the webhook JSON keys may differ, so we
// try many spellings/casings.
function pick(obj: Record<string, unknown>, candidates: string[]): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const lowerMap: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) lowerMap[k.toLowerCase().replace(/[\s_-]+/g, "")] = obj[k];
  for (const c of candidates) {
    const key = c.toLowerCase().replace(/[\s_-]+/g, "");
    if (key in lowerMap && lowerMap[key] !== null && lowerMap[key] !== "") return lowerMap[key];
  }
  return undefined;
}

const asStr = (v: unknown): string => (v === undefined || v === null ? "" : String(v)).trim();

// Keep only digits; compare on the last 10 so +91 / 0-prefix variants still match.
const digits = (v: unknown): string => asStr(v).replace(/\D/g, "");
const last10 = (v: unknown): string => {
  const d = digits(v);
  return d.length >= 10 ? d.slice(-10) : d;
};

// Parse a duration that may be seconds ("125"), or "MM:SS" / "HH:MM:SS".
function parseDurationSec(v: unknown): number {
  const s = asStr(v);
  if (!s) return 0;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const parts = s.split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);

  // Simple health check so opening the URL in a browser confirms it's live.
  if (req.method === "GET" && !url.searchParams.has("secret")) {
    return json({ ok: true, service: "telecmi-webhook", ready: true });
  }

  let body: Record<string, unknown> = {};
  try {
    if (req.method === "POST") {
      const text = await req.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          // Some webhooks send form-encoded — parse that too.
          body = Object.fromEntries(new URLSearchParams(text));
        }
      }
    }
    // Merge query params so config that sends data in the URL also works.
    for (const [k, v] of url.searchParams) if (!(k in body)) body[k] = v;
  } catch {
    body = {};
  }

  // Optional shared-secret guard.
  if (WEBHOOK_SECRET) {
    const provided = asStr(pick(body, ["secret", "token"])) || asStr(url.searchParams.get("secret"));
    if (provided !== WEBHOOK_SECRET) return json({ ok: false, error: "unauthorized" }, 401);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  // ---- Parse the payload with flexible field names ------------------------
  const callerNumber = asStr(pick(body, ["caller", "caller_number", "callernumber", "from", "customer", "customer_number", "did_number", "clid"]));
  const pickedBy = asStr(pick(body, ["picked by", "pickedby", "picked_by", "answered_by", "agent", "agent_number", "agent_no", "agentnumber", "attended_by"]));
  const missedBy = asStr(pick(body, ["missed call", "missed_call", "missedby", "missed_by", "missed", "missed_agent", "ring_agent"]));
  const rawStatus = asStr(pick(body, ["status", "call_status", "callstatus", "type", "event", "state", "disposition"]));
  const durationSec = parseDurationSec(pick(body, ["call duration", "call_duration", "callduration", "duration", "talk_time", "billsec"]));
  const direction = asStr(pick(body, ["direction", "call_type", "calltype", "incoming"])) || "incoming";
  const callId = asStr(pick(body, ["call_id", "callid", "uuid", "id", "cdr_id", "reference"]));
  const timeRaw = pick(body, ["date/time", "datetime", "date_time", "time", "date", "timestamp", "start_time", "created_at"]);

  // Decide answered vs missed. Prefer an explicit status; else infer from which
  // agent field is present (pickedBy => answered, missedBy => missed); else
  // fall back to duration > 0 meaning it connected.
  const statusLc = rawStatus.toLowerCase();
  let answered: boolean;
  if (/answer|attend|complet|connect|pick/.test(statusLc)) answered = true;
  else if (/miss|no.?answer|noanswer|fail|abandon|unanswer/.test(statusLc)) answered = false;
  else if (pickedBy) answered = true;
  else if (missedBy) answered = false;
  else answered = durationSec > 0;

  const agentNumber = answered ? pickedBy : missedBy;

  let callTime: string | null = null;
  if (timeRaw !== undefined) {
    const d = new Date(asStr(timeRaw));
    if (!isNaN(d.getTime())) callTime = d.toISOString();
  }

  // ---- Match agent (profiles.phone) and lead (leads.mobile) ---------------
  const agentDigits = last10(agentNumber);
  const callerDigits = last10(callerNumber);

  let matchedAgentId: string | null = null;
  let agentName = "";
  if (agentDigits) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name, phone");
    const hit = (profs ?? []).find((p) => last10((p as { phone?: string }).phone) === agentDigits);
    if (hit) {
      matchedAgentId = (hit as { id: string }).id;
      agentName = (hit as { full_name?: string }).full_name ?? "";
    }
  }

  let matchedLead: { id: string; assigned_to: string | null; client_name: string } | null = null;
  if (callerDigits) {
    // Pull candidate leads and compare on last-10 (mobile is stored as text).
    const { data: leads } = await supabase
      .from("leads")
      .select("id, mobile, assigned_to, client_name")
      .limit(2000);
    const hit = (leads ?? []).find((l) => last10((l as { mobile?: string }).mobile) === callerDigits);
    if (hit) {
      matchedLead = {
        id: (hit as { id: string }).id,
        assigned_to: (hit as { assigned_to: string | null }).assigned_to ?? null,
        client_name: (hit as { client_name: string }).client_name ?? "",
      };
    }
  }

  const notes: string[] = [];
  let createdLead = false;

  // ---- Apply the rules -----------------------------------------------------
  if (answered) {
    if (!matchedLead) {
      // New caller: create a lead assigned to the picker (if we matched them).
      const { data: inserted, error: insErr } = await supabase
        .from("leads")
        .insert({
          client_name: callerNumber || "TeleCMI caller",
          mobile: callerNumber || callerDigits || "unknown",
          source: "direct_call",
          assigned_to: matchedAgentId,
          created_by: matchedAgentId,
          notes: agentName ? `Auto-created from a call picked by ${agentName}.` : "Auto-created from an incoming call.",
        })
        .select("id, assigned_to, client_name")
        .single();
      if (!insErr && inserted) {
        matchedLead = { id: inserted.id, assigned_to: inserted.assigned_to, client_name: inserted.client_name };
        createdLead = true;
        notes.push(`Created new lead assigned to ${agentName || "the picker"}.`);
      } else {
        notes.push(`Could not create lead${insErr ? ": " + insErr.message : ""}.`);
      }
    } else {
      notes.push("Existing lead — owner unchanged.");
    }

    // Log a 'call' activity on the lead (existing OR just-created).
    if (matchedLead) {
      const mins = Math.floor(durationSec / 60);
      const secs = durationSec % 60;
      const durLabel = durationSec > 0 ? `${mins}m ${secs}s` : "";
      await supabase.from("lead_activities").insert({
        lead_id: matchedLead.id,
        actor_id: matchedAgentId,
        type: "call",
        title: `Call - Received${agentName ? " · picked by " + agentName : ""}`,
        body: durLabel ? `Duration ${durLabel}` : null,
        payload: {
          source: "telecmi",
          direction,
          status: "answered",
          caller_number: callerNumber,
          agent_number: agentNumber,
          agent_name: agentName,
          duration_sec: durationSec,
          call_id: callId,
        },
      });
    }
  } else {
    // MISSED call.
    if (matchedLead) {
      // Notify only the lead's owner.
      if (matchedLead.assigned_to) {
        await supabase.from("notifications").insert({
          user_id: matchedLead.assigned_to,
          type: "missed_call",
          title: "You missed your client's call",
          body: `${matchedLead.client_name || callerNumber} tried to reach you.`,
          lead_id: matchedLead.id,
        });
        notes.push("Missed call — notified the lead owner.");
      } else {
        notes.push("Missed call on an unassigned lead — no owner to notify.");
      }
      // Also record the missed call on the lead's timeline.
      await supabase.from("lead_activities").insert({
        lead_id: matchedLead.id,
        actor_id: null,
        type: "call",
        title: "Call - Missed",
        body: null,
        payload: {
          source: "telecmi",
          direction,
          status: "missed",
          caller_number: callerNumber,
          call_id: callId,
        },
      });
    } else {
      // New number, missed: notify everyone to claim it.
      const { data: everyone } = await supabase.from("profiles").select("id");
      const rows = (everyone ?? []).map((p) => ({
        user_id: (p as { id: string }).id,
        type: "missed_call_unclaimed",
        title: "You missed a call — claim this as your lead",
        body: `Missed call from ${callerNumber || "an unknown number"}.`,
        lead_id: null as string | null,
      }));
      if (rows.length > 0) await supabase.from("notifications").insert(rows);
      notes.push(`Missed call from a new number — notified ${rows.length} user(s) to claim.`);
    }
  }

  // ---- Always store the raw event (audit + field verification) ------------
  await supabase.from("telecmi_call_events").insert({
    direction,
    status: answered ? "answered" : "missed",
    caller_number: callerNumber || null,
    agent_number: agentNumber || null,
    agent_name: agentName || null,
    duration_sec: durationSec,
    call_id: callId || null,
    call_time: callTime,
    matched_lead_id: matchedLead?.id ?? null,
    matched_agent_id: matchedAgentId,
    created_lead: createdLead,
    note: notes.join(" "),
    payload: body,
  });

  return json({
    ok: true,
    answered,
    matched_agent: !!matchedAgentId,
    matched_lead: !!matchedLead,
    created_lead: createdLead,
    note: notes.join(" "),
  });
});
