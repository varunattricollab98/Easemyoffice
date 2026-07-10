import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TWILIO_GW = "https://connector-gateway.lovable.dev/twilio";
const RESEND_GW = "https://connector-gateway.lovable.dev/resend";

const fmtINR = (n: number) => `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (raw.trim().startsWith("+")) return "+" + digits;
  if (digits.length === 10) return "+91" + digits; // assume India
  if (digits.length === 12 && digits.startsWith("91")) return "+" + digits;
  return "+" + digits;
}

async function sendWhatsApp(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const lovable = process.env.LOVABLE_API_KEY;
  const twilio = process.env.TWILIO_API_KEY;
  const from = process.env.TWILIO_WHATSAPP_FROM; // e.g. "whatsapp:+14155238886"
  if (!lovable || !twilio || !from) return { ok: false, error: "twilio_not_configured" };
  const phone = normalizePhone(to);
  if (!phone) return { ok: false, error: "bad_phone" };
  const res = await fetch(`${TWILIO_GW}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovable}`,
      "X-Connection-Api-Key": twilio,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: `whatsapp:${phone}`, From: from, Body: body }),
  });
  if (!res.ok) return { ok: false, error: `twilio_${res.status}` };
  return { ok: true };
}

async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const lovable = process.env.LOVABLE_API_KEY;
  const resend = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || "EaseMyOffice <onboarding@resend.dev>";
  if (!lovable || !resend) return { ok: false, error: "resend_not_configured" };
  if (!to || !to.includes("@")) return { ok: false, error: "bad_email" };
  const res = await fetch(`${RESEND_GW}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovable}`,
      "X-Connection-Api-Key": resend,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!res.ok) return { ok: false, error: `resend_${res.status}` };
  return { ok: true };
}

export const Route = createFileRoute("/api/public/hooks/balance-reminders")({
  server: {
    handlers: {
      POST: async () => {
        const today = new Date().toISOString().slice(0, 10);
        const { data: bookings, error } = await supabaseAdmin
          .from("bookings")
          .select("id, booking_code, external_booking_id, client_name, business_name, contact_no, email_id, plan_name, balance_amount, balance_due_date, sales_agent_id, sales_agent_name")
          .is("balance_paid_at", null)
          .gt("balance_amount", 0)
          .not("balance_due_date", "is", null)
          .lte("balance_due_date", today);

        if (error) {
          return new Response(JSON.stringify({ ok: false, error: error.message }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }

        const results: Array<Record<string, unknown>> = [];

        for (const b of bookings ?? []) {
          const balance = Number(b.balance_amount);
          const code = b.external_booking_id || b.booking_code;
          const due = b.balance_due_date;

          const clientMsg = `Hi ${b.client_name}, this is a reminder from EaseMyOffice. Your pending balance of ${fmtINR(balance)} for booking ${code} (${b.plan_name}) was due on ${due}. Please complete the payment at your earliest. Thank you!`;
          const agentMsg = `Reminder: Booking ${code} — ${b.client_name} (${b.contact_no}) has a pending balance of ${fmtINR(balance)} (due ${due}). Please follow up.`;

          const channels: Record<string, unknown> = {};

          // Client WhatsApp
          if (b.contact_no) channels.client_whatsapp = await sendWhatsApp(b.contact_no, clientMsg);
          // Client email
          if (b.email_id) channels.client_email = await sendEmail(
            b.email_id,
            `Payment reminder: ${code} balance ${fmtINR(balance)} due`,
            `<p>Hi ${b.client_name},</p><p>${clientMsg}</p><p>— EaseMyOffice Team</p>`,
          );

          // Sales agent
          if (b.sales_agent_id) {
            const { data: profile } = await supabaseAdmin
              .from("profiles").select("email, phone").eq("id", b.sales_agent_id).maybeSingle();
            if (profile?.phone) channels.agent_whatsapp = await sendWhatsApp(profile.phone, agentMsg);
            if (profile?.email) channels.agent_email = await sendEmail(
              profile.email,
              `[Action] Balance pending: ${code} — ${fmtINR(balance)}`,
              `<p>${agentMsg}</p>`,
            );
          }

          await supabaseAdmin.from("bookings")
            .update({ last_reminder_sent_at: new Date().toISOString() })
            .eq("id", b.id);

          results.push({ booking_id: b.id, code, balance, channels });
        }

        return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
