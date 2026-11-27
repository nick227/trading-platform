# RP-07 — Shared evidence and optional AI-assisted mandates

The Research Partner uses the flagship production evidence registry for news and SEC filings with code-owned source selection, a UTC point-in-time retrieval cutoff, and a bounded watchlist. Reports retain source URLs, classifications, hash, evidence fingerprint and unavailable-provider metadata.

Unlike previous inert adapters, this uses createProductionExternalEvidenceRegistry() from server/src/services/ai/evidence/productionEvidenceFetchers.js. The network fetchers require credentials and connectivity; failed provider requests are indicated as unavailable rather than being represented as evidence. No live provider smoke test has been executed in this PR.

AI mandate interpretation is opt-in per preview request via useAI=true, protected by ENABLE_RESEARCH_PARTNER_AI_CALLS=true and research-specific platform, user and partner spending budgets. Preview never saves automatically.

The Research Partner is research-only: no bot, portfolio, execution or broker access. Do not treat published model reports as investment performance evidence.
