// Tiny logging wrapper.
//
// Centralizes client-side logging so calls aren't scattered raw `console.*`
// across components, and so non-error noise can be silenced in production while
// warnings/errors always surface. Server/edge code and the error boundary keep
// using console directly (they run outside this client context).
//
// `import.meta.env.DEV` is true in `vite dev` and false in a production build,
// so debug/info logs vanish from the shipped bundle's runtime behavior.

const isDev = typeof import.meta !== "undefined" && !!import.meta.env?.DEV;

export const logger = {
  /** Verbose developer logs — only emitted in dev. */
  debug(...args: unknown[]): void {
    if (isDev) console.log(...args);
  },
  /** Informational logs — only emitted in dev. */
  info(...args: unknown[]): void {
    if (isDev) console.info(...args);
  },
  /** Warnings — always emitted. */
  warn(...args: unknown[]): void {
    console.warn(...args);
  },
  /** Errors — always emitted. */
  error(...args: unknown[]): void {
    console.error(...args);
  },
};
