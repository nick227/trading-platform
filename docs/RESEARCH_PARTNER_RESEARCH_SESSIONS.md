# RP-04 — Research sessions and budget governance

Research sessions are created without an AI call. Explicit execution requires ENABLE_RESEARCH_PARTNER_AI_CALLS=true and positive research platform, user, and partner budgets. Calls are charged through the existing AiUsageCall/AiUsageBucket tables with isolated rp:* scopes. No fake trading bot records or flagship feature flags are used.

Required environment configuration: RESEARCH_PARTNER_PLATFORM_BUDGET_CENTS, RESEARCH_PARTNER_USER_BUDGET_CENTS, RESEARCH_PARTNER_PARTNER_BUDGET_CENTS. Optional RESEARCH_PARTNER_RESERVE_CENTS_PER_CALL and RESEARCH_PARTNER_MODEL. Default disabled.

POST /api/research-partners/:id/sessions creates a queued research question; POST /api/research-partners/:id/sessions/:sessionId/run performs a budgeted provider call. A unique transition from queued to running prevents duplicate paid work; failed sessions are preserved. No auto-retry yet.

This release deliberately has no live external evidence adapter. Reports without verified evidence are labeled preliminary and every finding is forced to inconclusive. Evidence must eventually be injected internally through a source-validated gateway; never accept arbitrary citations from HTTP clients. No deployment or paid provider calls have been executed by this PR.