import { describe, expect, it } from 'vitest'
import { matchingVersionRuns, secureEvidenceUrl, strategyEvidenceView } from '../strategyEvidenceView'

const strategy = {
  id: 's1', name: 'Paper momentum', currentVersion: 3,
  versions: [{ version: 3, provenance: {
    kind: 'research_finding', sessionId: 'r1', findingIndex: 0,
    sourceStatus: 'no_independent_sources',
    finding: { claim: 'Hypothesis', assessment: 'inconclusive', evidenceIds: [] },
    sources: []
  }}]
}
const run = (version, id) => ({ version, id, result: { returnPct: 3 } })

describe('strategy evidence view', () => {
  it('keeps all results scoped to the current definition version', () => {
    const view = strategyEvidenceView({
      strategy, runs: [run(2, 'old'), run(3, 'latest')],
      account: { version: 2, cycles: [{ session: '2026-11-26' }] }
    })
    expect(view.historical.map(item => item.id)).toEqual(['latest'])
    expect(view.accountMatches).toBe(false)
    expect(view.latestPaper).toBe(null)
    expect(view.limitations.join(' ')).toContain('pinned to version 2')
  })
  it('preserves the difference between no sources and cited interpretation', () => {
    const view = strategyEvidenceView({ strategy })
    expect(view.hasResearch).toBe(true)
    expect(view.sourceStatus).toContain('no cited independent sources')
    const noProvenance = strategyEvidenceView({ strategy: { ...strategy, versions: [] } })
    expect(noProvenance.hasResearch).toBe(false)
    expect(noProvenance.sourceStatus).toContain('No linked research')
  })
  it('does not accept unsafe protocols in evidence links', () => {
    expect(secureEvidenceUrl('javascript:alert(1)')).toBe(null)
    expect(secureEvidenceUrl('data:text/html,test')).toBe(null)
    expect(secureEvidenceUrl('/relative-path')).toBe(null)
    expect(secureEvidenceUrl('https://example.com/report')).toBe('https://example.com/report')
  })
  it('does not treat missing records as successful simulation', () => {
    expect(matchingVersionRuns(null, 1)).toEqual([])
    const view = strategyEvidenceView({ strategy })
    expect(view.hasHistorical).toBe(false)
    expect(view.hasPaper).toBe(false)
  })
})
