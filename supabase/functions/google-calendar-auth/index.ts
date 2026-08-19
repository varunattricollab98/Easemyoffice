// Google Calendar OAuth Authorization Flow
// GET with action=authorize -> redirects to Google OAuth consent page
// This is a one-time setup where the admin authorizes calendar access
// After auth, the callback function stores refresh_token in crm_settings table

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_REDIRECT_URI = Deno.env.get("GOOGLE_REDIRECT_URI")!;
const SCOPES = "https://www.googleapis.com/auth/calendar.events";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "GET") {
      throw new Error("Use GET");
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "authorize") {
      // Build Google OAuth URL
      const authUrl = new URL(
        "https://accounts.google.com/o/oauth2/v2/auth"
      );
      authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", GOOGLE_REDIRECT_URI);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", SCOPES);
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
      // State parameter for CSRF protection
      authUrl.searchParams.set("state", "easemyoffice_calendar_auth");

      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          Location: authUrl.toString(),
        },
      });
    }

    if (action === "status") {
      // Check if Google Calendar is already connected
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const sb = createClient(supabaseUrl, supabaseKey);

      const { data } = await sb
        .from("crm_settings")
        .select("value")
        .eq("key", "google_calendar_tokens")
        .single();

      const connected = !!(data?.value as any)?.refresh_token;

      return new Response(
        JSON.stringify({ ok: true, connected }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        ok: false,
        error:
          'Invalid action. Use ?action=authorize to start OAuth flow or ?action=status to check connection.',
      }),
      {
        status: 400,
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
