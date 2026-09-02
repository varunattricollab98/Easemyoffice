import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { SERVICES, SOURCES } from "@/lib/crm";

// PUBLIC, unauthenticated lead-intake endpoint for a website "Contact us" form.
// Creates an UNASSIGNED lead (assigned_to = NULL, stage 'new_lead', source 'website')
// via the service-role client (bypasses RLS, since leads_insert RLS forbids
// anonymous inserts). Reps then CLAIM the lead in the Inbox/Pipeline flow.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-intake-token",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// Keep a leading + and digits only; assume India for bare 10-digit numbers.
function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (trimmed.startsWith("+")) return "+" + digits;
  if (digits.length === 10) return "+91" + digits; // assume India
  if (digits.length === 12 && digits.startsWith("91")) return "+" + digits;
  return "+" + digits;
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

// Pull the first non-empty value across a list of accepted aliases.
function pick(body: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = str(body[k]).trim();
    if (v) return v;
  }
  return "";
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = (request.headers.get("content-type") || "").toLowerCase();
  try {
    if (contentType.includes("application/json")) {
      const parsed = await request.json();
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    }
    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const form = await request.formData();
      const obj: Record<string, unknown> = {};
      for (const [key, value] of form.entries()) {
        obj[key] = typeof value === "string" ? value : "";
      }
      return obj;
    }
    // Fallback: try JSON, then urlencoded text.
    const text = await request.text();
    if (!text) return {};
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      const params = new URLSearchParams(text);
      const obj: Record<string, unknown> = {};
      for (const [key, value] of params.entries()) obj[key] = value;
      return obj;
    }
  } catch {
    return {};
  }
}

export const Route = createFileRoute("/api/public/hooks/lead-intake")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),

      POST: async ({ request }) => {
        const body = await parseBody(request);

        // (a) Honeypot: silently drop bots that fill hidden fields.
        const honeypot = pick(body, ["website_hp", "_gotcha"]);
        if (honeypot) {
          return json({ ok: true, skipped: true }, 200);
        }

        // (b) Optional shared-secret guard: only enforced when configured.
        const expectedToken = process.env.LEAD_INTAKE_TOKEN;
        if (expectedToken) {
          const provided = request.headers.get("x-intake-token") || pick(body, ["token"]);
          if (provided !== expectedToken) {
            return json({ ok: false, error: "unauthorized" }, 401);
          }
        }

        // Required fields.
        const clientName = pick(body, ["name", "full_name", "client_name", "fullName"]);
        const phoneRaw = pick(body, ["phone", "mobile", "contact", "contact_no", "phone_number"]);
        if (!clientName || !phoneRaw) {
          return json({ ok: false, error: "name and phone are required" }, 400);
        }
        const mobile = normalizePhone(phoneRaw) ?? phoneRaw.trim();

        // Optional fields.
        const emailRaw = pick(body, ["email", "email_id", "e_mail"]);
        const email = emailRaw && emailRaw.includes("@") ? emailRaw.toLowerCase() : null;
        const companyName = pick(body, ["company", "business", "company_name", "business_name"]) || null;
        const city = pick(body, ["city", "location"]) || null;
        const message = pick(body, ["message", "query", "requirement", "notes", "comments"]) || null;

        // service: only pass if it matches a valid service_type enum id.
        const serviceRaw = pick(body, ["service", "service_required"]).toLowerCase();
        const service = SERVICES.find((s) => s.id === serviceRaw)?.id ?? null;

        // source: default 'website'; only accept known lead_source enum ids.
        const sourceRaw = pick(body, ["source"]).toLowerCase();
        const source = SOURCES.find((s) => s.id === sourceRaw)?.id ?? "website";

        // Dedup: same mobile OR same (lower) email.
        try {
          let dedupQuery = supabaseAdmin.from("leads").select("id, lead_code, notes, assigned_to, stage");
          if (email) {
            dedupQuery = dedupQuery.or(`mobile.eq.${mobile},email.eq.${email}`);
          } else {
            dedupQuery = dedupQuery.eq("mobile", mobile);
          }
          const { data: existing } = await dedupQuery.limit(1).maybeSingle();
          if (existing?.id) {
            // Best-effort: append the new message to the existing lead's notes.
            if (message) {
              const stamp = new Date().toISOString();
              const appended = `${existing.notes ? existing.notes + "\n\n" : ""}[${stamp}] Website contact form: ${message}`;
              await supabaseAdmin
                .from("leads")
                .update({ notes: appended })
                .eq("id", existing.id);
            }
            return json({ ok: true, deduped: true, lead_id: existing.id }, 200);
          }
        } catch {
          // Dedup is best-effort; fall through to insert on any lookup failure.
        }

        // Insert the new UNASSIGNED lead. DB defaults fill interest/score/service_required.
        const insertRow: Record<string, unknown> = {
          client_name: clientName,
          mobile,
          email,
          company_name: companyName,
          city,
          source,
          notes: message,
          assigned_to: null,
          stage: "new_lead",
        };
        if (service) insertRow.service_required = service;

        const { data: created, error } = await supabaseAdmin
          .from("leads")
          .insert(insertRow as never)
          .select("id, lead_code")
          .single();

        if (error || !created) {
          return json({ ok: false, error: error?.message ?? "insert_failed" }, 500);
        }

        // Best-effort activity log; never fail the intake if this errors.
        try {
          await supabaseAdmin.from("lead_activities").insert({
            lead_id: created.id,
            actor_id: null,
            type: "created",
            title: "Lead captured from website contact form",
            body: message,
            payload: {
              source: "contact_form",
              client_name: clientName,
              mobile,
              email,
              company_name: companyName,
              city,
              service,
              form_source: source,
            },
          } as never);
        } catch {
          // ignore activity-log failures
        }

        return json({ ok: true, lead_id: created.id, lead_code: created.lead_code }, 200);
      },
    },
  },
});
