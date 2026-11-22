/**
 * Risk checks measure against the same user-scoped valuation as Home (FIFO holdings marked at
 * the latest close), never placeholders; anything unknown fails closed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../worker/src/db/prisma.js', () => ({ default: {} }))
vi.mock('../../../worker/src/broker/clientCache.js', () => ({ getBrokerClient: async () => null }))

const { brokerAccountSnapshot, portfolioRiskSnapshot, portfolioRiskHistory, clearRiskSnapshotCache } = await import('../../../worker/src/risk/accountSnapshot.js')
const { RiskGateService } = await import('../../../worker/src/risk/services/RiskGateService.js').then((m) => ({ RiskGateService: m.riskGateService.constructor }))

const SIM = { enabled: true, startingCash: 100000, session: '2026-11-19', mode: 'historical_replay' }
const BROKER = { enabled: false }
const fill = (id, ticker, qty, px, extra = {}) => ({ id, ticker, direction: 'buy', filledQuantity: qty, filledPrice: px, quantity: qty, price: px,
  fees: 0, commission: 0, status: 'filled', filledAt: new Date('2026-11-22T01:00:00Z'), brokerOrderId: `simreplay_2026-11-19_tp_${id}`, ...extra })
const db = (portfolio, fills = []) => ({ portfolio: { findUnique: async () => portfolio }, execution: { findMany: async () => fills } })
const broker = (account) => async () => ({ getAccount: async () => account })
const engine = (closes) => ({
  getSessionClose: async (t) => (closes[t] ? { close: closes[t], session: '2026-11-20' } : null),
  getHistory: async (t) => ({ points: closes[t] ? [{ t: '2026-11-19', c: 349.21 }, { t: '2026-11-20', c: closes[t] }] : [] }),
})

beforeEach(() => clearRiskSnapshotCache())

describe('portfolioRiskSnapshot (risk = Home valuation)', () => {
  it('simulator: equity is cash plus holdings marked at the latest close (not cost), with as-of', async () => {
    const s = await portfolioRiskSnapshot('por_a', { prismaClient: db({ userId: 'u' }, [fill('a', 'AAPL', 5, 349.21)]), config: SIM, engine: engine({ AAPL: 342.56 }) })
    expect(s.cash).toBeCloseTo(100000 - 5 * 349.21, 2)
    expect(s.marketValue).toBeCloseTo(5 * 342.56, 2)
    expect(s.equity).toBeCloseTo(s.cash + s.marketValue, 2)
    expect(s.pricesAsOf).toBe('2026-11-20')
    expect(s.positions).toEqual([expect.objectContaining({ ticker: 'AAPL', quantity: 5, price: 342.56, value: 1712.8 })])
  })

  it('broker: reads the owner’s account (string fields); holdings still come from FIFO fills', async () => {
    expect(await brokerAccountSnapshot('por_a', { prismaClient: db({ userId: 'u' }), config: BROKER, getClient: broker({ equity: '25000.5', cash: '9000', buying_power: '18000' }), engine: engine({}) }))
      .toEqual({ cash: 9000, equity: 25000.5, buyingPower: 18000, simulated: false, pricesAsOf: null })
  })

  it('fails closed instead of inventing balances or prices', async () => {
    const opts = (extra) => ({ engine: engine({}), useCache: false, ...extra })
    await expect(portfolioRiskSnapshot('x', opts({ prismaClient: db(null), config: SIM }))).rejects.toThrow('portfolio_not_found')
    await expect(portfolioRiskSnapshot('x', opts({ prismaClient: db({ userId: 'u' }), config: BROKER, getClient: async () => null }))).rejects.toThrow('broker_account_unavailable')
    await expect(portfolioRiskSnapshot('x', opts({ prismaClient: db({ userId: 'u' }), config: BROKER, getClient: broker({ cash: '5' }) }))).rejects.toThrow('broker_account_unavailable')
    await expect(portfolioRiskSnapshot('x', opts({ prismaClient: db({ userId: 'u' }), config: BROKER, getClient: broker({ equity: '0' }) }))).rejects.toThrow('broker_account_unavailable')
    // A holding without a known close → rejected, never valued at cost or zero.
    await expect(portfolioRiskSnapshot('x', opts({ prismaClient: db({ userId: 'u' }, [fill('a', 'AAPL', 5, 349.21)]), config: SIM }))).rejects.toThrow('price_unavailable:AAPL')
  })

  it('drawdown and session loss come from the owner’s value history (Home’s chart)', async () => {
    const opts = { prismaClient: db({ userId: 'u' }, [fill('a', 'AAPL', 5, 349.21)]), config: SIM, engine: engine({ AAPL: 342.56 }) }
    const snap = await portfolioRiskSnapshot('por_a', opts)
    const h = await portfolioRiskHistory(snap, opts)
    expect(h.peak).toBeCloseTo(100000, 2)
    expect(h.drawdown).toBeCloseTo((100000 - snap.equity) / 100000, 6)
    expect(h.sessionLoss).toBeCloseTo(100000 - snap.equity, 2)
    expect(await portfolioRiskHistory(snap, { ...opts, config: BROKER })).toEqual({ drawdown: null, sessionLoss: null, peak: null })
  })

  it('keeps the 2% risk-per-trade rule, measured against the real equity', async () => {
    const gate = new RiskGateService()
    const settings = gate.getDefaultRiskSettings()
    expect(settings).toEqual({ maxDailyLoss: 1000, maxPositionSize: 0.1, maxOpenPositions: 10, maxLeverage: 2.0, maxDrawdown: 0.15, minAccountBalance: 1000, maxConcurrentTrades: 5, maxRiskPerTrade: 0.02 })
    expect((await gate.checkRiskPerTrade(2 * 342.56, { totalValue: 100000 }, settings)).passed).toBe(true)
    expect((await gate.checkRiskPerTrade(2 * 342.56, { totalValue: 12000 }, settings)).passed).toBe(false)
  })
})
