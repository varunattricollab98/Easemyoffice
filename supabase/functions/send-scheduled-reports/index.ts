// Sends operational reports to subscribed admin recipients via Resend.
// Triggered manually from the Settings UI (force=true) OR by pg_cron daily/weekly.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("REPORTS_FROM_EMAIL") ?? "EaseMyOffice CRM <onboarding@resend.dev>";

const STAGES: Record<string, string> = {
  new_lead: "New Lead", contacted: "Contacted", interested: "Interested",
  quotation_shared: "Quotation Shared", negotiation: "Negotiation",
  followups: "Followups", payment_pending: "Payment Pending",
  payment_received: "Payment Received", documents_pending: "Documents Pending",
  draft_shared: "Draft Shared", agreement_signed: "Agreement Signed",
  completed: "Completed", renewal_due: "Renewal Due",
  not_interested: "Not interested", lost: "Lost",
};

function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map(r => headers.map(h => esc(r[h])).join(","))].join("\n");
}

async function buildReports(supabase: ReturnType<typeof createClient>, types: string[]) {
  const [leadsRes, fuRes, profRes] = await Promise.all([
    supabase.from("leads").select("*"),
    supabase.from("follow_ups").select("*"),
    supabase.from("profiles").select("id, full_name, email"),
  ]);
  const leads = leadsRes.data ?? [];
  const fus = fuRes.data ?? [];
  const profs = profRes.data ?? [];
  const nameOf = (id: string | null) => {
    const p = profs.find((x: any) => x.id === id);
    return p?.full_name || p?.email || "—";
  };
  const now = Date.now();
  const out: { name: string; csv: string; summary: { label: string; value: string }[] }[] = [];

  if (types.includes("overdue")) {
    const rows = fus
      .filter((f: any) => f.status === "pending" && f.due_at && new Date(f.due_at).getTime() < now)
      .map((f: any) => {
        const lead = leads.find((l: any) => l.id === f.lead_id);
        return {
          lead_code: lead?.lead_code ?? "", client: lead?.client_name ?? "",
          mobile: lead?.mobile ?? "", action: f.action,
          due_at: new Date(f.due_at).toLocaleString(),
          overdue_hours: Math.round((now - new Date(f.due_at).getTime()) / 3.6e6),
          owner: nameOf(f.owner_id), stage: STAGES[lead?.stage] ?? lead?.stage,
        };
      })
      .sort((a, b) => b.overdue_hours - a.overdue_hours);
    out.push({
      name: "overdue-followups.csv", csv: csv(rows),
      summary: [{ label: "Overdue follow-ups", value: String(rows.length) }],
    });
  }

  if (types.includes("pipeline")) {
    const rows = Object.entries(STAGES).map(([id, label]) => {
      const inStage = leads.filter((l: any) => l.stage === id);
      return {
        stage: label, total: inStage.length,
        hot: inStage.filter((l: any) => l.interest === "hot").length,
        overdue_followups: inStage.filter((l: any) => l.next_follow_up_at && new Date(l.next_follow_up_at).getTime() < now).length,
        stale_7d: inStage.filter((l: any) => (now - new Date(l.last_activity_at).getTime()) / 8.64e7 > 7).length,
      };
    });
    out.push({
      name: "pipeline-health.csv", csv: csv(rows),
      summary: [
        { label: "Total leads", value: String(leads.length) },
        { label: "Hot leads", value: String(leads.filter((l: any) => l.interest === "hot").length) },
        { label: "Won", value: String(leads.filter((l: any) => l.stage === "completed").length) },
      ],
    });
  }

  if (types.includes("productivity")) {
    const rows = profs.map((p: any) => {
      const myLeads = leads.filter((l: any) => l.assigned_to === p.id);
      const myFus = fus.filter((f: any) => f.owner_id === p.id);
      const won = myLeads.filter((l: any) => l.stage === "completed").length;
      return {
        employee: p.full_name || p.email, email: p.email,
        assigned_leads: myLeads.length,
        followups_completed: myFus.filter((f: any) => f.status === "completed").length,
        followups_overdue: myFus.filter((f: any) => f.status === "pending" && f.due_at && new Date(f.due_at).getTime() < now).length,
        won, win_rate: myLeads.length ? ((won / myLeads.length) * 100).toFixed(1) + "%" : "0%",
      };
    }).filter(r => r.assigned_leads > 0 || r.followups_completed > 0);
    out.push({
      name: "team-productivity.csv", csv: csv(rows),
      summary: [{ label: "Active employees", value: String(rows.length) }],
    });
  }
  return out;
}

