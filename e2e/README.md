# E2E tests

Playwright suite for KPI-tile navigation across roles.

## Install (once)

```bash
bun add -d @playwright/test
bunx playwright install --with-deps chromium
```

## Run

```bash
# Terminal 1
bun run dev

# Terminal 2
export E2E_BASE_URL=http://localhost:5173
export E2E_ADMIN_EMAIL=admin@example.com
export E2E_ADMIN_PASSWORD=...
export E2E_SALES_EMAIL=sales@example.com
export E2E_SALES_PASSWORD=...
# optional
export E2E_DOCS_EMAIL=docs@example.com
export E2E_DOCS_PASSWORD=...

bunx playwright test
```

Roles without credentials are auto-skipped, so the suite works with whichever
test accounts you provide.

## What it covers

`kpi-tiles.spec.ts` opens the dashboard and clicks every KPI tile defined in
`KpiStrip` (see `src/components/dashboard/widget-grid.tsx`), then asserts the
resulting `pathname` and query parameters match what each role should see:

| Tile             | Path          | Query                  |
| ---------------- | ------------- | ---------------------- |
| New leads (mo)   | `/leads`      | —                      |
| Hot              | `/leads`      | `interest=hot`         |
| Pending          | `/follow-ups` | `filter=today`         |
| Overdue          | `/follow-ups` | `filter=overdue`       |
| Closures (mo)    | `/leads`      | `stage=completed`      |
| Renewals due     | `/renewals`   | —                      |
| Total leads      | `/leads`      | —                      |

Update the `TILES` table in the spec when you add or change a tile.
