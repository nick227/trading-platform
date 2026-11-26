# Flagship AI Stock Trader — Beta Operations

The flagship is independent from the legacy Momentum Trader and **disabled by default**. Merging code does not enable a provider call. It uses a dedicated $10,000 simulated portfolio.

## Deployment prerequisites

1. Apply the Prisma migration with `npm run db:generate --workspace=server` and your normal production migration deployment process (`prisma migrate deploy` from `server/`). Do not enable the job until the AI usage tables exist.
2. Configure the server-only OpenAI API key. Never put it in frontend configuration.
3. Set explicit environment flags and integer-cent budgets:

```dotenv
ENABLE_AI_SCHEDULER=true
ENABLE_FLAGSHIP_STOCK_TRADER=true
ENABLE_AI_PAID_CALLS=true
AI_STOCK_TRADER_MONTHLY_BUDGET_CENTS=500
AI_STOCK_TRADER_BOT_BUDGET_CENTS=250
AI_STOCK_TRADER_RESERVE_CENTS_PER_CALL=5
```

4. Run `node server/scripts/flagshipStockTraderControl.mjs --enable` from the repository root (with the production environment available), or from server using `node scripts/flagshipStockTraderControl.mjs --enable`.
5. To halt new flagship research, disable `ENABLE_AI_PAID_CALLS`. To disable the bot entirely, run the same CLI with `--disable`. Existing queued orders must be reconciled separately.

## Schedule

- At 9:50 AM New York time on weekdays, attempt already queued paper fills; exchange calendar checks reject holidays.
- At 4:45 PM New York time on weekdays, evaluate the latest completed exchange session.
- Never send a provider call if the feed is stale, the bot is disabled, the quota is exhausted, or the same research input has already been claimed.

## Accounting and limits

- Requests are identified by a stable research input fingerprint.
- Monthly platform and bot budgets are reserved together in a DB transaction using atomic SQL updates.
- Actual token usage is stored; uncertain provider outcomes are conservatively charged the full reservation.
- Configuration limits every research request to 1,000 completion tokens and one provider call per unique research input.
- A model price change requires updating `AI_OPENAI_INPUT_USD_PER_MILLION` and `AI_OPENAI_OUTPUT_USD_PER_MILLION`.
- A pending budget reservation after DB/worker failure blocks some future spend until manually reconciled. Never blindly reset the ledger.

## Verification

CI runs deterministic Vitest tests with an injected fake provider. No production OpenAI account is required in tests. Before enabling, inspect recent BotEvent entries, budget buckets and current paper positions; verify the data feed covers all eligible symbols.
