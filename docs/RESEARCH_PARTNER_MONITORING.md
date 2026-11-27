# RP-16 — Evidence-change monitoring

A user creates a daily or weekly research monitor for up to 20 listed symbols. The monitor queries the shared approved production evidence registry (news and SEC filings) and stores bounded content hashes. Its first successful check establishes a baseline. Later checks emit a research event only for newly observed evidence content; missing providers are not treated as disappearances or as proof of negative conclusions.

A row-level compare-and-swap lease prevents duplicate provider scans across multiple worker processes. Monitoring **does not call an LLM**, revisit trading positions, alter research mandates, or place orders. A new evidence event means material should be reviewed, not that a strategy should change.

The scheduled job is opt-in via ENABLE_RESEARCH_PARTNER_MONITORING=true and requires new MySQL migration. Events remain visible from the Research Partner workspace. User-invoked checks honor their nextCheckAt due time and cannot be used to bypass the rate limit.
