// Notifies the renewals team about client plans expiring in the next N days.
//
// Renewals are recurring revenue, so a plan that lapses unnoticed is lost money.
// The renewal dashboard already *shows* "due in 30/90 days", but nothing pushed
// a reminder — this closes that gap. Triggered daily by pg_cron. Groups the
// expiring bookings by their assigned renewal owner and emails each person a
// summary; bookings with no renewal owner are collected into one admin summary.
//
// Mirrors notify-stale-followups (same auth, Resend send, grouping, HTML style).
//
// Required Edge Function secrets:
//   RESEND_API_KEY          -> Resend API key
//   CRM_FROM_EMAIL          -> sender address (e.g. "EaseMyOffice <crm@easemyoffice.in>")
//   CRON_SECRET             -> shared secret for auth
//   RENEWALS_ADMIN_EMAIL    -> (optional) where unassigned expiring plans are sent
//   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("CRM_FROM_EMAIL") ?? "EaseMyOffice CRM <onboarding@resend.dev>";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const RENEWALS_ADMIN_EMAIL = Deno.env.get("RENEWALS_ADMIN_EMAIL") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// How many days ahead of expiry to notify.
const WINDOW_DAYS = 30;

// Renewal statuses that mean the renewal is already resolved — don't nag on them.
const CLOSED_STATUSES = ["renewed", "cancelled", "lost", "not_interested"];

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Whole-day difference from today to the given date (negative if already past).
function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

interface ExpiringBooking {
  id: string;
  booking_code: string | null;
  external_booking_id: string | null;
  client_name: string | null;
  business_name: string | null;
  contact_no: string | null;
  plan_name: string | null;
  plan_expiry_date: string | null;
  renewal_status: string | null;
  renewal_assigned_to: string | null;
}

function buildEmailHtml(firstName: string, rows: ExpiringBooking[]): string {
  const count = rows.length;
  const tableRows = rows
    .map((b) => {
      const left = b.plan_expiry_date ? daysUntil(b.plan_expiry_date) : 0;
      const urgent = left <= 7;
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${esc(b.client_name || b.business_name || "—")}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${esc(b.plan_name || "—")}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${esc(b.contact_no || "—")}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${b.plan_expiry_date ? esc(fmtDate(b.plan_expiry_date)) : "—"}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:${urgent ? "#dc2626" : "#b45309"};font-weight:600">${left} day${left === 1 ? "" : "s"}</td>
      </tr>`;
    })
    .join("");

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto">
      <div style="background:#0f766e;padding:20px 24px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;color:#fff;font-size:18px">🔁 Renewals Due Soon</h2>
      </div>
      <div style="padding:24px;background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
        <p style="margin:0 0 16px;font-size:15px;color:#334155">
          ${esc(firstName)}, <strong>${count} client plan${count > 1 ? "s" : ""}</strong> ${count > 1 ? "are" : "is"}
          expiring in the next ${WINDOW_DAYS} days. Reach out to renew before they lapse.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e2e8f0;border-radius:6px">
          <thead>
            <tr style="background:#f8fafc">
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0">Client</th>
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0">Plan</th>
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0">Phone</th>
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0">Expires</th>
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0">In</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
        <p style="margin:16px 0 0;font-size:13px;color:#94a3b8">
          Automated reminder from EaseMyOffice CRM. You'll get this daily until each plan is renewed or the renewal is closed.
        </p>
      </div>
    </div>
  `;
}

async function sendEmail(to: string, subject: string, html: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
    });
    if (!res.ok) return `${to}: Resend ${res.status} — ${await res.text()}`;
    return null;
  } catch (e) {
    return `${to}: ${(e as Error).message}`;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth check (accepts secret in body or x-cron-secret header)
    let bodySecret = "";
    try { bodySecret = (await req.json())?.secret ?? ""; } catch { /* no body */ }
    const headerSecret = req.headers.get("x-cron-secret") ?? "";
    if (!CRON_SECRET || (bodySecret !== CRON_SECRET && headerSecret !== CRON_SECRET)) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    if (!RESEND_API_KEY) return json({ ok: false, error: "RESEND_API_KEY not set" }, 200);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Bookings whose plan expires between today and WINDOW_DAYS from now, that
    // aren't already renewed/closed.
    const today = new Date().toISOString().slice(0, 10);
    const until = new Date(Date.now() + WINDOW_DAYS * 86400000).toISOString().slice(0, 10);

    const { data: bookings, error } = await supabase
      .from("bookings")
      .select("id, booking_code, external_booking_id, client_name, business_name, contact_no, plan_name, plan_expiry_date, renewal_status, renewal_assigned_to")
      .not("plan_expiry_date", "is", null)
      .gte("plan_expiry_date", today)
      .lte("plan_expiry_date", until)
      .order("plan_expiry_date", { ascending: true });

    if (error) throw new Error(error.message);

    const expiring = (bookings ?? []).filter(
      (b: ExpiringBooking) => !CLOSED_STATUSES.includes(b.renewal_status ?? ""),
    );

    if (expiring.length === 0) {
      return json({ ok: true, message: "No plans expiring in window", notified: 0 });
    }

    // Profiles for name + email lookup
    const { data: profiles } = await supabase.from("profiles").select("id, full_name, email");
    const profileMap = new Map((profiles ?? []).map((p: { id: string; full_name: string | null; email: string | null }) => [p.id, p]));

    // Group by renewal owner; no owner -> "unassigned" bucket
    const grouped = new Map<string, ExpiringBooking[]>();
    for (const b of expiring as ExpiringBooking[]) {
      const key = b.renewal_assigned_to ?? "unassigned";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(b);
    }

    let notified = 0;
    const errors: string[] = [];

    for (const [userId, rows] of grouped) {
      // Unassigned expiring plans: send one summary to the renewals admin (if set).
      if (userId === "unassigned") {
        if (!RENEWALS_ADMIN_EMAIL) continue;
        const html = buildEmailHtml("Team", rows);
        const err = await sendEmail(
          RENEWALS_ADMIN_EMAIL,
          `🔁 ${rows.length} unassigned renewal${rows.length > 1 ? "s" : ""} expiring within ${WINDOW_DAYS} days`,
          html,
        );
        if (err) errors.push(err);
        else notified++;
        continue;
      }

      const profile = profileMap.get(userId);
      if (!profile?.email) continue;

      const firstName = (profile.full_name ?? "").split(" ")[0] || "Hi";
      const html = buildEmailHtml(firstName, rows);
      const err = await sendEmail(
        profile.email,
        `🔁 ${rows.length} renewal${rows.length > 1 ? "s" : ""} due within ${WINDOW_DAYS} days`,
        html,
      );
      if (err) errors.push(err);
      else notified++;
    }

    return json({
      ok: true,
      expiring: expiring.length,
      peopleNotified: notified,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 200);
  }
});
