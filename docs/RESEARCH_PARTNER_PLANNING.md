# RP-10 — Bounded two-pass research

Enable optional first-pass research planning with ENABLE_RESEARCH_PARTNER_PLANNING=true, in addition to ENABLE_RESEARCH_PARTNER_AI_CALLS=true. This spends a separately reserved AI call before the normal synthesis call. A research session runs at most 2 model calls: propose a bounded unverified candidate investigation plan, then summarize actual evidence.

The plan can suggest up to 8 stock ticker candidates, research questions, and a subset of news/filings sources. Tickers are hypotheses, not verified company identities or financial recommendations. No arbitrary URLs, code execution, brokerage tools, or private data access are permitted. Provider evidence is collected through the same deterministic point-in-time registry. Invalid plans fail closed and sessions are recorded as failed, not silently retried.

Without the planning flag, the original single-call workflow remains unchanged. No actual external data or paid model calls were exercised during implementation.
