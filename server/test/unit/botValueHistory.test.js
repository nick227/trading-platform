import { describe, it, expect } from 'vitest'
import { botValueHistory, maxDrawdown } from '../../src/services/portfolioValuationService.js'
import { calculateFifoAccounting } from '../../src/services/botAccountingService.js'

const fill = (id, session, direction, qty, price, ticker = 'SPY') => ({
  id, ticker, direction, filledQuantity: qty, filledPrice: price, quantity: qty, fees: 0, commission: 0, status: 'filled',
  brokerOrderId: `simdaily_${session}_tp_${id}`, filledAt: new Date(`${session}T21:00:00Z`), createdAt: new Date(`${session}T21:00:00Z`),
})
const closes = { SPY: [['2026-11-02', 100], ['2026-11-03', 110], ['2026-11-04', 90], ['2026-11-05', 105], ['2026-11-06', 120]] }
const engine = { getHistory: async (t) => ({ points: (closes[t] ?? []).map(([d, c]) => ({ t: d, c })) }) }
const config = { enabled: true, mode: 'paper_daily' }

describe('per-bot P&L series', () => {
  it('ends at the bot’s FIFO total P&L and reports drawdown against its allocation', async () => {
    const fills = [fill('b1', '2026-11-02', 'buy', 10, 100), fill('s1', '2026-11-05', 'sell', 4, 105)]
    const h = await botValueHistory({ id: 'bot_1', config: { allocatedAmount: 5000 } }, { config, engine, loadFills: async () => fills })
    expect(h.points.map((p) => [p.date, p.pnl])).toEqual([
      ['2026-11-02', 0], ['2026-11-03', 100], ['2026-11-04', -100], ['2026-11-05', 50], ['2026-11-06', 140],
    ])
    const fifo = calculateFifoAccounting(fills, { currentPrices: { SPY: 120 } }).performance
    expect(h.points.at(-1).pnl).toBe(fifo.totalPnl) // 4×5 realized + 6×20 unrealized = 140
    expect(h.returnPct).toBe(2.8)
    expect(h.maxDrawdown).toMatchObject({ amount: 200, peakDate: '2026-11-03', troughDate: '2026-11-04' })
  })
  it('only counts this bot’s simulator fills and never invents history', async () => {
    const broker = { ...fill('x', '2026-11-03', 'buy', 1, 110), brokerOrderId: 'alpaca-123' }
    const h = await botValueHistory({ id: 'bot_1', config: {} }, { config, engine, loadFills: async () => [broker] })
    expect(h).toMatchObject({ points: [], maxDrawdown: null })
    expect(maxDrawdown([{ date: 'a', equity: 10 }, { date: 'b', equity: 12 }])).toBeNull()
  })
})
