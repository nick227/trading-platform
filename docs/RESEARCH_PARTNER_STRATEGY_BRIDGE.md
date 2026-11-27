# RP-14 — Research-to-Strategy Bridge

An owned, completed Research Partner session can seed a new paper-strategy draft. A concrete finding and its cited evidence IDs are pinned as immutable strategy provenance. Model-generated research is not automatically promoted into executable conditions.

The user supplies a separately validated deterministic strategy specification; symbolic indicators are checked against RP-13 whitelist. Missing evidence is explicitly recorded as no_independent_sources, not represented as factual support. No Bot, Portfolio, Execution, trading-worker or brokerage operations are performed.

POST /research-partners/:id/paper-strategies/from-research accepts { sessionId, findingIndex, definition } and returns a draft. Ownership is checked by the parent user and session is scoped to the same partner.
