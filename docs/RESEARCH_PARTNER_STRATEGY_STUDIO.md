# RP-15 — Conversational paper strategy studio

Users can request an optional, separately budgeted AI preview of a paper-only strategy and edit its explicit numeric rules. The UI also supports creating a manual paper strategy without AI. Both flows require explicit Save; approving the saved version is a further separate action. No order or brokerage capability is exposed.

Supported indicator fields are the existing screener fields. The studio can attach a completed investigation finding and immutable evidence metadata. UI defaults to a small one-rule editor; the backend accepts up to eight entry and exit rules. More complex criteria remain visible when loaded into a draft, but the basic editor currently modifies the first entry condition.

Provider calls require operator opt-in via ENABLE_RESEARCH_PARTNER_AI_CALLS=true and research-partner budget limits. No production model smoke test or migration was executed by this PR.
