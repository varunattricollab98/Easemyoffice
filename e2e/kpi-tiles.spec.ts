import { test, expect, type Page } from "@playwright/test";

/**
 * Verifies that every KPI tile on the dashboard navigates to the correct
 * filtered page with the expected query parameters, for every supported role.
 *
 * The matrix below mirrors `KpiStrip` in `src/components/dashboard/widget-grid.tsx`.
 * If you add or change a tile there, update this list.
 */
type TileExpectation = {
  label: string;
  pathname: string;
  params?: Record<string, string>;
};

const TILES: TileExpectation[] = [
  { label: "New leads (mo)", pathname: "/leads" },
  { label: "Hot",            pathname: "/leads",      params: { interest: "hot" } },
  { label: "Pending",        pathname: "/follow-ups", params: { filter: "today" } },
  { label: "Overdue",        pathname: "/follow-ups", params: { filter: "overdue" } },
  { label: "Closures (mo)",  pathname: "/leads",      params: { stage: "completed" } },
  { label: "Renewals due",   pathname: "/renewals" },
  { label: "Total leads",    pathname: "/leads" },
];

type RoleCreds = { email: string; password: string };

const ROLES: Record<string, RoleCreds | null> = {
  admin: process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD
    ? { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD }
    : null,
  sales: process.env.E2E_SALES_EMAIL && process.env.E2E_SALES_PASSWORD
    ? { email: process.env.E2E_SALES_EMAIL, password: process.env.E2E_SALES_PASSWORD }
    : null,
  documentation: process.env.E2E_DOCS_EMAIL && process.env.E2E_DOCS_PASSWORD
    ? { email: process.env.E2E_DOCS_EMAIL, password: process.env.E2E_DOCS_PASSWORD }
    : null,
};

async function signIn(page: Page, creds: RoleCreds) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(creds.email);
  await page.getByLabel(/password/i).fill(creds.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/dashboard/);
}

for (const [role, creds] of Object.entries(ROLES)) {
  test.describe(`KPI tiles — role: ${role}`, () => {
    test.skip(!creds, `Set E2E_${role.toUpperCase()}_EMAIL / _PASSWORD to enable.`);

    test.beforeEach(async ({ page }) => {
      if (!creds) return;
      await signIn(page, creds);
    });

    for (const tile of TILES) {
      test(`"${tile.label}" → ${tile.pathname}${
        tile.params ? `?${new URLSearchParams(tile.params).toString()}` : ""
      }`, async ({ page }) => {
        await page.goto("/dashboard");

        const link = page
          .getByRole("link", { name: new RegExp(`^${tile.label}:`, "i") })
          .first();
        await expect(link).toBeVisible();
        await link.click();

        await expect(page).toHaveURL(new RegExp(`${tile.pathname}(\\?|$)`));

        if (tile.params) {
          const url = new URL(page.url());
          for (const [k, v] of Object.entries(tile.params)) {
            expect(url.searchParams.get(k)).toBe(v);
          }
        }
      });
    }
  });
}
