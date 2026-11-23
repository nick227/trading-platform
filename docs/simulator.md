# Simulator modes

TradeLoom bots trade simulated money in an internal simulator (`BROKER_MODE=simulated`, `WORKER_ORDER_PROCESSING=simulated`). Simulated fills are never broker executions, and live trading stays disabled.

| `SIM_REPLAY_SESSION` | Mode | Prices and fills | Use |
|---|---|---|---|
| `YYYY-MM-DD` | `historical_replay` | That one session's daily close, forever | Demos and tests |
| `latest` | `paper_daily` | The latest completed daily close Alpha Engine has. It advances every trading day after Alpha Engine's nightly refresh (≈22:00 UTC). | Ongoing paper trading |

## paper_daily rules
- **Session:** the newest daily close for `SIM_REFERENCE_TICKER` (default SPY), cached for 5 minutes. If that close is older than `SIM_MAX_SESSION_AGE_DAYS` (default 5), the simulator fails closed and nothing trades.
- **Once per session:** a bot acts at most once per symbol per session. Every simulated order records `Execution.simSession`. Filled, open, cancelled and refused orders all use up the session.
- **Fills:** an order fills at the close of the session it was decided on, labelled `simdaily_<session>_…`. If that close is unavailable, the order isn't filled.
- **Symbols:** only symbols with a close for the current session are traded. Today that means Alpha Engine's live universe (SPY, QQQ, AAPL, MSFT, NVDA, AMZN, GOOGL, JPM, XOM, META). Other symbols are skipped as "price unavailable".
- **Research:** the latest live publication, judged at real time, so research ages normally. New research needs Alpha Engine's research pipeline to be running.
- **Rules:** decisions are attributed to the session's close, as in replay. Market hours count as open; intraday time windows aren't meaningful on daily data.

## Known limits
- Daily data only. Alpha Engine has no intraday bars, and its `/api/quote` returns a stale bar, so it must not be used as a live price.
- **Risk policy:** under the default `RISK_RESTRICT_MODE=block`, the execution-confidence score of a rule-based bot on daily data can't reach the approve threshold. Unknown inputs (signal confidence, spread, regime, win rate) score a neutral 50, which caps the blend near 68 against a threshold of 75. Such orders are restricted and not placed, unless `SIM_TEST_SCENARIO` (labelled "Test scenario") or `RISK_RESTRICT_MODE=reduce` is set.

## Deploys
The worker waits for the database schema to match its build before starting any loop (`worker/src/db/schemaGate.js`). This makes it safe for Railway to start the worker before the API's pre-deploy `prisma db push`.
