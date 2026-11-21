import { describe, it, expect } from 'vitest'
import { calculateFifoAccounting } from '../../src/services/botAccountingService.js'

describe('botAccountingService - FIFO accounting engine', () => {
  it('returns null performance and null capitalInUse when no fills exist', () => {
    const emptyResult = calculateFifoAccounting([])
    expect(emptyResult.hasFills).toBe(false)
    expect(emptyResult.performance).toBeNull()
    expect(emptyResult.capitalInUse).toBeNull()
    expect(emptyResult.openPositions).toEqual({})

    // Also ignores unfilled executions (queued, cancelled, failed)
    const unfilledResult = calculateFifoAccounting([
      { id: 'e1', ticker: 'AAPL', direction: 'buy', quantity: 10, price: 150, status: 'queued' },
      { id: 'e2', ticker: 'AAPL', direction: 'buy', quantity: 10, price: 150, status: 'cancelled' },
      { id: 'e3', ticker: 'AAPL', direction: 'buy', quantity: 10, price: 150, status: 'failed' },
      { id: 'e4', ticker: 'AAPL', direction: 'buy', quantity: 10, price: 150, status: 'filled', filledQuantity: 0 }
    ])
    expect(unfilledResult.hasFills).toBe(false)
    expect(unfilledResult.performance).toBeNull()
    expect(unfilledResult.capitalInUse).toBeNull()
  })

  it('tracks buy-only fills: zero realized PnL, capital in use, fees, and null unrealized PnL when valuation missing', () => {
    const fills = [
      {
        id: 'buy-1',
        ticker: 'AAPL',
        direction: 'buy',
        filledQuantity: 10,
        filledPrice: 150,
        fees: 1.5,
        status: 'filled',
        filledAt: '2026-11-20T10:00:00Z'
      }
    ]

    const result = calculateFifoAccounting(fills)
    expect(result.hasFills).toBe(true)
    expect(result.capitalInUse).toBe(1500)
    expect(result.performance).toEqual({
      realizedPnl: 0,
      unrealizedPnl: null, // No market valuation provided -> null, never invented
      totalPnl: null,
      fees: 1.5,
      asOf: expect.any(String)
    })
    expect(result.openPositions.AAPL).toMatchObject({
      ticker: 'AAPL',
      quantity: 10,
      costBasis: 1500,
      avgPrice: 150
    })
  })

  it('calculates unrealized PnL accurately when market valuation is supplied', () => {
    const fills = [
      {
        id: 'buy-1',
        ticker: 'AAPL',
        direction: 'buy',
        filledQuantity: 10,
        filledPrice: 150,
        fees: 1.0,
        status: 'filled',
        filledAt: '2026-11-20T10:00:00Z'
      }
    ]

    const result = calculateFifoAccounting(fills, { currentPrices: { AAPL: 165 } })
    expect(result.capitalInUse).toBe(1500)
    expect(result.performance).toEqual({
      realizedPnl: 0,
      unrealizedPnl: 150, // 10 * (165 - 150)
      totalPnl: 150,
      fees: 1.0,
      asOf: expect.any(String)
    })
    expect(result.openPositions.AAPL.unrealizedPnl).toBe(150)
    expect(result.openPositions.AAPL.currentPrice).toBe(165)
  })

  it('matches sells strictly FIFO across multiple lots and handles partial fills', () => {
    const fills = [
      // Lot 1: 10 shares @ $100 = $1,000
      {
        id: 'b1',
        ticker: 'MSFT',
        direction: 'buy',
        filledQuantity: 10,
        filledPrice: 100,
        fees: 0.5,
        status: 'filled',
        filledAt: '2026-11-20T09:30:00Z'
      },
      // Lot 2: 10 shares @ $120 = $1,200
      {
        id: 'b2',
        ticker: 'MSFT',
        direction: 'buy',
        filledQuantity: 10,
        filledPrice: 120,
        fees: 0.5,
        status: 'filled',
        filledAt: '2026-11-20T10:00:00Z'
      },
      // Sell 1 (partial): 5 shares @ $130 -> matches Lot 1 (5 @ $100) -> PnL = 5 * (130 - 100) = $150
      {
        id: 's1',
        ticker: 'MSFT',
        direction: 'sell',
        filledQuantity: 5,
        filledPrice: 130,
        fees: 0.25,
        status: 'filled',
        filledAt: '2026-11-20T11:00:00Z'
      },
      // Sell 2: 10 shares @ $140 -> matches remaining 5 of Lot 1 @ $100 (PnL $200) + 5 of Lot 2 @ $120 (PnL $100) = $300
      {
        id: 's2',
        ticker: 'MSFT',
        direction: 'sell',
        filledQuantity: 10,
        filledPrice: 140,
        fees: 0.5,
        status: 'filled',
        filledAt: '2026-11-20T12:00:00Z'
      }
    ]

    const result = calculateFifoAccounting(fills)

    // Per-execution P/L
    expect(result.perExecutionPnl.get('b1')).toBe(0)
    expect(result.perExecutionPnl.get('b2')).toBe(0)
    expect(result.perExecutionPnl.get('s1')).toBe(150)
    expect(result.perExecutionPnl.get('s2')).toBe(300)

    // Cumulative realized PnL = 150 + 300 = 450
    expect(result.performance.realizedPnl).toBe(450)
    expect(result.performance.fees).toBe(1.75)

    // Open position remaining: 5 shares of Lot 2 (cost basis: 5 * 120 = $600)
    expect(result.capitalInUse).toBe(600)
    expect(result.openPositions.MSFT).toMatchObject({
      quantity: 5,
      costBasis: 600,
      avgPrice: 120
    })

    // If current price is $150: unrealized = 5 * (150 - 120) = $150
    const valuedResult = calculateFifoAccounting(fills, { currentPrices: { MSFT: 150 } })
    expect(valuedResult.performance.unrealizedPnl).toBe(150)
    expect(valuedResult.performance.totalPnl).toBe(600) // 450 + 150
  })

  it('sets unrealized PnL to 0 and total PnL to realized PnL when all positions are fully closed', () => {
    const fills = [
      { id: 'b1', ticker: 'TSLA', direction: 'buy', filledQuantity: 5, filledPrice: 200, status: 'filled', filledAt: '2026-11-20T09:00:00Z' },
      { id: 's1', ticker: 'TSLA', direction: 'sell', filledQuantity: 5, filledPrice: 220, status: 'filled', filledAt: '2026-11-20T10:00:00Z' }
    ]

    const result = calculateFifoAccounting(fills)
    expect(result.capitalInUse).toBe(0)
    expect(result.openPositions).toEqual({})
    expect(result.performance.realizedPnl).toBe(100) // 5 * (220 - 200)
    expect(result.performance.unrealizedPnl).toBe(0)
    expect(result.performance.totalPnl).toBe(100)
  })

  it('isolates different tickers independently', () => {
    const fills = [
      { id: 'b-aapl', ticker: 'AAPL', direction: 'buy', filledQuantity: 10, filledPrice: 100, status: 'filled', filledAt: '2026-11-20T09:00:00Z' },
      { id: 'b-goog', ticker: 'GOOG', direction: 'buy', filledQuantity: 10, filledPrice: 50, status: 'filled', filledAt: '2026-11-20T09:01:00Z' },
      { id: 's-aapl', ticker: 'AAPL', direction: 'sell', filledQuantity: 10, filledPrice: 110, status: 'filled', filledAt: '2026-11-20T10:00:00Z' },
    ]

    const result = calculateFifoAccounting(fills)
    expect(result.perExecutionPnl.get('s-aapl')).toBe(100)
    expect(result.performance.realizedPnl).toBe(100)
    expect(result.capitalInUse).toBe(500) // 10 GOOG @ 50
    expect(result.openPositions.GOOG).toMatchObject({
      quantity: 10,
      costBasis: 500,
      avgPrice: 50
    })
    expect(result.openPositions.AAPL).toBeUndefined()
  })
})
