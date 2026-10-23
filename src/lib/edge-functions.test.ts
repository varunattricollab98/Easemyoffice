// Showing the real reason an edge function refused.
//
// supabase-js replaces every non-2xx reply with "Edge Function returned a
// non-2xx status code" and hides the function's own message in error.context.
// That is why a screenshot of a failed punch said nothing useful, and why an
// expired token on a phone left open overnight looked like a server fault.

import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const refreshSession = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    auth: { refreshSession: () => refreshSession() },
  },
}));

import { invokeFunction } from "./edge-functions";

/** What supabase-js hands back for a non-2xx reply. */
function functionsError(status: number, body: string, contentType = "application/json") {
  return {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: new Response(body, { status, headers: { "content-type": contentType } }),
  };
}

afterEach(() => {
  invoke.mockReset();
  refreshSession.mockReset();
});

describe("invokeFunction", () => {
  it("passes the body through and returns the data", async () => {
    invoke.mockResolvedValue({ data: { ok: true, attendance: { id: "a1" } }, error: null });
    const data = await invokeFunction<{ ok: boolean }>("attendance-punch", { action: "login" });

    expect(invoke).toHaveBeenCalledWith("attendance-punch", { body: { action: "login" } });
    expect(data).toEqual({ ok: true, attendance: { id: "a1" } });
  });

  it("reports the function's own message from an error body", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: functionsError(400, JSON.stringify({ error: "action must be login or logout" })),
    });
    await expect(invokeFunction("attendance-punch", {})).rejects.toThrow(
      "action must be login or logout",
    );
  });

  it("accepts either 'error' or 'message' in the body", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: functionsError(422, JSON.stringify({ message: "Employee record not linked" })),
    });
    await expect(invokeFunction("attendance-punch", {})).rejects.toThrow(
      "Employee record not linked",
    );
  });

  it("falls back to a plain-text body", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: functionsError(502, "upstream connect error", "text/plain"),
    });
    await expect(invokeFunction("hr-requests", {})).rejects.toThrow("upstream connect error");
  });

  it("truncates a huge body instead of dumping it at the user", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: functionsError(500, "x".repeat(5000), "text/plain"),
    });
    await expect(invokeFunction("hr-requests", {})).rejects.toThrow(/^x{200}$/);
  });

  it("names the status when the body is empty", async () => {
    // Better than the generic supabase-js wording, which says nothing.
    invoke.mockResolvedValue({ data: null, error: functionsError(503, "") });
    await expect(invokeFunction("attendance-punch", {})).rejects.toThrow("Server error (503)");
  });

  it("says the service is unreachable when there is no response at all", async () => {
    // A dropped connection: no context, and sometimes no message either.
    invoke.mockResolvedValue({ data: null, error: { message: "Failed to fetch" } });
    await expect(invokeFunction("attendance-punch", {})).rejects.toThrow("Failed to fetch");

    invoke.mockResolvedValue({ data: null, error: {} });
    await expect(invokeFunction("attendance-punch", {})).rejects.toThrow(
      "The service is unreachable",
    );
  });

  it("refreshes an expired session once and retries", async () => {
    // The overnight-tab case: the token expired, the function says 401, and a
    // refresh is enough — the user should never see an error for this.
    invoke
      .mockResolvedValueOnce({ data: null, error: functionsError(401, "") })
      .mockResolvedValueOnce({ data: { ok: true }, error: null });
    refreshSession.mockResolvedValue({ error: null });

    await expect(invokeFunction("attendance-punch", { action: "login" })).resolves.toEqual({
      ok: true,
    });
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(2);
    // The retry must send the same body.
    expect(invoke.mock.calls[1]).toEqual(["attendance-punch", { body: { action: "login" } }]);
  });

  it("asks the user to sign in again when the refresh does not help", async () => {
    invoke.mockResolvedValue({ data: null, error: functionsError(401, "") });
    refreshSession.mockResolvedValue({ error: null });

    await expect(invokeFunction("attendance-punch", {})).rejects.toThrow(
      "Your login session has expired. Please sign out and sign in again.",
    );
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("asks the user to sign in again when the refresh itself fails", async () => {
    invoke.mockResolvedValue({ data: null, error: functionsError(401, "") });
    refreshSession.mockResolvedValue({ error: { message: "refresh_token_not_found" } });

    await expect(invokeFunction("attendance-punch", {})).rejects.toThrow(
      "Your login session has expired. Please sign out and sign in again.",
    );
    // No point retrying the call without a fresh token.
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("reports the retry's own failure when it is not another 401", async () => {
    invoke
      .mockResolvedValueOnce({ data: null, error: functionsError(401, "") })
      .mockResolvedValueOnce({
        data: null,
        error: functionsError(400, JSON.stringify({ error: "Device not approved" })),
      });
    refreshSession.mockResolvedValue({ error: null });

    await expect(invokeFunction("attendance-punch", {})).rejects.toThrow("Device not approved");
  });

  it("does not refresh the session for an ordinary failure", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: functionsError(400, JSON.stringify({ error: "Too many attempts" })),
    });
    await expect(invokeFunction("attendance-punch", {})).rejects.toThrow("Too many attempts");
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("returns a verdict body unchanged — a refusal is not an error", async () => {
    // The punch function answers HTTP 200 with { ok: false, reason } so the
    // UI can offer work-from-home instead of showing a failure.
    invoke.mockResolvedValue({
      data: { ok: false, reason: "outside_geofence", attempts_left: 2 },
      error: null,
    });
    await expect(invokeFunction("attendance-punch", {})).resolves.toEqual({
      ok: false,
      reason: "outside_geofence",
      attempts_left: 2,
    });
  });
});
