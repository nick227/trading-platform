# AI Bot Definition Contract (v1)

This registry distinguishes **AI bot definitions** (reusable code-owned capabilities), **bot instances** (stored configuration and portfolio ownership) and **research runs** (immutable evidence and model decisions).

## What is code-owned

- Identity: `id@version` and immutable manifest
- Model provider and model ID, output schema and context-module allowlist
- Research tools permitted, but not automatically executed
- Maximum model requests and context/token budgets
- Registered risk policy: `stock_trader_paper_v1` (actual arithmetic and trade authorization remains in deterministic services)

An instance cannot grant itself a new provider, tool, context source, risk policy or model. A registry-only change does not start an AI job.

## Vanilla flagship

The existing `tmpl_ai_stock_trader@1.0.0` is the **vanilla generalist**. Its default modules remain market, portfolio, objectives and risk. The manifest supplies its reasoning philosophy; the existing research cycle is otherwise unchanged. Read-only research tools and external evidence sources will arrive in later MRs.

## How to add a future bot

1. Register a new immutable definition with its own ID and semver.
2. Add any new evidence modules through the registered context adapter framework.
3. Register read-only functions independently and add their IDs to the bot's permitted tool list.
4. Pin a verified model/provider and assign a **code-registered** risk policy.
5. Instantiate the bot with dedicated ownership, portfolio, permissions and budget.
6. Test both the definition contract and its deterministic paper execution lifecycle.

Do not copy an entire trading pipeline per AI strategy.

## Versioning

Changing prompt mandate, model, output format or allowed research inputs requires a new definition version and regression verification. Historical BotEvent research snapshots continue to reference their original strategy version.

## Risk ownership

Risk policy IDs are identifiers for code-owned policies, not model instructions. AI may propose BUY, SELL or HOLD; it cannot waive limits, calculate binding trade sizes, change execution models or place an order directly.
