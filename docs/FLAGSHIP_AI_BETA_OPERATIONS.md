# Flagship AI Stock Trader v2 — Beta Operations

The flagship is an isolated **paper-only** generalist AI bot. Merging code neither enables paid model calls nor starts trading. It is independent from legacy deterministic strategies and the original AI momentum bot. There is no live broker path in this workflow.

## Before activation: verified release gates

1. Deploy all Prisma migrations with the normal deployment process (`npx prisma migrate deploy` from `server/`), then generate the client (`npm run db:generate --workspace=server` from repository root).
2. Verify actual MySQL tables for `AiUsageBucket` and `AiUsageCall`, public dashboard route `/ai-stock-trader`, current market data, and dedicated platform ownership.
3. Run backend contract and frontend Visual Contracts CI. **CI's in-memory/mocked integration tests do not establish production database concurrency or successful external AI connectivity.** Independently exercise database locking and recovery against a real, isolated staging database before setting `AI_STOCK_TRADER_DB_INTEGRATION_ATTESTED=true`.
4. Configure a server-only provider key, appropriate token pricing, and explicit integer-cent budgets. V2 has **two provider calls per completed market session**: research planning and final decision. The current final decision completion budget is 3,000 tokens plus a 500-token planning budget. Set call reservations and monthly budgets high enough for the actual provider-model pricing. Pricing and usage caps require operator review before calling an external model.
5. Initialize an absent bot explicitly using `node scripts/flagshipStockTraderControl.mjs --initialize` from `server/`. The new bot remains **disabled**. Existing v1 platform bots are not silently migrated.
6. If an existing bot is v1, inspect its paper orders and state, disable it, and run `node scripts/flagshipStockTraderControl.mjs --migrate-v2` **only if it has zero executions**. Otherwise require a manual migration plan; never rewrite a bot with historical fills.
7. Run `node scripts/flagshipStockTraderControl.mjs --status` and `--preflight` (read-only). Preflight intentionally fails until a recent real-provider connectivity smoke is recorded and every independent gate passes.
8. When explicitly authorized to incur API charges, run `node scripts/flagshipStockTraderControl.mjs --smoke-provider`. This is **one real paid LLM API call**, reserved and settled via the durable usage governor. It stores a successful smoke event with timestamp. The control script never calls an external provider during `--status`, `--preflight`, `--initialize`, `--migrate-v2` or `--disable`.
9. Re-run `--preflight` and inspect every blocker. When it reads `ready_for_operator_enable`, the operator may choose `--enable`. Enabling is an explicit manual step, not part of code merging.

Example environment variables (illustrative; choose budgets and prices deliberately):

```dotenv
ENABLE_AI_SCHEDULER=true
ENABLE_FLAGSHIP_STOCK_TRADER=true
ENABLE_AI_PAID_CALLS=true
AI_STOCK_TRADER_MONTHLY_BUDGET_CENTS=500
AI_STOCK_TRADER_BOT_BUDGET_CENTS=250
AI_STOCK_TRADER_RESERVE_CENTS_PER_CALL=5
AI_STOCK_TRADER_DB_INTEGRATION_ATTESTED=false
# OPENAI_API_KEY configured in secret management, never committed
# AI_OPENAI_INPUT_USD_PER_MILLION and AI_OPENAI_OUTPUT_USD_PER_MILLION
```

**The readiness attestation flag is operator-supplied evidence, not an automatic integration test.** Never set it to true merely because unit CI passed.

## Scheduled operations

- 9:50 a.m. New York weekdays: attempt previously queued next-open simulated fills; exchange holidays are excluded.
- 4:45 p.m. New York weekdays: evaluate the last completed exchange session.
- Every research cycle uses one bot/session claim to prevent duplicate paid cycles. Two distinct phases have separately reserved and settled model usage.
- The model chooses bounded read-only research tools. It never computes authoritative arithmetic or authorizes a trade.
- The deterministic execution layer sizes orders and checks portfolio cash, FIFO holdings, exposure, global caps, and active reservations.
- Unknown simulated submission outcomes are quarantined as `needs_reconciliation`, not blindly resubmitted.

## Operational monitoring

Review the BotEvent research claim, both model-usage call records, tool trace, context fingerprint, final decision and order audit. Confirm the last market feed session, invalid/absent prices, emergency-stop state, pending/uncertain orders, bot budgets, and actual paper fills.

The public `/ai-stock-trader` page shows limited research investigation metadata and simulation performance. It intentionally avoids raw prompts, provider secrets, or source documents.

## Emergency disable and rollback

1. Set `ENABLE_AI_PAID_CALLS=false` and `ENABLE_FLAGSHIP_STOCK_TRADER=false` in server configuration to prevent new research.
2. Run `node scripts/flagshipStockTraderControl.mjs --disable` from `server/` (or disable bot in the authorized admin workflow).
3. Inspect queued, `processing`, and `needs_reconciliation` orders. Disabling research is not a substitute for cancellation/reconciliation of already queued paper orders.
4. Preserve historical BotEvents, fill audits and usage accounting. Do not delete, reset or blindly replay uncertain calls.
5. Re-enable only after a new read-only preflight passes.

## Release limitations

The MR 18 CI tests use synthetic/mock market data and an injected fake model. An external provider smoke is **opt-in only**, and no production database migrations or deployment are performed by merging these changes. The evaluation laboratory is research-only and does not establish trading performance or predictive advantage.
