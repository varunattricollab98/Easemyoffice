# EaseMyOffice CRM — agent rules

Guardrails only. The full handoff — shipped PRs, decisions waiting on the owner, the HRMS
roadmap, schema gotchas and sandbox quirks — is **`AGENT_CONTEXT.md`** at the repo root.
**Read it before starting work.**

> Kiro only auto-loads `.kiro/steering/` from the **workspace root**. In Kiro Web this repo is
> cloned into a subfolder (`/projects/sandbox/Easemyoffice`), so this file is NOT loaded there
> automatically — open it and AGENT_CONTEXT.md manually at the start of a session.

## Repo identity

This repo (`varunattricollab98/Easemyoffice`) is the real CRM. The similarly named
`varunattricollab98/easemyofficecollab98` is **empty — never use it**, even if a session is
attached to it.

## Before pushing

```sh
export PATH="/root/.nvm/versions/node/v22.23.2/bin:$PATH"  # npx is often missing otherwise
bun install --frozen-lockfile
npx tsc --noEmit
bun run test
bun run build
```

- Without the `export`, `npx tsc` dies with `command not found` and a shell chain can still
  look green — check the typecheck really ran.
- CI does not lint and the repo carries thousands of pre-existing prettier errors. New files
  must be lint-clean (`npx prettier --write <new file>`); touched files must gain **no** new
  errors — compare `npx eslint <file>` counts before/after using `git stash -u`.
- `/tmp` is not writable and `diff` is not installed: scratch files go under
  `/projects/sandbox/<name>` (outside the repo) and get deleted afterwards.
- Adding or removing a route regenerates `src/routeTree.gen.ts` during the build — commit it.

## Git workflow

- Feature branch always; never commit directly to `main`.
- **Rebase onto latest `origin/main` before pushing.** A stale base has twice reverted
  already-merged PRs.
- **Push the branch first, then create the PR** with
  `gh api repos/varunattricollab98/Easemyoffice/pulls -f ...` (the other order returns 422).
  The gateway blocks GraphQL, so `gh pr *` subcommands fail. Pass bodies inline with
  `-f body='...'`.
- **Squash-merge your own PRs without asking** once both check-runs (`Typecheck and build`,
  `Workers Builds: easemyoffice`) are green and `mergeable_state` is `clean`:
  `gh api -X PUT repos/varunattricollab98/Easemyoffice/pulls/<n>/merge -f merge_method=squash`.
  Then sync `main`, delete the branch, and confirm the post-merge checks on `main`.
  Never merge around a failing check.

## Never deploy during the morning attendance peak

Merging deploys instantly. A deploy invalidates the page files an already-open app
(home-screen app, tab left open) still points at, so people get stuck mid-login.
**Do not merge between 09:00 and 11:30 IST on working days** (Mon–Sat) unless the
owner asks for an urgent fix; hold the green PR and merge after 11:30. Check with
`TZ=Asia/Kolkata date` before every merge.

## Database migrations — never merge ahead of them

Merging deploys immediately, so code that needs a new table or column must not reach `main`
before the SQL has run. The sandbox has no DB credentials: open the PR, **paste the full SQL
inline in chat** (the owner copies it from there), give a verification query, and merge only
after he confirms it ran. Keep migrations idempotent.

## Deployment is automatic — never deploy by hand

Merging to `main` triggers the Cloudflare build (~3 min). `supabase/functions/**` deploys via
`.github/workflows/deploy-supabase-functions.yml`. Do not run `bun run deploy`.

## Gotchas

- **Email HTML:** SVG and WebP do not render in email clients. Use PNG (self-hosted at
  `easemyoffice.in/logos/*.png`) or `https://logo.clearbit.com/<domain>`.
- `supabase/functions/_shared/gmail-parse.ts` must stay byte-identical to `src/lib/gmail.ts`.
- The CRM never creates a Gmail `"converted"` label; it only adds `"<Name> lead"`.
- Money math lives in the tested shared `computeBookingMoney` module — don't reimplement it.
- `lead_activities` column is `type`, not `activity_type`. TeleCMI table is
  `telecmi_call_events`, and the webhook ALSO writes a `lead_activities` call row — never sum both.
- A renewal booking is `renewal_status in ('renewed','pending_payment')`, not `booking_source`.
- HRMS tables are not in the generated types: use `hrmsDb()` + the row types in
  `src/lib/hrms.ts`. Employees must never be able to read salary or payroll — RLS is the
  boundary, not the sidebar.

## Communication — keep chat replies SHORT

The owner has asked explicitly for this: long chat replies waste his time.

- Reply in **Hinglish**, in a few lines. Usually: what shipped + the PR/branch link.
- **No** reasoning walkthroughs, recaps of work already reported, "what I considered"
  sections, or tables summarising things he can read in the PR.
- Detail belongs in the **PR description and commit message**, not in chat.
- **No option menus.** Give one recommendation with a one-line reason; ask a single short
  question only when a genuine business decision is his to make.
- Flag a blocker in one line. Do not list "what's pending" unless asked.

Code, SQL, comments, commit messages and PR text stay in clean English.
