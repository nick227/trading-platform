import { describe, it, expect } from 'vitest'
import {
  buildValuation,
  buildValueSeries,
  fillSession,
  valuePortfolio,
  valueHistory,
} from '../../src/services/portfolioValuationService.js'
import { aggregateTemplate, researchSummaryFromEvent, MIN_CLOSED_FOR_WIN_RATE } from '../../src/services/templateStatsService.js'

const fill = (id, ticker, direction, qty, price, extra = {}) => ({
  id, ticker, direction, filledQuantity: qty, filledPrice: price, quantity: qty, price,
  fees: 0, commission: 0, status: 'filled', filledAt: new Date(`2026-11-22T01:00:0${id.length % 10}Z`),
  brokerOrderId: `simreplay_2026-11-19_tp_${id}`, ...extra,
})

const SIM = { enabled: true, startingCash: 100000, session: '2026-11-19', mode: 'historical_replay' }

describe('portfolio valuation (authoritative model)', () => {
  it('dates simulator fills by the replayed session, not the wall clock', () => {
    expect(fillSession(fill('a', 'AAPL', 'buy', 1, 10))).toBe('2026-11-19')
    expect(fillSession({ filledAt: '2026-11-21T15:00:00Z', brokerOrderId: 'alpaca-1' })).toBe('2026-11-21')
  })

  it('marks holdings to the latest close: equity = cash + Σ qty × mark, P/L = equity − starting cash', () => {
    const fills = [fill('a', 'AAPL', 'buy', 5, 349.21, { botId: 'b1' }), fill('b', 'SPY', 'buy', 2, 715.87, { botId: 'b2' })]
    const v = buildValuation({
      fills,
      marks: { prices: { AAPL: 342.56, SPY: 689.81 }, sessions: { AAPL: '2026-11-20', SPY: '2026-11-20' } },
      startingCash: 100000,
      source: 'simulator',
    })
    expect(v.cash).toBeCloseTo(100000 - 5 * 349.21 - 2 * 715.87, 2)
    expect(v.marketValue).toBeCloseTo(5 * 342.56 + 2 * 689.81, 2)
    expect(v.equity).toBeCloseTo(v.cash + v.marketValue, 2)
    expect(v.totalPnl).toBeCloseTo(v.equity - 100000, 2)
    expect(v.unrealizedPnl).toBeCloseTo(v.totalPnl, 2) // no fees, nothing sold
    expect(v.pricesAsOf).toBe('2026-11-20')
    const aapl = v.positions.find((p) => p.symbol === 'AAPL')
    expect(aapl.unrealizedPnl).toBeCloseTo(5 * (342.56 - 349.21), 2)
    expect(aapl.bots).toEqual([{ botId: 'b1', quantity: 5 }])
    expect(aapl.priceSession).toBe('2026-11-20')
  })

  it('never substitutes cost or zero for a missing price', () => {
    const v = buildValuation({ fills: [fill('a', 'AAPL', 'buy', 5, 100)], marks: { prices: {}, sessions: {} }, startingCash: 1000, source: 'simulator' })
    expect(v.positions[0].price).toBeNull()
    expect(v.positions[0].marketValue).toBeNull()
    expect(v.marketValue).toBeNull()
    expect(v.equity).toBeNull()
    expect(v.totalPnl).toBeNull()
    expect(v.valuationComplete).toBe(false)
    expect(v.unpricedSymbols).toEqual(['AAPL'])
    expect(v.cash).toBe(500) // cash is still known
  })

  it('realizes FIFO P/L and deducts fees from cash', () => {
    const fills = [
      fill('a', 'AAPL', 'buy', 10, 100, { fees: 1 }),
      fill('bb', 'AAPL', 'sell', 4, 110, { fees: 1, filledAt: new Date('2026-11-22T02:00:00Z') }),
    ]
    const v = buildValuation({ fills, marks: { prices: { AAPL: 120 }, sessions: { AAPL: '2026-11-20' } }, startingCash: 10000, source: 'simulator' })
    expect(v.cash).toBeCloseTo(10000 - 1000 - 1 + 440 - 1, 2)
    expect(v.realizedPnl).toBeCloseTo(40, 2)
    expect(v.positions[0].quantity).toBe(6)
    expect(v.equity).toBeCloseTo(v.cash + 6 * 120, 2)
  })

  it('builds a value series whose last point equals current equity', () => {
    const fills = [fill('a', 'AAPL', 'buy', 5, 349.21)]
    const closes = { AAPL: [{ t: '2026-11-18', c: 352 }, { t: '2026-11-19', c: 349.21 }, { t: '2026-11-20', c: 342.56 }] }
    const series = buildValueSeries({ fills, closesByTicker: closes, startingCash: 100000 })
    expect(series.map((p) => p.date)).toEqual(['2026-11-19', '2026-11-20']) // starts at first fill session
    expect(series[0].value).toBeCloseTo(100000, 2)
    expect(series[0].fills).toBe(1)
    const v = buildValuation({ fills, marks: { prices: { AAPL: 342.56 }, sessions: { AAPL: '2026-11-20' } }, startingCash: 100000, source: 'simulator' })
    expect(series.at(-1).value).toBeCloseTo(v.equity, 2)
  })

  it('valuePortfolio counts only simulator fills of the requesting user in simulator mode', async () => {
    let where = null
    const prismaClient = {
      execution: {
        findMany: async (args) => {
          where = args.where
          return [fill('a', 'AAPL', 'buy', 1, 100), { ...fill('b', 'AAPL', 'buy', 1, 100), brokerOrderId: 'alpaca-123' }]
        },
      },
    }
    const engine = { getSessionClose: async () => ({ close: 110, session: '2026-11-20' }) }
    const v = await valuePortfolio('user-1', { prismaClient, config: SIM, engine })
    expect(where.userId).toBe('user-1')
    expect(v.positions[0].quantity).toBe(1)
    expect(v.equity).toBeCloseTo(100000 - 100 + 110, 2)
  })

  it('valueHistory returns nothing (not invented data) outside the simulator', async () => {
    const h = await valueHistory('u', { config: { enabled: false } })
    expect(h.points).toEqual([])
    expect(h.source).toBe('unavailable')
  })
})

