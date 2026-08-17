// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  nitro: true,
  vite: {
    build: {
      rollupOptions: {
        // `cloudflare:workers` is a virtual module provided by the Workers
        // runtime at execution time — Rollup can't and shouldn't resolve it
        // during the build. Without this the SSR build fails and the whole
        // `npm run build` exits 1, which aborts the Cloudflare deploy.
        // src/server.ts already guards its use with try/catch and falls back
        // to the fetch() env argument.
        external: ["cloudflare:workers"],
      },
    },
  },
});
