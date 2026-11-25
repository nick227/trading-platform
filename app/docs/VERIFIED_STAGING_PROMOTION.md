# TradeLoom: verified GitHub main → Railway staging

## Current deployment topology

- `nick227/trading-platform` is the repository for TradeLoom web, API and worker.
- Railway's existing `staging` environment deploys each service when its `staging` **Git branch** advances.
- GitHub `main` remains the canonical branch for merged feature PRs.
- `alpha-engine` belongs to the **separate** `nick227/alpha-engine` repository and is excluded from this automation.
- No Railway service, source branch setting, database, environment or Git branch is deleted or renamed.

## How promotion works

`.github/workflows/verified-staging-promotion.yml` runs on every PR, every push to `main`, or manual dispatch from `main`.

1. Verify the frontend: locked dependency install, production build, all app Vitest tests and all five existing Playwright visual suites.
2. Verify backend/worker: Prisma generate without database access, AI autonomous lifecycle, market calendar, accounting, exit rules, risk, evidence, AI strategy test suites, and worker entrypoint syntax.
3. **Only** on a successful `main` push or a manual dispatch from `main`, and only when both verification jobs passed, fetch the branch refs and verify that:
   - `main` has not moved beyond the SHA actually tested;
   - `staging` is an ancestor of the verified `main` commit;
   - the update can be a regular fast-forward Git push.
4. Push the exact verified commit to `staging`. This triggers Railway's existing automatic deployments.
5. Wait for the three GitHub commit statuses published by Railway: `tradeloom-web`, `tradeloom-api`, and `tradeloom-worker`; fail the run on a reported failure or deployment timeout.
6. When all three are green, check read-only public web and strategy catalog endpoints.

GitHub Actions explicitly grants `contents:write` **only to the promotion job**. Other jobs have read-only access. Workflow concurrency cancels obsolete runs when newer commits supersede a release.

## Failure behavior

- Failed build, unit test, server integration test, or Playwright assertion: **do not update staging**.
- New `main` commit during verification: **do not promote the stale SHA**.
- Divergent or unexpected `staging` history: **do not push; never reset or force-push**.
- Railway failure, missing status, timeout, or unreachable public endpoint: **report failure; do not rewrite Git history or auto-rollback**.
- Promotion may succeed but a Railway build may fail: the run is red, and the staging branch remains at the promoted SHA for diagnosis.

## Operations and limitations

- The workflow needs GitHub Actions permission to push to `staging` using `GITHUB_TOKEN` (Settings → Actions → General / branch rules). If branch rules disallow the app token, leave them intact and authorize a suitable trusted deployment identity; do not bypass protection.
- Promote manually by opening the workflow in GitHub Actions and choosing **Run workflow** on `main`. Never dispatch it from a feature branch to deploy that code.
- Set appropriate branch protection/ruleset for `main` after confirming the new required verification jobs' names: **Frontend verification** and **Backend and worker verification**. The workflow alone does *not* enforce PR restrictions; it enforces promotion safety.
- A successful status and read-only endpoint check do not replace a full end-to-end staging review (AI bot execution and database health require separate controlled verification).
- For Railway deployments triggered by `GITHUB_TOKEN` pushes, verify once that Railway receives these events and publishes statuses. If not, use a sanctioned GitHub App deployment identity rather than a force-push or an unaudited token.

## Avoid obsolete manual synchronization

Do **not** directly push `staging` after a PR merges. Wait for the **TradeLoom Verified Staging Promotion** workflow. If it fails, inspect its checks and Railway deployment logs, fix the cause, and rerun from `main`.
