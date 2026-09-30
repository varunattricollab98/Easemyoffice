// HR alerts: an in-CRM notification (bell + desktop alert) and, where an
// address exists, an email via Resend — the same provider the quotation and
// payment-ack emails already use (RESEND_API_KEY, CRM_FROM_EMAIL).
//
// Best-effort by design: a failed email must never undo the request or
// approval that triggered it, so every error is caught and only reported back.

// deno-lint-ignore-file no-explicit-any
type Db = any;

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL =
  Deno.env.get("CRM_FROM_EMAIL") ??
  Deno.env.get("REPORTS_FROM_EMAIL") ??
  "EaseMyOffice CRM <onboarding@resend.dev>";
export const APP_URL = (
  Deno.env.get("CRM_APP_URL") ?? "https://easemyoffice.emo-crm.workers.dev"
).replace(/\/$/, "");

export const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export type Alert = {
  /** notifications.type */
  type: string;
  title: string;
  body: string;
  /** Rows of label → value shown in the email. */
  details?: [string, string][];
  /** Path in the CRM the email button links to, e.g. /hrms/approvals. */
  path: string;
  cta: string;
};

function emailHtml(a: Alert): string {
  const rows = (a.details ?? [])
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top">${esc(
          k,
        )}</td><td style="padding:6px 0;color:#111827;font-size:13px">${esc(v)}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid #e5e7eb">
<tr><td style="padding:22px 24px 6px;font-size:17px;font-weight:600;color:#111827">${esc(a.title)}</td></tr>
<tr><td style="padding:0 24px 12px;font-size:14px;color:#374151;line-height:1.5">${esc(a.body)}</td></tr>
${rows ? `<tr><td style="padding:0 24px 8px"><table role="presentation" cellpadding="0" cellspacing="0">${rows}</table></td></tr>` : ""}
<tr><td style="padding:12px 24px 24px"><a href="${esc(APP_URL + a.path)}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:10px">${esc(
    a.cta,
  )}</a></td></tr>
</table>
<div style="font-size:11px;color:#9ca3af;padding-top:10px">EaseMyOffice CRM · Staff &amp; Attendance</div>
</td></tr></table></body></html>`;
}

async function sendEmail(to: string[], a: Alert): Promise<string | null> {
  if (!RESEND_API_KEY || to.length === 0) return RESEND_API_KEY ? null : "RESEND_API_KEY not set";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject: a.title, html: emailHtml(a) }),
    });
    return res.ok ? null : `email ${res.status}: ${(await res.text()).slice(0, 200)}`;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function bell(db: Db, userIds: string[], a: Alert) {
  if (userIds.length === 0) return;
  try {
    await db
      .from("notifications")
      .insert(userIds.map((user_id) => ({ user_id, type: a.type, title: a.title, body: a.body })));
  } catch {
    /* best-effort */
  }
}

/** Every admin: bell + email. Returns an email error, if any, for logging. */
export async function notifyAdmins(db: Db, a: Alert): Promise<string | null> {
  const { data: roles } = await db.from("user_roles").select("user_id").eq("role", "admin");
  const ids = [...new Set(((roles ?? []) as { user_id: string }[]).map((r) => r.user_id))];
  if (ids.length === 0) return "no admin users";
  const { data: profiles } = await db.from("profiles").select("id, email").in("id", ids);
  const emails = ((profiles ?? []) as { email: string | null }[])
    .map((p) => (p.email ?? "").trim())
    .filter((e) => e.includes("@"));
  await bell(db, ids, a);
  return sendEmail([...new Set(emails)], a);
}

/** One user (the employee): bell + email to their CRM login address. */
export async function notifyUser(
  db: Db,
  profileId: string | null,
  a: Alert,
): Promise<string | null> {
  if (!profileId) return "no linked login";
  const { data: p } = await db.from("profiles").select("email").eq("id", profileId).maybeSingle();
  await bell(db, [profileId], a);
  const email = (p?.email ?? "").trim();
  return email.includes("@") ? sendEmail([email], a) : null;
}
