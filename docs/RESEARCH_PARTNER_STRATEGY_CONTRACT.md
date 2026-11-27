# RP-13 — User-directed strategy specification

The strategy draft contract is a deterministic, bounded research artifact. Allowed indicators are sourced from the existing technical screener (price, SMA20/50, volume ratio, 5/20-session returns), not generated metric claims. It only supports watchlist symbols, daily/weekly cadence, paper mode and risk ceilings at or below flagship paper defaults.

A strategy has immutable revisions and optimistic concurrency for edits. Approval changes status to approved_paper_definition but **never creates a Bot, Execution, Portfolio, Scheduler job, or brokerage request**. Evaluation previews must consume independently verified screening data. Execution adapters and full backtests are separate acceptance work.

Deployment requires running the checked-in Prisma migration. This PR does not apply schema changes to production.
