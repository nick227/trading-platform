# Configurable AI Research Partner

RP-01 establishes user-owned research-only persistence, immutable versions of the user's mandate, and bounded validation.

## Records
- ResearchPartner: owner, draft/active/archived state, active mandate version.
- ResearchMandateVersion: immutable statement of user objective and hypotheses.
- ResearchSession: investigation with pinned mandate version, lifecycle and result.
- ResearchMessage: user/assistant/tool message timeline with source references.

Research Partner records do not create trading bots, portfolios or executions. Hypotheses are unverified user-supplied questions, not factual evidence.

## Migration
MySQL/MariaDB migration supplied. Deploy via the application's established migration mechanism, not both raw SQL and prisma db push on the same schema. No deployment or migration was performed by this PR.

## Parallel work
Flagship MRs 19-22 are separately owned by Antigravity. Avoid editing shared AI framework files in RP releases.