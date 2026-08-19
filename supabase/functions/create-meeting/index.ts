// Create Meeting Edge Function
// Creates a Google Calendar event with Google Meet link
// Sends email notifications to both client and salesperson via Resend
//
// Body: { title, description, startTime, duration, attendeeEmail, salesPersonName, salesPersonEmail }
// Returns: { ok: true, meetLink, eventId, eventUrl }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL =
  Deno.env.get("CRM_FROM_EMAIL") ??
  "EaseMyOffice <onboarding@resend.dev>";

// Refresh Google access token if expired
async function getValidAccessToken(
  sb: ReturnType<typeof createClient>
): Promise<string> {
  const { data, error } = await sb
    .from("crm_settings")
    .select("value")
    .eq("key", "google_calendar_tokens")
    .single();

  if (error || !data?.value) {
    throw new Error(
      "Google Calendar is not connected. Please authorize first from Calendar settings."
    );
  }

  const tokens = data.value as {
    access_token: string;
    refresh_token: string;
    expires_at: string;
  };

  // Check if token is still valid (with 5 min buffer)
  const expiresAt = new Date(tokens.expires_at).getTime();
  const now = Date.now();

  if (now < expiresAt - 5 * 60 * 1000) {
    return tokens.access_token;
  }

  // Token expired, refresh it
  if (!tokens.refresh_token) {
    throw new Error(
      "No refresh token available. Please re-authorize Google Calendar."
    );
  }

  const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const refreshData = await refreshResponse.json();

  if (!refreshResponse.ok || refreshData.error) {
    throw new Error(
      `Token refresh failed: ${refreshData.error_description || refreshData.error}. Please re-authorize Google Calendar.`
    );
  }

  const newTokens = {
    access_token: refreshData.access_token,
    refresh_token: tokens.refresh_token, // Keep original refresh token
    expires_at: new Date(
      Date.now() + (refreshData.expires_in || 3600) * 1000
    ).toISOString(),
  };

  // Update stored tokens
  await sb.from("crm_settings").upsert(
    {
      key: "google_calendar_tokens",
      value: newTokens,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );

  return refreshData.access_token;
}

// Send email via Resend
async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not configured, skipping email to:", to);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Failed to send email to ${to}: ${errText}`);
  }
}

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function buildClientEmailHtml(
  title: string,
  meetLink: string,
  startTime: string,
  duration: string,
  salesPersonName: string
): string {
  return `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0">
      <div style="text-align:center;margin-bottom:24px">
        <div style="background:linear-gradient(135deg,#10b981,#059669);width:56px;height:56px;border-radius:14px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px">
          <span style="font-size:24px">📹</span>
        </div>
        <h1 style="font-size:22px;font-weight:700;color:#0f172a;margin:0">Meeting Scheduled</h1>
        <p style="color:#64748b;font-size:14px;margin-top:8px">You have a meeting with EaseMyOffice</p>
      </div>
      <div style="background:#f8fafc;border-radius:12px;padding:20px;margin:20px 0;border:1px solid #e2e8f0">
        <h2 style="font-size:16px;font-weight:600;color:#0f172a;margin:0 0 12px">${title}</h2>
        <p style="color:#475569;font-size:14px;margin:6px 0"><strong>Date & Time:</strong> ${formatDateTime(startTime)}</p>
        <p style="color:#475569;font-size:14px;margin:6px 0"><strong>Duration:</strong> ${duration} minutes</p>
        <p style="color:#475569;font-size:14px;margin:6px 0"><strong>Host:</strong> ${salesPersonName} (EaseMyOffice)</p>
      </div>
      <div style="text-align:center;margin:28px 0">
        <a href="${meetLink}" style="display:inline-block;background:linear-gradient(135deg,#10b981,#059669);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;font-size:15px;box-shadow:0 4px 12px rgba(16,185,129,0.3)">
          Join Google Meet
        </a>
      </div>
      <p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:16px">
        This meeting was scheduled via EaseMyOffice CRM. If you have questions, reply to this email.
      </p>
    </div>
  `;
}

