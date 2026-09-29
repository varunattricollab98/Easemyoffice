# EaseMyOffice CRM — agent rules

Kiro loads this automatically. It holds only the guardrails; the full handoff doc is
**`AGENT_CONTEXT.md`** at the repo root — **read it before starting work.**

## Repo identity

This repo (`varunattricollab98/Easemyoffice`) is the real CRM. The similarly named
`varunattricollab98/easemyofficecollab98` is **empty — never use it**, even if a session is
attached to it.

## Before pushing

Run all four locally — the sandbox supports them:

```sh
export PATH="/root/.nvm/versions/node/v22.23.2/bin:$PATH"  # npx is often missing otherwise
bun install --frozen-lockfile
npx tsc --noEmit
bun run test
bun run build
```

If you skip the `export`, `npx tsc` dies with `command not found` and a shell chain can still
report success — check the typecheck really ran.

CI (`.github/workflows/ci.yml`) runs the same steps plus a check that
`dist/server/index.js` and `dist/server/wrangler.json` were emitted.

## Git workflow

- Feature branch always; never commit directly to `main`.
- **Rebase onto latest `origin/main` before pushing.** A stale base has twice reverted
  already-merged PRs.
- Open PRs with `gh api repos/varunattricollab98/Easemyoffice/pulls -f ...`. The gateway
  blocks GraphQL, so `gh pr *` subcommands fail. Pass the body inline with `-f body='...'`,
  not `--body-file`.

## Deployment is automatic — never deploy by hand

Merging to `main` triggers the Cloudflare build (~3 min). `supabase/functions/**` deploys via
`.github/workflows/deploy-supabase-functions.yml`. Do not run `bun run deploy`.

## Gotchas

- **Email HTML:** SVG and WebP do not render in email clients. Use PNG (self-hosted at
  `easemyoffice.in/logos/*.png`) or `https://logo.clearbit.com/<domain>`.
- `supabase/functions/_shared/gmail-parse.ts` must stay byte-identical to `src/lib/gmail.ts`.
- The CRM never creates a Gmail `"converted"` label; it only adds `"<Name> lead"`.
- Money math lives in the tested shared `computeBookingMoney` module — don't reimplement it.

## Communication

Reply to the user in **Hinglish**. Keep code, SQL, comments, commit messages, and PR text in
clean English.
