import { describe, expect, it } from 'vitest'
import { calculateFifoAccounting } from '../../src/services/botAccountingService.js'
import {
  reconcileStockTraderFills,
  calculateStockTraderSessionRealizedPnl,
  summarizeStockTraderReservations
} from '../../src/services/ai/stockTraderAccounting.js'
import { evaluateStockTraderPaperProposal } from '../../src/services/ai/stockTraderRiskPolicy.js'

const fill = (id, direction, qty, price, session, fees = 0) => ({
  id, ticker: 'AAPL', direction, filledQuantity: qty,
  filledPrice: price, simSession: session, fees, commission: 0,
  createdAt: session + 'T15:00:00Z'
})
const base = [fill('b1', 'buy', 2, 100, '2026-11-23', 1), fill('s1', 'sell', 1, 125, '2026-11-24', 1)]

describe('MR 10 authoritative paper accounting', () => {
  it('reconstructs cash and equity from actual fill cashflows, including fees', () => {
    const result = reconcileStockTraderFills({
      fills: base, allocatedCapital: 10000, asOfSession: '2026-11-25',
      quotes: { AAPL: 130 }
    })
    expect(result.cash).toBe(9923)
    expect(result.realizedPnl).toBe(25)
    expect(result.unrealizedPnl).toBe(30)
    expect(result.totalFees).toBe(2)
    expect(result.totalEquity).toBe(10053)
    expect(result.positions[0].quantity).toBe(1)
    expect(result.fillCount).toBe(2)
  })

  it('calculates realized session P&L net of allocated entry and exit fees', () => {
    const net = calculateStockTraderSessionRealizedPnl({
      fills: base, session: '2026-11-24'
    })
    expect(net).toBe(23.5)
    expect(calculateStockTraderSessionRealizedPnl({
      fills: base, session: '2026-11-23'
    })).toBe(0)
  })

  it('fails closed on missing marks, future data, excess sales and insufficient cash', () => {
    const opts = { allocatedCapital: 10000, asOfSession: '2026-11-25', quotes: { AAPL: 130 } }
    expect(() => reconcileStockTraderFills({ ...opts, quotes: {}, fills: base })).toThrow(/position mark/)
    expect(() => reconcileStockTraderFills({
      ...opts, fills: [...base, fill('future', 'buy', 1, 110, '2026-11-27')]
    })).toThrow(/future-dated/)
    expect(() => reconcileStockTraderFills({
      ...opts, fills: [fill('invalid-sell', 'sell', 3, 100, '2026-11-24')]
    })).toThrow(/exceed attributable/)
    expect(() => reconcileStockTraderFills({
      ...opts, fills: [fill('huge-buy', 'buy', 300, 100, '2026-11-24')]
    })).toThrow(/cash reconciliation/)
  })

  it('reserves the unfilled portion of every active order including uncertain submissions', () => {
    const reservations = summarizeStockTraderReservations([
      { status: 'queued', direction: 'buy', ticker: 'MSFT', quantity: 10, filledQuantity: null, price: 100 },
      { status: 'needs_reconciliation', direction: 'buy', ticker: 'AAPL', quantity: 3, filledQuantity: 1, price: 100 },
      { status: 'submitted', direction: 'sell', ticker: 'AAPL', quantity: 5, filledQuantity: 2, price: 100 },
      { status: 'filled', direction: 'buy', ticker: 'NVDA', quantity: 10, filledQuantity: 10, price: 100 }
    ])
    expect(reservations.totalBuyNotional).toBe(1200)
    expect(reservations.buyNotionalBySymbol.get('AAPL')).toBe(200)
    expect(reservations.sellQuantityBySymbol.get('AAPL')).toBe(3)
  })

  it('limits BUY notional against portfolio-wide exposure and concurrent reservations', () => {
    const portfolio = {
      allocatedCapital: 10000, cash: 1000,
      positions: [{ symbol: 'MSFT', quantity: 90, marketValue: 9000 }]
    }
    const args = {
      intent: { symbol: 'AAPL', action: 'BUY', confidence: 0.8, targetAllocationPct: 0.2 },
      price: 100, portfolio, activeOrders: [],
      executionLimits: { maxPositionPct: 0.2, maxOrderNotional: 2000 }
    }
    expect(evaluateStockTraderPaperProposal(args).quantity).toBe(10)
    const reserved = [{ status: 'queued', direction: 'buy', ticker: 'AAPL', quantity: 10, price: 100 }]
    expect(evaluateStockTraderPaperProposal({ ...args, activeOrders: reserved }).reason).toBe('cash_or_exposure_limit')
  })

  it('blocks new BUYs after realized daily loss but permits held-stock SELLs', () => {
    const portfolio = {
      allocatedCapital: 10000, cash: 9800,
      positions: [{ symbol: 'AAPL', quantity: 2, marketValue: 200 }]
    }
    const settings = { executionLimits: { maxPositionPct: 0.2, maxOrderNotional: 2000 }, price: 100, portfolio, activeOrders: [], sessionRealizedPnl: -510 }
    expect(evaluateStockTraderPaperProposal({
      ...settings,
      intent: { symbol: 'MSFT', action: 'BUY', confidence: 0.8, targetAllocationPct: 0.1 }
    }).reason).toBe('session_realized_loss_limit')
    expect(evaluateStockTraderPaperProposal({
      ...settings, intent: { symbol: 'AAPL', action: 'SELL' }
    }).quantity).toBe(2)
  })

  it('never reinterprets invalid FIFO accounting as empty holdings', () => {
    expect(() => reconcileStockTraderFills({
      fills: base, allocatedCapital: 10000, asOfSession: '2026-11-25', quotes: { AAPL: 130 },
      accountant: () => ({ hasFills: true, performance: null, openPositions: {} })
    })).toThrow(/realized/)
  })
})