function buildSalesPersonEmailHtml(
  title: string,
  meetLink: string,
  startTime: string,
  duration: string,
  attendeeEmail: string,
  salesPersonName: string
): string {
  return `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0">
      <div style="text-align:center;margin-bottom:24px">
        <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);width:56px;height:56px;border-radius:14px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px">
          <span style="font-size:24px">🗓️</span>
        </div>
        <h1 style="font-size:22px;font-weight:700;color:#0f172a;margin:0">Meeting Confirmed</h1>
        <p style="color:#64748b;font-size:14px;margin-top:8px">Hi ${salesPersonName}, you have a meeting scheduled</p>
      </div>
      <div style="background:#f8fafc;border-radius:12px;padding:20px;margin:20px 0;border:1px solid #e2e8f0">
        <h2 style="font-size:16px;font-weight:600;color:#0f172a;margin:0 0 12px">${title}</h2>
        <p style="color:#475569;font-size:14px;margin:6px 0"><strong>Date & Time:</strong> ${formatDateTime(startTime)}</p>
        <p style="color:#475569;font-size:14px;margin:6px 0"><strong>Duration:</strong> ${duration} minutes</p>
        <p style="color:#475569;font-size:14px;margin:6px 0"><strong>Client:</strong> ${attendeeEmail}</p>
      </div>
      <div style="text-align:center;margin:28px 0">
        <a href="${meetLink}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;font-size:15px;box-shadow:0 4px 12px rgba(99,102,241,0.3)">
          Join Google Meet
        </a>
      </div>
      <p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:16px">
        Sent from EaseMyOffice CRM
      </p>
    </div>
  `;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      throw new Error("Use POST");
    }

    const {
      title,
      description,
      startTime,
      duration,
      attendeeEmail,
      salesPersonName,
      salesPersonEmail,
    } = await req.json();

    // Validate required fields
    if (!title) throw new Error("Meeting title is required");
    if (!startTime) throw new Error("Start time is required");
    if (!duration) throw new Error("Duration is required");
    if (!attendeeEmail) throw new Error("Client email is required");
    if (!salesPersonName) throw new Error("Sales person name is required");

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // Get valid access token (refreshes if expired)
    const accessToken = await getValidAccessToken(sb);

    // Calculate end time
    const start = new Date(startTime);
    const end = new Date(start.getTime() + Number(duration) * 60 * 1000);

    // Create Google Calendar event with Meet link
    const event = {
      summary: title,
      description: description || `Meeting scheduled via EaseMyOffice CRM`,
      start: {
        dateTime: start.toISOString(),
        timeZone: "Asia/Kolkata",
      },
      end: {
        dateTime: end.toISOString(),
        timeZone: "Asia/Kolkata",
      },
      attendees: [
        { email: attendeeEmail },
        ...(salesPersonEmail ? [{ email: salesPersonEmail }] : []),
      ],
      conferenceData: {
        createRequest: {
          requestId: `emo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "email", minutes: 30 },
          { method: "popup", minutes: 10 },
        ],
      },
    };

    const calResponse = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      }
    );

    const calData = await calResponse.json();

    if (!calResponse.ok) {
      throw new Error(
        `Google Calendar API error: ${calData.error?.message || JSON.stringify(calData.error) || "Unknown error"}`
      );
    }

    // Extract Meet link
    const meetLink =
      calData.conferenceData?.entryPoints?.find(
        (ep: any) => ep.entryPointType === "video"
      )?.uri || calData.hangoutLink || "";

    const eventId = calData.id;
    const eventUrl = calData.htmlLink;

    // Send email notifications
    const formattedDuration = String(duration);

    // Email to client
    if (attendeeEmail) {
      const clientSubject = `Meeting Scheduled: ${title} - EaseMyOffice`;
      const clientHtml = buildClientEmailHtml(
        title,
        meetLink,
        startTime,
        formattedDuration,
        salesPersonName || "EaseMyOffice Team"
      );
      await sendEmail(attendeeEmail, clientSubject, clientHtml);
    }

    // Email to salesperson
    if (salesPersonEmail) {
      const spSubject = `Meeting Confirmed: ${title} with ${attendeeEmail}`;
      const spHtml = buildSalesPersonEmailHtml(
        title,
        meetLink,
        startTime,
        formattedDuration,
        attendeeEmail,
        salesPersonName
      );
      await sendEmail(salesPersonEmail, spSubject, spHtml);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        meetLink,
        eventId,
        eventUrl,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
