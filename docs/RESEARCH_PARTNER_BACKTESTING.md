# RP-17 — Approved paper strategy historical replay

Reuses the Alpha Engine daily-bar read API, screener indicators and shared FIFO accounting engine. Decisions use completed daily bars. Orders are filled at the next recorded session's opening price, never the decision day's close. Simulated cash and holdings are local and are never written into live Bot/Portfolio/Execution tables.

Bounds: 180 calendar-day range, 5–130 exchange sessions, 10 tickers, 1000–100000 initial paper capital (default 10000). Missing held-position prices stop the replay; no synthetic marks. Backtests are immutable records pinned to the approved strategy version.

The first replay assumes zero commission, zero slippage, whole shares, and does not model bid/ask spreads or intraday protective exits. Results must not be represented as live performance or validated financial advantage.

Operator must apply checked-in Prisma migration. No provider calls or real-money orders are generated.
