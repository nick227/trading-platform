# Vanilla AI Stock Trader v2 — Two-pass reasoning

The first AI bot is a **generalist investor**, not a momentum trading rule. The model is responsible for interpreting evidence, choosing research questions, comparing opportunities and explaining BUY/SELL/HOLD judgments. All numerical calculations, order sizing, risk approvals and simulated fills remain deterministic.

## Reasoning cycle

1. Assemble the existing point-in-time research snapshot.
2. Atomically claim one research cycle per bot and completed market session.
3. **Plan (paid model call #1):** ask the LLM for zero to three approved read-only research function requests. Validate every tool ID and argument.
4. Execute permitted deterministic research functions, retaining their return values and an immutable-style trace. Unknown tools and schema violations fail the cycle; unavailable nonessential read-only data is reported.
5. **Decision (paid model call #2):** present the original evidence and tool answers, ask the LLM to interpret it, compare alternatives and explain its recommendation. The existing strict decision validator remains the authorization boundary.
6. Reserve and settle each model call through the existing durable usage governor. Save both usage records, tool trace, plan and final decision in the BotEvent.
7. The separate deterministic execution stage may queue at most the configured paper orders after checking risk and accounting.

There is no web browsing or direct order tool. The model cannot change its allowed tools, model, request cap, research schedule or risk policy.

## Versioning and rollout

- Existing pinned `tmpl_ai_stock_trader@1.0.0` instances remain valid and continue one-shot reasoning.
- `tmpl_ai_stock_trader@2.0.0` is the new **tool-guided** research definition, with two explicitly governed model calls and a three-tool-request limit.
- New platform-owned paper bot creation uses v2 but remains **disabled**.
- Existing persisted platform bots are **not silently migrated**. Operators must explicitly change an existing disabled bot's configuration to `createAiStockTraderAgentConfig()` after inspecting fills, budget and configuration. Do not automatically migrate an active bot.
- No deployed bot is activated by this code merge. Provider credentials and paid-call flags remain explicit.
- The current price screener remains a research input and eligibility filter; later evaluation will test how much the model's reasoning adds beyond the deterministic baseline.
