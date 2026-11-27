
# RP-08 — Controlled Research Partner acceptance

This MR adds an explicitly operator-invoked, read-only database/schema preflight and a separately authorized paid model smoke operation. It does NOT execute either against production, apply migrations, or enable provider calls.

## Runbook (operator)
1. Ensure the two checked-in Research Partner SQL migrations have been reconciled with the environment's Prisma migration history. On installations using db push, inspect the target schema first; never apply both SQL and db push blindly.
2. From server/, run `node scripts/researchPartnerControl.mjs --preflight`. Confirm all table checks pass.
3. Set separate RESEARCH_PARTNER_PLATFORM_BUDGET_CENTS, RESEARCH_PARTNER_USER_BUDGET_CENTS, and RESEARCH_PARTNER_PARTNER_BUDGET_CENTS. Paid calls remain off by default.
4. If authorized to spend on a live smoke test, set ENABLE_RESEARCH_PARTNER_AI_CALLS=true with server-side OPENAI_API_KEY, then explicitly run `node scripts/researchPartnerControl.mjs --smoke-provider`. This performs exactly one reserved provider request; no research orders are placed.
5. Verify with two separate user accounts: create → preview → approve → run → read → feedback → linked follow-up; confirm cross-user resources return 404, version conflicts return 409, and archived partners are inaccessible. Verify consumed evidence includes source timestamps and no unsupported citations.
6. Verify failure cases: missing provider credentials, missing news license, transient SEC errors, budget exhausted, disabled provider, stale source cutoff and concurrent session execution.

Provider output must be verified against real credentials and data before declaring a live beta. No live provider tests or target database migrations were performed when writing this MR.
