/**
 * Pure presentation projection: never interprets return as proof of causation.
 * Historical data, paper outcomes and research claims remain distinct records.
 */
export const matchingVersionRuns = (runs, version) =>
  (Array.isArray(runs) ? runs : []).filter(run => run.version === version)

export function strategyEvidenceView({ strategy, runs = [], account = null }) {
  const version = strategy.currentVersion
  const revision = strategy.versions?.find(item => item.version === version)
  const provenance = revision?.provenance?.kind === 'research_finding'
    ? revision.provenance : null
  const historical = matchingVersionRuns(runs, version)
  const accountMatches = Boolean(account && account.version === version)
  const cycles = accountMatches && Array.isArray(account.cycles) ? account.cycles : []
  const sourceStatus = !provenance ? 'No linked research finding recorded'
    : provenance.sourceStatus === 'no_independent_sources'
      ? 'Research finding has no cited independent sources'
      : 'Research interpretation references cited sources; claims remain unverified'
  return {
    version, provenance, sourceStatus,
    historical, latestHistorical: historical[0] || null,
    account, accountMatches, cycles, latestPaper: cycles[0] || null,
    hasResearch: Boolean(provenance), hasHistorical: historical.length > 0,
    hasPaper: cycles.length > 0,
    limitations: [
      'Research findings are interpretations, not confirmed trading signals.',
      'Historical simulations use assumed fills and do not predict future returns.',
      'Paper sessions use simulated orders, not real brokerage executions.',
      ...(account && !accountMatches
        ? [`Paper account is pinned to version ${account.version}, not current version ${version}.`]
        : [])
    ]
  }
}
export const secureEvidenceUrl = value => {
  if (typeof value !== 'string') return null
  try {
    const parsed = new URL(value)
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : null
  } catch { return null }
}
