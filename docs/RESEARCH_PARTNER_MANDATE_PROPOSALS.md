# RP-03: mandate proposal and explicit approval

POST /api/research-partners/:id/mandates/proposals accepts natural-language instructions and returns an UNSAVED proposal tied to expectedVersion. No LLM request is made in this release; manual_preview retains existing mandate preferences and changes objective only.

A future usage-governed adapter may supply invokeModel to proposeResearchMandate and return model_proposal. The same strict mandate validator applies regardless of source.

The user approves by explicitly posting the proposal's mandate to POST /api/research-partners/:id/mandates with expectedVersion. Concurrent updates fail with HTTP 409. User hypotheses are not evidence.

This avoids coupling research-only setup to the flagship's paid model enable flag or creating a fake trading bot.