import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Unit tests for pure logic (e.g. booking money math). The Playwright e2e
// suite under e2e/ is separate and excluded here so `vitest` and `playwright`
// never try to run each other's specs.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**"],
  },
});
