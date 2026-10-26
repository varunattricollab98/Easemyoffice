// Signing in when the auth server is briefly unavailable.
//
// At the morning peak the whole team signs in within the same few minutes. A
// network drop or a 5xx/52x from the auth server makes supabase-js return an
// AuthRetryableFetchError whose message stringifies to "{}" — which is exactly
// what people saw under the Sign in button in October 2026. Those failures are
// retryable and must not be shown as a login error; a wrong password must be.

import { isTimeoutError, withTimeout } from "@/lib/with-timeout";

export type AuthLikeError = { name?: string; message?: string } | null | undefined;

/** Waits between sign-in attempts. Three tries in total, ~5 s worst case. */
export const AUTH_RETRY_DELAYS_MS = [1500, 3500];

/**
 * How long to wait for the auth server before giving up on an attempt.
 * supabase-js sets no timeout, so without this a dead server leaves the
 * button on "Signing in…" indefinitely.
 */
export const AUTH_TIMEOUT_MS = 12_000;

export const AUTH_UNREACHABLE =
  "Could not reach the login server. Check your internet and try again in a minute.";

/**
 * True when the failure is about reaching the server rather than the
 * credentials. An empty or "{}" message means supabase-js had no response body
 * to report, which is never how a rejected password comes back.
 */
export function isRetryableAuthError(error: AuthLikeError): boolean {
  if (!error) return false;
  // A server that did not answer within AUTH_TIMEOUT_MS is not having a blip,
  // it is down. Retrying twice more would keep the user waiting ~40 s to be
  // told the same thing.
  if (error.name === "TimeoutError") return false;
  return error.name === "AuthRetryableFetchError" || !error.message || error.message === "{}";
}

/** What to show the user: the server's reason, or plain words for a drop-out. */
export function authErrorMessage(error: AuthLikeError): string {
  if (!error) return "";
  return isRetryableAuthError(error) ? AUTH_UNREACHABLE : (error.message as string);
}

/**
 * Runs `signIn`, retrying only while the failure looks like a transport
 * problem. Returns the last result, so the caller reports a real credential
 * error immediately and without delay.
 */
export async function signInWithRetry<T extends { error: AuthLikeError }>(
  signIn: () => Promise<T>,
  opts: { delays?: number[]; sleep?: (ms: number) => Promise<void>; timeoutMs?: number } = {},
): Promise<T> {
  const delays = opts.delays ?? AUTH_RETRY_DELAYS_MS;
  const timeoutMs = opts.timeoutMs ?? AUTH_TIMEOUT_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // A hang is reported as a TimeoutError, which isRetryableAuthError treats as
  // final, so the user is told the server is unreachable instead of watching a
  // spinner.
  const attempt = async (): Promise<T> => {
    try {
      return await withTimeout(signIn(), timeoutMs, AUTH_UNREACHABLE);
    } catch (e) {
      if (isTimeoutError(e)) {
        return { error: { name: "TimeoutError", message: AUTH_UNREACHABLE } } as unknown as T;
      }
      throw e;
    }
  };

  let result = await attempt();
  for (const wait of delays) {
    if (!isRetryableAuthError(result.error)) break;
    await sleep(wait);
    result = await attempt();
  }
  return result;
}
