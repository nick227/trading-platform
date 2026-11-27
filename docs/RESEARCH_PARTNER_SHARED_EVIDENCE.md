# RP-07 — Shared evidence integration and explicit AI mandate proposals

Research Partner now consumes the same provenance-aware external evidence registry as the flagship, through a research-only adapter. Allowed sources are news and SEC filings. As-of cutoff and retrieved cutoff use current UTC time; watchlist symbols are supplied through the adapter's existing screening input contract. Research reports preserve evidence fingerprint, source URLs and availability failures.

IMPORTANT: Shared provider adapters remain inert until the flagship work injects real, licensed fetchers. No live evidence collection or provider smoke test was verified in this PR. Research reports without sources remain preliminary.

An explicit useAI=true on the mandate proposal endpoint invokes the provider only if ENABLE_RESEARCH_PARTNER_AI_CALLS=true and separate budget limits are configured. Default proposals remain manual previews and no changes persist until approval.

The Research Partner has no brokerage authority, execution API, or portfolio dependency.