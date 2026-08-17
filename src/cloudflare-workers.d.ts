// Ambient types for the `cloudflare:workers` virtual module.
//
// This module is provided by the Cloudflare Workers runtime at execution time,
// so it has no npm package backing it and `tsc` cannot resolve it on its own.
// We declare only the surface we actually use (`env`) rather than pulling in
// `@cloudflare/workers-types`, whose global DOM-overlapping declarations
// conflict with this project's `lib: ["DOM", ...]` browser/SSR setup.
//
// See src/server.ts, which reads Worker vars/secrets from `env`.
declare module "cloudflare:workers" {
  /**
   * The Worker's configured vars and secrets. May be a non-enumerable proxy,
   * so read known keys directly instead of iterating it.
   */
  export const env: Record<string, unknown> | undefined;
}
