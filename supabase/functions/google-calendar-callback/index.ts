// Google Calendar OAuth Callback
// Handles OAuth callback from Google after admin authorizes access
// Exchanges code for tokens (access_token + refresh_token)
// Stores tokens in crm_settings table (key: "google_calendar_tokens")
// Redirects back to CRM with success message

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const GOOGLE_REDIRECT_URI = Deno.env.get("GOOGLE_REDIRECT_URI")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
      // User denied access or some other error
      const crmUrl = Deno.env.get("CRM_APP_URL") ?? "https://easemyoffice.in";
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${crmUrl}/calendar?google_auth=error&reason=${encodeURIComponent(error)}`,
        },
      });
    }

    if (!code) {
      throw new Error("No authorization code received from Google");
    }

    // Exchange code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || tokenData.error) {
      throw new Error(
        `Token exchange failed: ${tokenData.error_description || tokenData.error || "Unknown error"}`
      );
    }

    const { access_token, refresh_token, expires_in } = tokenData;

    if (!access_token) {
      throw new Error("No access token received from Google");
    }

    // Calculate expiry timestamp
    const expires_at = new Date(
      Date.now() + (expires_in || 3600) * 1000
    ).toISOString();

    // Store tokens in crm_settings
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const tokensPayload = {
      access_token,
      refresh_token: refresh_token || null,
      expires_at,
    };

    // Upsert the tokens in crm_settings
    const { error: dbError } = await sb.from("crm_settings").upsert(
      {
        key: "google_calendar_tokens",
        value: tokensPayload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );

    if (dbError) {
      throw new Error(`Failed to store tokens: ${dbError.message}`);
    }

    // Redirect back to CRM calendar page with success
    const crmUrl = Deno.env.get("CRM_APP_URL") ?? "https://easemyoffice.in";
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${crmUrl}/calendar?google_auth=success`,
      },
    });
  } catch (e) {
    const crmUrl = Deno.env.get("CRM_APP_URL") ?? "https://easemyoffice.in";
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${crmUrl}/calendar?google_auth=error&reason=${encodeURIComponent((e as Error).message)}`,
      },
    });
  }
});
