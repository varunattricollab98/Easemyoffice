import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for KPI tile E2E coverage.
 *
 * Setup:
 *   bun add -d @playwright/test
 *   bunx playwright install --with-deps chromium
 *   bun run dev   # in another terminal
 *   bunx playwright test
 *
 * Required env (per role you want to cover):
 *   E2E_BASE_URL=http://localhost:5173
 *   E2E_ADMIN_EMAIL=...        E2E_ADMIN_PASSWORD=...
 *   E2E_SALES_EMAIL=...        E2E_SALES_PASSWORD=...
 *   E2E_DOCS_EMAIL=...         E2E_DOCS_PASSWORD=...   (optional)
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
