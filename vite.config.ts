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
        // Reduce initial JS payload by splitting heavy vendor libraries into
        // separate chunks that are only loaded by the routes that need them.
        output: {
          manualChunks(id) {
            // Recharts — only used by chart.tsx / reports / hero-today widget
            if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-")) {
              return "vendor-recharts";
            }
            // React-grid-layout — only used by dashboard widget grid
            if (id.includes("node_modules/react-grid-layout") || id.includes("node_modules/react-resizable")) {
              return "vendor-grid-layout";
            }
            // DnD Kit — only used by pipeline + KPI strip
            if (id.includes("node_modules/@dnd-kit")) {
              return "vendor-dnd";
            }
            // Radix UI — shared UI primitives, keep in one chunk for caching
            if (id.includes("node_modules/@radix-ui")) {
              return "vendor-radix";
            }
            // date-fns — used broadly but is tree-shakeable; isolate so main bundle stays lean
            if (id.includes("node_modules/date-fns")) {
              return "vendor-date-fns";
            }
            // Supabase client — large but loaded early; separate for long-term caching
            if (id.includes("node_modules/@supabase")) {
              return "vendor-supabase";
            }
            // TanStack (router + query + virtual) — core framework, stable across deploys
            if (id.includes("node_modules/@tanstack")) {
              return "vendor-tanstack";
            }
          },
        },
      },
    },
  },
});
