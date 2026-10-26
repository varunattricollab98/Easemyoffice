// Give up waiting, and say so.
//
// supabase-js puts no timeout on its fetch. When the project itself stops
// answering — as it did on 26 Oct 2026, when auth, the Data API and the edge
// functions all stopped responding at once — a sign-in or a punch simply hangs:
// the button sits on "Signing in…" / "Checking location…" forever, with no
// error, no toast and nothing in the console. The team reads that as "the CRM
// is broken" and nobody can tell it apart from a wrong password.
//
// A timeout does not fix an outage. It makes the outage legible.

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Rejects with a `TimeoutError` if `promise` has not settled within `ms`.
 * The underlying request is not cancelled — we just stop waiting on it.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

export function isTimeoutError(e: unknown): boolean {
  return e instanceof TimeoutError || (e as { name?: string } | null)?.name === "TimeoutError";
}