describe('featured bot results (site-wide, actual fills only)', () => {
  const bots = [{ id: 'b1', userId: 'u1', enabled: true }, { id: 'b2', userId: 'u2', enabled: false }]

  it('reports "no fills" as null results, never zero P/L', () => {
    const r = aggregateTemplate({ bots, fillsByBot: new Map(), marks: { prices: {}, sessions: {} } })
    expect(r.fills).toBe(0)
    expect(r.totalPnl).toBeNull()
    expect(r.realizedPnl).toBeNull()
    expect(r.winRate).toBeNull()
    expect(r.runningBots).toBe(1)
    expect(r.users).toBe(2)
  })

  it('includes unrealized P/L at the mark and withholds win rate below the minimum closed trades', () => {
    const fillsByBot = new Map([['b1', [fill('a', 'AAPL', 'buy', 2, 100, { botId: 'b1' })]]])
    const r = aggregateTemplate({ bots, fillsByBot, marks: { prices: { AAPL: 90 }, sessions: { AAPL: '2026-11-20' } } })
    expect(r.totalPnl).toBeCloseTo(-20, 2)
    expect(r.closedTrades).toBe(0)
    expect(r.winRate).toBeNull()
    expect(r.fillSource).toBe('simulator')
    expect(MIN_CLOSED_FOR_WIN_RATE).toBeGreaterThanOrEqual(5)
  })

  it('summarizes publication-level research evidence without user data', () => {
    const summary = researchSummaryFromEvent({
      metadata: {
        researchTrace: { evidenceSha256: 'abc' },
        researchEvidence: {
          strategyId: 'trend_momentum_v1', horizon: '5d', observedAt: '2026-11-19T00:00:00Z',
          ranking: { publicationId: 'pub_1', mode: 'historical_replay', evaluation: { edgeOverBaseline: false, genuineOutOfSample: false, method: 'm', holdout: { precision: 0.487, baselineRate: 0.503, samples: 1260 } } },
        },
        decisionContext: { policy: { minConfidence: 0.45 } },
      },
    })
    expect(summary).toMatchObject({ model: 'trend_momentum_v1', edgeOverBaseline: false, verified: true, holdout: { hitRate: 0.487, baselineRate: 0.503, samples: 1260 } })
    expect(JSON.stringify(summary)).not.toContain('policy')
  })
})
