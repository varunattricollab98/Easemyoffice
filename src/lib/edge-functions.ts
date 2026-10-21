// supabase.functions.invoke wrapper that keeps the real error.
//
// On any non-2xx reply supabase-js only says "Edge Function returned a non-2xx
// status code" and hides the function's own message in error.context (the
// Response). This reads that body so the user (and the admin looking at a
// screenshot) sees the actual reason, and retries once after refreshing the
// session when the function says the caller is not signed in (401) — an
// expired token on a laptop left open overnight.

import { supabase } from "@/integrations/supabase/client";

async function messageFrom(error: unknown): Promise<{ status: number | null; message: string }> {
  const e = error as { message?: string; context?: Response };
  const res = e?.context;
  if (res && typeof res.status === "number") {
    let msg = "";
    try {
      const text = await res.clone().text();
      try {
        const j = JSON.parse(text) as { error?: string; message?: string };
        msg = j.error || j.message || "";
      } catch {
        msg = text.slice(0, 200);
      }
    } catch {
      /* body already read / unavailable */
    }
    return { status: res.status, message: msg || `Server error (${res.status})` };
  }
  return { status: null, message: e?.message || "The service is unreachable" };
}

export async function invokeFunction<T = unknown>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  let { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let info = await messageFrom(error);
    if (info.status === 401) {
      const { error: refreshErr } = await supabase.auth.refreshSession();
      if (!refreshErr) {
        ({ data, error } = await supabase.functions.invoke(name, { body }));
        if (!error) return data as T;
        info = await messageFrom(error);
      }
      if (info.status === 401) {
        throw new Error("Your login session has expired. Please sign out and sign in again.");
      }
    }
    throw new Error(info.message);
  }
  return data as T;
}