function htmlBody(date: string, files: { name: string; summary: { label: string; value: string }[] }[]) {
  const sections = files.map(f => `
    <h3 style="margin:20px 0 8px;font-family:sans-serif;color:#1e293b">${f.name.replace(".csv", "").replace(/-/g, " ")}</h3>
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
      ${f.summary.map(s => `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${s.label}</td><td style="padding:4px 0;font-weight:600">${s.value}</td></tr>`).join("")}
    </table>`).join("");
  return `
    <div style="max-width:600px;margin:0 auto;padding:24px;font-family:sans-serif">
      <h2 style="color:#2563eb;margin:0 0 8px">EaseMyOffice CRM — Operational Report</h2>
      <p style="color:#64748b;margin:0">${date}</p>
      ${sections}
      <p style="margin-top:24px;color:#64748b;font-size:13px">CSV files are attached. Open in Excel or Google Sheets.</p>
    </div>`;
}

async function sendEmail(to: string, subject: string, html: string, attachments: { filename: string; content: string }[]) {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured. Connect Resend to enable scheduled emails.");
  const useGateway = !!LOVABLE_API_KEY;
  const url = useGateway ? "https://connector-gateway.lovable.dev/resend/emails" : "https://api.resend.com/emails";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (useGateway) {
    headers["Authorization"] = `Bearer ${LOVABLE_API_KEY}`;
    headers["X-Connection-Api-Key"] = RESEND_API_KEY;
  } else {
    headers["Authorization"] = `Bearer ${RESEND_API_KEY}`;
  }
  const res = await fetch(url, {
    method: "POST", headers,
    body: JSON.stringify({
      from: FROM_EMAIL, to: [to], subject, html,
      attachments: attachments.map(a => ({ filename: a.filename, content: btoa(a.content) })),
    }),
  });
  if (!res.ok) throw new Error(`Email send failed: ${res.status} ${await res.text()}`);
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const force = !!body.force;
    const subId = body.subscription_id as string | undefined;
    const cadence = body.cadence as "daily" | "weekly" | undefined;

    let q = supabase.from("report_subscriptions").select("*").eq("enabled", true);
    if (subId) q = q.eq("id", subId);
    else if (cadence) q = q.eq("frequency", cadence);
    const { data: subs, error } = await q;
    if (error) throw error;

    const date = new Date().toISOString().slice(0, 10);
    const results: { email: string; status: string; error?: string }[] = [];

    for (const s of (subs ?? []) as any[]) {
      try {
        // Skip if recently sent (unless forced)
        if (!force && s.last_sent_at) {
          const hoursSince = (Date.now() - new Date(s.last_sent_at).getTime()) / 3.6e6;
          const minHours = s.frequency === "weekly" ? 24 * 6 : 20;
          if (hoursSince < minHours) { results.push({ email: s.email, status: "skipped (too soon)" }); continue; }
        }
        const files = await buildReports(supabase, s.reports);
        await sendEmail(
          s.email,
          `EaseMyOffice CRM — ${s.frequency} report ${date}`,
          htmlBody(date, files),
          files.filter(f => f.csv).map(f => ({ filename: f.name, content: f.csv })),
        );
        await supabase.from("report_subscriptions").update({ last_sent_at: new Date().toISOString() }).eq("id", s.id);
        results.push({ email: s.email, status: "sent" });
      } catch (e) {
        results.push({ email: s.email, status: "failed", error: (e as Error).message });
      }
    }
    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
