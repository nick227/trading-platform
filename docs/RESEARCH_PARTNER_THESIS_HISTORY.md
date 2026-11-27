# RP-12 — Persistent research theses and evidence change tracking

Users may save an investment research hypothesis and explicitly link findings from completed owned investigations. The original session, research mandate and AI output are never rewritten. Each linked observation stores the verbatim finding, its cited evidence IDs, and its category. One assessment per thesis per research session prevents accidental duplicate attribution.

The overview counts transitions between recorded model assessments. This is descriptive bookkeeping, not verified model accuracy, actual financial performance, causal explanation, or an investment recommendation.

HTTP endpoints are authenticated and scoped by partner ownership. A new research user cannot attach another user's session. Rejected or missing evidence references cannot be persisted. Apply the MySQL migration before deploying.
