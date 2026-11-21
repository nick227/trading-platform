import { describe, it, expect } from 'vitest'
import { eventToItem, executionToItems, normalizeExecution } from '../botDashboardService'

const evidence = {
  ticker: 'AAPL', direction: 'BUY', horizon: '5d', confidence: 0.490769, observedAt: '2026-11-19T00:00:00+00:00',
  ranking: { publicationId: 'pub_abc', mode: 'historical_replay', evaluation: { edgeOverBaseline: false, genuineOutOfSample: false, holdout: { precision: 0.490769, baselineRate: 0.503175, signals: 650 } } },
}

describe('research decisions and replay fills on the bot timeline', () => {
  it('shows an accepted research decision with its verified evidence summary', () => {
    const item = eventToItem({ id: 'e1', type: 'decision_made', createdAt: 't', metadata: { ticker: 'AAPL', decision: 'accepted', researchEvidence: evidence, decisionContext: { reason: 'research_accepted', simulation: { mode: 'historical_replay', session: '2026-11-19' } } } })
    expect(item).toMatchObject({ category: 'signal', title: 'Research: buy AAPL' })
    expect(item.research).toMatchObject({ decision: 'accepted', publicationId: 'pub_abc', edgeOverBaseline: false, genuineOutOfSample: false, mode: 'historical_replay', score: 0.490769 })
  })

  it('explains research that was not traded', () => {
    const item = eventToItem({ id: 'e2', type: 'decision_made', metadata: { ticker: 'AAPL', decision: 'rejected', researchEvidence: evidence, decisionContext: { reason: 'no_edge_over_baseline' } } })
    expect(item.title).toBe('Research not traded: AAPL')
    expect(item.explanation).toMatch(/always-up baseline/)
  })

  it('labels replay fills as simulated, never as broker executions', () => {
    const x = normalizeExecution({ id: 'x1', ticker: 'AAPL', direction: 'buy', quantity: 2, filledQuantity: 2, filledPrice: 342.1, status: 'filled', brokerOrderId: 'simreplay_2026-11-19_tp_x1' })
    expect(x.replaySession).toBe('2026-11-19')
    const fill = executionToItems(x, { hasCreatedEvent: true }).find((i) => i.category === 'fill')
    expect(fill.simulated).toBe(true)
    expect(fill.explanation).toBe('Simulated fill at the 2026-11-19 close ($342.10) — historical replay, not a broker execution.')
    const broker = normalizeExecution({ id: 'x2', ticker: 'AAPL', direction: 'buy', quantity: 1, filledQuantity: 1, filledPrice: 10, status: 'filled', brokerOrderId: 'alp_1' })
    expect(executionToItems(broker, { hasCreatedEvent: true }).find((i) => i.category === 'fill').simulated).toBe(false)
  })
})
