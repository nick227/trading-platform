# 2026-11-24 — M1–M4 closed; risk repair; Public Strategy Evidence

## Closed milestones (no further expansion)
- **M1** (#37): Alpaca company context in Watch; per-bot P&L history, return, drawdown, FIFO win rate; shared-symbol sells sized from the bot's own lots; Home featured event + chronological stream.
- **M2** (#38): shared decision core (`decisionCore.js`, `riskCore.js`) for live and historical runs; price validation/normalization; private backtests (next-open realistic / same-close parity), immutable run snapshots.
- **M3** (#39): duplicate bots, parameter variants on identical data, bot comparison, historical-vs-paper on the bot page.
- **M4** (#40, #41): relative-volume and price-change conditions, identical in paper trading and backtests.

## Risk repair (#42, released separately — live policy change)
Stress scoring now uses a maintained equity peak and FIFO realized P&L of closed trades (previously an unwritten EquityPeak and an unmaintained Execution.pnl, so it was always 100). Thresholds unchanged; risk-policy version changed.

## Public Strategy Evidence
TradeLoom backtests every platform strategy itself and publishes the results without login (`/strategies`, `/api/public/strategies`).
- **Versioned:** a strategy version is its rules + config + standardized parameters, content-addressed (`sv_…`). Results are immutable snapshots per version × symbol × window × end session; a changed template is a new version and inherits nothing; users' customised copies are never described by them.
- **Standard test:** every supported symbol separately, $10,000 capital, decide at close / fill next open, no fees, normal paper-trading risk policy, windows 5Y / 1Y / forward (sessions after first publication only).
- **Unset triggers** are standardized to the symbol's close on the last session before the window (known at the time; shown per result).
- **Everything is published**, including strategies that lose, never trade, or can't be backtested (research), with the reason.
- **Three kinds of results stay distinct:** platform backtest (standardized), paper results from users' bots built on a strategy (not standardized; labelled so), and each user's own bot performance.
- Refreshes automatically in the worker after each completed session; existing snapshots are never rewritten.

## Known limitations
- Operational health has no history: scored as healthy (100) in all backtests.
- Research strategies have no point-in-time research history, so they're published as not backtestable.
- Several current templates conflict with daily-close evaluation (e.g. SPY Trend Filter's 09:35–09:55 ET window; Momentum Sell needs existing holdings). Their evidence shows this plainly; changing the templates is a product decision.
