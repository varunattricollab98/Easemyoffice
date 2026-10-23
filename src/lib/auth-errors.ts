// Signing in when the auth server is briefly unavailable.
//
// At the morning peak the whole team signs in within the same few minutes. A
// network drop or a 5xx/52x from the auth server makes supabase-js return an
// AuthRetryableFetchError whose message stringifies to "{}" — which is exactly
// what people saw under the Sign in button in October 2026. Those failures are
// retryable and must not be shown as a login error; a wrong password must be.

export type AuthLikeError = { name?: string; message?: string } | null | undefined;

/** Waits between sign-in attempts. Three tries in total, ~5 s worst case. */
export const AUTH_RETRY_DELAYS_MS = [1500, 3500];

export const AUTH_UNREACHABLE =
  "Could not reach the login server. Check your internet and try again in a minute.";

/**
 * True when the failure is about reaching the server rather than the
 * credentials. An empty or "{}" message means supabase-js had no response body
 * to report, which is never how a rejected password comes back.
 */
export function isRetryableAuthError(error: AuthLikeError): boolean {
  if (!error) return false;
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
  opts: { delays?: number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const delays = opts.delays ?? AUTH_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let result = await signIn();
  for (const wait of delays) {
    if (!isRetryableAuthError(result.error)) break;
    await sleep(wait);
    result = await signIn();
  }
  return result;
}
