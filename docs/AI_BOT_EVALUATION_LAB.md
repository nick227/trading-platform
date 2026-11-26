# AI Bot Evaluation Laboratory v1

This offline research laboratory compares **frozen decisions** from AI strategies with a deterministic trading arm and a passive benchmark. It is not a live performance service.

## Four recommended arms

1. `passive_benchmark`: one-time simulated purchase of the selected index at the next opening session; a reference, not subject to the same 20% stock cap.
2. `technical_baseline`: deterministic candidate/entry/exit signals computed exclusively from data known by each session.
3. `vanilla_ai`: the flagship's recorded decisions.
4. `expanded_ai`: the same AI workflow supplied with additional approved evidence, when available and separately versioned.

All arms run against the **same observed session data, initial capital, fees, slippage, next-session opening-price execution, and deterministic portfolio ledger**. AI and deterministic stock proposals share the 20% per-position limit. Models never calculate performance metrics.

## Inputs and provenance

Use `buildRecordedAiEvaluationArm({ botId, events, sessions })` for archived AI decisions. This verifies ownership, completed BotEvent status, matching as-of market/portfolio snapshots and SHA-256-shaped snapshot fingerprints, and rejects events generated after the intended following session's 9:30 a.m. Eastern opening.

Each replay signal identifies its decision session, evidence session, archived research event ID and snapshot fingerprint. The evaluation engine refuses future-dated evidence and duplicate same-symbol decisions. A historical session's decision fills no sooner than the **next supplied session open**.

To make research results trustworthy, the upstream Alpha Engine historical bar set and source snapshots must also be independently verified for genuine point-in-time availability. The local fixture suite tests mechanics, **not** that any historical signals actually existed.

## Outputs

- Ending simulated equity, total return, maximum drawdown
- Annualized volatility, and a zero-risk-free-rate Sharpe estimate only after at least 20 return observations
- FIFO realized P&L, estimated commissions, turnover, average exposure
- Counted simulated fills, rejected orders and unresolved final-session signals
- Full dated paper equity curves and immutable evaluation input fingerprint
- AI-vs-deterministic differences labeled **research-only**

## Limitations and release gate

The simulator applies the documented flat per-order fee and slippage in basis points. It does not attempt to estimate spreads, borrow costs, taxes, intraday path, dividends, or full market impact. The passive benchmark uses full index exposure by design, so its risk differs from position-capped research arms.

Reject in-sample repeated prompt/strategy tuning as evidence of edge. Establish untouched chronological holdouts across regimes and collect forward paper decisions before making comparative public claims. Report sample size, unavailable inputs, data provenance, and model/API costs. A successful unit test or positive fixture result does not demonstrate predictive skill.
