# AI Decision Memory v1 — Provenance and Outcome Semantics

The decision-memory module gives the vanilla v2 AI Stock Trader continuity while keeping historical research immutable.

## Inputs

- Prior completed BotEvent decision records, strictly from sessions before the current research session
- Prior paper fill rows linked to the same bot, with `simSession <= asOfSession`
- Exact-session historic and current market closes, where available

For each earlier actionable BUY or SELL, the service preserves its original reasoning and records a deterministic **subsequent price change** observation. This is explicitly **not** realized portfolio P&L, predictive accuracy, or a reconstructed hypothetical trade. Only filled paper executions may be described as actual simulated trades.

## Safety and stability

- Future-dated research, other users' bots, failed model calls and unavailable prices never enter the memory.
- Market observations are computed with deterministic functions, not by the LLM.
- Historical BotEvent data is only read; every memory snapshot is fingerprinted and included in the current research fingerprint and audit.
- Memory is capped to five previous completed cycles, four actionable decisions per cycle, the latest 20 paper fills, and 16 KiB by default.
- Missing market observations are marked `unavailable`, never silently replaced.
- Outages in the mandatory memory data read fail a v2 research cycle without making a paid provider call.
- The source records remain available for independent research replay.

This module does not continuously train models, rewrite prior decisions, or assert that reflected-on outcomes establish a profitable trading edge.
