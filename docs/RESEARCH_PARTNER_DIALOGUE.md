# RP-09 — Conversational mandate drafts

Dialogues are user-owned through their parent ResearchPartner. Every turn is stored as user-supplied context, capped at ten turns; drafts retain a base mandate version. The runtime returns proposed structured mandates and optional clarifying questions but never saves changes until the dedicated approval endpoint is called.

Supported routes:
- POST /api/research-partners/:id/mandates/dialogues
- GET /api/research-partners/:id/mandates/dialogues/:dialogueId
- POST /api/research-partners/:id/mandates/dialogues/:dialogueId/turns
- POST /api/research-partners/:id/mandates/dialogues/:dialogueId/approve

AI interpretation is explicitly opted in on each turn and remains subject to RP spending limits. All historical drafts retain original user input; stale mandate-version approvals return HTTP 409. Apply the supplied MySQL migration in staging before exposing the feature.
