// The "{}" under the Sign in button.
//
// Several people could not sign in during the October 2026 morning peak and
// the only thing on screen was "{}". supabase-js had stringified a Response it
// could not read, so the UI showed an empty object where a reason should be.
// These tests pin both halves of the fix: retry a transport failure, and never
// retry or dress up a wrong password.

import { describe, expect, it, vi } from "vitest";
import {
  authErrorMessage,
  isRetryableAuthError,
  signInWithRetry,
  AUTH_RETRY_DELAYS_MS,
  AUTH_UNREACHABLE,
} from "./auth-errors";

const RETRYABLE = [
  { name: "AuthRetryableFetchError", message: "Failed to fetch" },
  // A Response that could not be read stringifies to "{}".
  { name: "AuthApiError", message: "{}" },
  { name: "AuthApiError", message: "" },
  { name: "AuthApiError" },
];
const CREDENTIALS = { name: "AuthApiError", message: "Invalid login credentials" };

describe("isRetryableAuthError", () => {
  it("treats a transport failure and an empty message as retryable", () => {
    for (const e of RETRYABLE) expect(isRetryableAuthError(e)).toBe(true);
  });

  it("does not retry a real credential error", () => {
    expect(isRetryableAuthError(CREDENTIALS)).toBe(false);
    expect(isRetryableAuthError({ name: "AuthApiError", message: "Email not confirmed" })).toBe(
      false,
    );
  });

  it("is false when there is no error", () => {
    expect(isRetryableAuthError(null)).toBe(false);
    expect(isRetryableAuthError(undefined)).toBe(false);
  });
});

describe("authErrorMessage", () => {
  it("explains a drop-out in plain words instead of showing '{}'", () => {
    for (const e of RETRYABLE) expect(authErrorMessage(e)).toBe(AUTH_UNREACHABLE);
    expect(AUTH_UNREACHABLE).not.toContain("{}");
  });

  it("passes a credential error through unchanged", () => {
    expect(authErrorMessage(CREDENTIALS)).toBe("Invalid login credentials");
  });

  it("has nothing to say when the sign-in succeeded", () => {
    expect(authErrorMessage(null)).toBe("");
  });
});

describe("signInWithRetry", () => {
  const sleep = () => Promise.resolve();

  it("does not retry a successful sign-in", async () => {
    const signIn = vi.fn().mockResolvedValue({ error: null });
    await expect(signInWithRetry(signIn, { sleep })).resolves.toEqual({ error: null });
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("recovers when the server comes back on the second try", async () => {
    const signIn = vi
      .fn()
      .mockResolvedValueOnce({ error: { name: "AuthRetryableFetchError", message: "{}" } })
      .mockResolvedValueOnce({ error: null, data: { user: { id: "u1" } } });

    const res = await signInWithRetry(signIn, { sleep });
    expect(res.error).toBeNull();
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it("gives up after three attempts and returns the last failure", async () => {
    const error = { name: "AuthRetryableFetchError", message: "{}" };
    const signIn = vi.fn().mockResolvedValue({ error });

    const res = await signInWithRetry(signIn, { sleep });
    expect(signIn).toHaveBeenCalledTimes(1 + AUTH_RETRY_DELAYS_MS.length);
    expect(authErrorMessage(res.error)).toBe(AUTH_UNREACHABLE);
  });

  it("fails a wrong password immediately, with no waiting", async () => {
    // Retrying a rejected password would make every typo take five seconds.
    const signIn = vi.fn().mockResolvedValue({ error: CREDENTIALS });
    const waits: number[] = [];

    const res = await signInWithRetry(signIn, { sleep: (ms) => (waits.push(ms), sleep()) });
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
    expect(authErrorMessage(res.error)).toBe("Invalid login credentials");
  });

  it("waits longer before each retry", async () => {
    const waits: number[] = [];
    const signIn = vi.fn().mockResolvedValue({ error: { name: "AuthRetryableFetchError" } });

    await signInWithRetry(signIn, { sleep: (ms) => (waits.push(ms), sleep()) });
    expect(waits).toEqual(AUTH_RETRY_DELAYS_MS);
    expect(waits[1]).toBeGreaterThan(waits[0]);
    // Long enough to outlast a blip, short enough that nobody walks away.
    expect(waits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(6000);
  });

  it("stops as soon as the error becomes a real one", async () => {
    const signIn = vi
      .fn()
      .mockResolvedValueOnce({ error: { name: "AuthRetryableFetchError" } })
      .mockResolvedValueOnce({ error: CREDENTIALS });

    const res = await signInWithRetry(signIn, { sleep });
    expect(signIn).toHaveBeenCalledTimes(2);
    expect(res.error).toEqual(CREDENTIALS);
  });

  it("really does wait between attempts by default", async () => {
    vi.useFakeTimers();
    try {
      const signIn = vi.fn().mockResolvedValue({ error: { name: "AuthRetryableFetchError" } });
      const done = vi.fn();
      void signInWithRetry(signIn).then(done);

      await vi.advanceTimersByTimeAsync(0);
      expect(signIn).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1500);
      expect(signIn).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(3500);
      expect(signIn).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
