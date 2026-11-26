# Optional External Research Context — Adapter Contracts

**MR 16 introduces provider-neutral interfaces only.** It does not connect API credentials, fetch live Reddit or Google results, enable new sources for the vanilla flagship, or authorize an extra LLM call.

## Sources

| Evidence adapter ID | Expected source | Classification |
| --- | --- | --- |
| `news` | Dated articles from licensed news APIs | `reported`, untrusted text |
| `reddit` | Public Reddit posts/comments with canonical Reddit URLs | `opinion`, untrusted text |
| `search_interest` | Dated relative-interest series such as Google Trends | `reported`, structured numbers |
| `filings` | SEC documents and extracts | `verified` only when an adapter attests verified SEC provenance; otherwise `reported` |

A source adapter receives a bounded list of portfolio/shortlisted symbols, as-of session, retrieval cutoff, and maximum row count. It must return records with publication, availability, and retrieval timestamps. For interest series, the period end is also an effective timestamp and is forbidden after the research session.

## Trust and safety

- External text is always untrusted **data**. It cannot alter system instructions or invoke research tools.
- A source's asserted conclusions are not automatically facts: Reddit is opinion; news remains reported until independently verified.
- Domain allowlists protect Reddit and SEC source provenance; all source links require HTTPS.
- Rows are capped at 25 per source, excerpts at 1,200 characters, and the universal evidence registry enforces combined item/byte limits and deduplicates identical content.
- Optional disconnected, malformed or future-dated feeds are recorded as unavailable rather than silently inventing evidence.
- Bot manifests contain an immutable `evidenceSources` allowlist. No mutable bot configuration can expand it.
- API licensing, retention limits, user-content terms, rate limits, and credential-scoped provider access must be reviewed before any production adapter connection. Do not store provider secrets in BotEvents.
- Prefer replayable stored snapshots for strategy evaluation; do not backfill a historical as-of session with later-retrieved information.

## Rollout

The vanilla v1 and v2 definitions permit **zero external feeds**. MR 16 includes only inert source fetcher interfaces and fixture-based tests. Additional source permissions require a new versioned bot definition and explicit deployment configuration.
