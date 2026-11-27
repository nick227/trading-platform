# RP-19 — Explicit, isolated forward paper simulation

A user must approve a strategy definition and explicitly confirm PAPER_ONLY to establish a version-pinned simulated account with $10,000 paper capital. This account runs **only on user-invoked, completed exchange sessions**, in exact chronological order. Signals are derived from approved deterministic rules using point-in-time Alpha Engine bars; order intents are executed at next session's opening reference price.

The simulator reuses the existing stock screener, flagship risk-policy admission and authoritative FIFO accounting code. It does not touch Portfolio, Bot, Execution, worker broker clients, or any real-money accounts. All fills and equity are labeled simulation. Portfolio state is committed with DB compare-and-swap revision and cycle uniqueness; duplicate requests cannot apply fills twice.

The operator does NOT need to enable automatic scheduling. No background automation is registered. Running one cycle is a separate authenticated user action. Missing exact-session marks and accounting inconsistencies fail closed. Fees and spread impact are currently modeled as zero, and intraday stops are not simulated.

New migration required. Do not advertise backtests or simulated gains as achievable real returns.
