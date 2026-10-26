// Stopping the wait when the server stops answering.
//
// On 26 Oct 2026 the Supabase project stopped responding — auth, the Data API
// and the edge functions all hung. supabase-js has no fetch timeout, so the
// Sign in button sat on "Signing in…" and the attendance LOGIN button on
// "Checking location…" with no error anywhere. These tests pin the behaviour
// that makes such an outage visible instead of silent.

import { afterEach, describe, expect, it, vi } from "vitest";
import { isTimeoutError, withTimeout, TimeoutError } from "./with-timeout";

afterEach(() => {
  vi.useRealTimers();
});

describe("withTimeout", () => {
  it("passes a value through when it arrives in time", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000, "too slow")).resolves.toBe("ok");
  });

  it("passes a rejection through unchanged", async () => {
    // A real error must not be dressed up as a timeout.
    await expect(withTimeout(Promise.reject(new Error("nope")), 1000, "too slow")).rejects.toThrow(
      "nope",
    );
  });

  it("rejects with the given message once the time is up", async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => {});
    const p = withTimeout(never, 12_000, "The server is not responding.");
    const assertion = expect(p).rejects.toThrow("The server is not responding.");
    await vi.advanceTimersByTimeAsync(12_000);
    await assertion;
  });

  it("does not fire early", async () => {
    vi.useFakeTimers();
    let settled = false;
    const never = new Promise<string>(() => {});
    const p = withTimeout(never, 12_000, "too slow").catch(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(11_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(settled).toBe(true);
  });

  it("clears its timer when the promise wins, so nothing is left pending", async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve("ok"), 5000, "too slow")).resolves.toBe("ok");
    // A leaked timer would keep a Node process (and a test run) alive.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is recognisable to callers", () => {
    expect(isTimeoutError(new TimeoutError("x"))).toBe(true);
    expect(isTimeoutError({ name: "TimeoutError" })).toBe(true);
    expect(isTimeoutError(new Error("x"))).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
  });
});
