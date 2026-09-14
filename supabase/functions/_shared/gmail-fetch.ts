// Shared, retry-aware fetch for the Gmail Apps Script Web App.
//
// WHY THIS EXISTS
// The Apps Script Web App normally returns JSON. But Google intermittently
// serves an HTML interstitial instead — a login / account-chooser / consent /
// "unusual traffic" page (recognisable by `<!DOCTYPE html>` / `window['ppConfig']`)
// — even when the deployment is correctly set to "Anyone" and the URL/token are
// right. When that happens JSON.parse fails and the caller used to surface a raw
// HTML dump as the error (e.g. "Bad response from Gmail: <!DOCTYPE html>...").
// The condition is transient: the very next request usually succeeds. So we
// retry a few times with a short backoff before giving up, and when we do give
// up we return a short, human-friendly message instead of a page of HTML.
//
// Used by:
//   - gmail-bridge/index.ts   (interactive inbox/thread/claim)
//   - gmail-tag-sync/index.ts (cron sweep of tagged threads)

/** Does this text look like a Google HTML interstitial rather than our JSON? */
export function looksLikeGoogleInterstitial(text: string): boolean {
  const head = text.slice(0, 500).toLowerCase();
  return (
    head.includes("<!doctype html") ||
    head.includes("<html") ||
    head.includes("window['ppconfig']") ||
    head.includes('window["ppconfig"]') ||
    head.includes("accounts.google.com")
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GmailFetchOk {
  ok: true;
  data: any;
}
export interface GmailFetchErr {
  ok: false;
  error: string;
  /** true when we exhausted retries against a Google HTML interstitial. */
  transient?: boolean;
}
export type GmailFetchResult = GmailFetchOk | GmailFetchErr;

export interface GmailFetchOptions {
  method?: "GET" | "POST";
  body?: unknown;
  /** Total attempts including the first (default 3). */
  attempts?: number;
  /** Base backoff in ms; grows linearly per retry (default 400). */
  backoffMs?: number;
}

/**
 * Fetch `url` and parse a JSON response, retrying when Google returns a
 * transient HTML interstitial instead of JSON.
 *
 * Resolves to { ok:true, data } on success, or { ok:false, error, transient }
 * when every attempt failed. Never throws for the interstitial/parse case; the
 * caller decides how to present `error`.
 */
export async function gmailFetchJson(
  url: string,
  opts: GmailFetchOptions = {},
): Promise<GmailFetchResult> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const backoffMs = opts.backoffMs ?? 400;
  const method = opts.method ?? "GET";

  let lastText = "";
  let lastNetworkError = "";

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(backoffMs * attempt);

    let text = "";
    try {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        ...(method === "POST"
          ? {
              headers: { "Content-Type": "application/json" },
              body: typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body ?? {}),
            }
          : {}),
      });
      text = await res.text();
    } catch (e) {
      // Network/transport hiccup — retry.
      lastNetworkError = (e as Error).message;
      continue;
    }

    lastText = text;

    // Transient HTML interstitial -> retry.
    if (looksLikeGoogleInterstitial(text)) continue;

    try {
      return { ok: true, data: JSON.parse(text) };
    } catch {
      // Non-JSON, non-interstitial (rare). Retry; the snippet is kept for the
      // final error if all attempts fail.
      continue;
    }
  }

  if (lastText && looksLikeGoogleInterstitial(lastText)) {
    return {
      ok: false,
      transient: true,
      error:
        "Gmail is temporarily busy (Google returned a sign-in/verification page). Please hit Refresh again in a moment.",
    };
  }
  if (lastNetworkError && !lastText) {
    return { ok: false, error: `Could not reach Gmail: ${lastNetworkError}` };
  }
  return { ok: false, error: `Unexpected response from Gmail: ${lastText.slice(0, 120)}` };
}
