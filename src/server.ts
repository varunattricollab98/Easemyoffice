import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
// Cloudflare Workers (with @cloudflare/vite-plugin) deliver configured vars &
// secrets via this module — not via process.env or the fetch() env argument.
import { env as cloudflareEnv } from "cloudflare:workers";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => ((m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry)),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

const SERVER_ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SITE_URL",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PROJECT_ID",
  "VITE_SITE_URL",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "TWILIO_API_KEY",
  "TWILIO_WHATSAPP_FROM",
  "GOOGLE_SHEETS_API_KEY",
  "LOVABLE_API_KEY",
];

function bridgeEnvToProcess(fetchEnv: unknown): void {
  // Copy the Worker's configured vars/secrets onto process.env so all server
  // code that reads process.env.* works at runtime. We read specific keys
  // directly (rather than enumerating) because the cloudflare:workers env can be
  // a non-enumerable proxy. We try the cloudflare:workers module first, then the
  // fetch() env argument as a fallback.
  if (typeof process === "undefined" || !process.env) return;
  const sources: Array<Record<string, unknown>> = [];
  try {
    if (cloudflareEnv && typeof cloudflareEnv === "object") {
      sources.push(cloudflareEnv as unknown as Record<string, unknown>);
    }
  } catch {
    // cloudflare:workers env not available in this context — ignore.
  }
  if (fetchEnv && typeof fetchEnv === "object") {
    sources.push(fetchEnv as Record<string, unknown>);
  }
  for (const key of SERVER_ENV_KEYS) {
    if (process.env[key]) continue;
    for (const src of sources) {
      const value = src[key];
      if (typeof value === "string" && value) {
        process.env[key] = value;
        break;
      }
    }
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      bridgeEnvToProcess(env);
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return brandedErrorResponse();
    }
  },
};
