import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import prisma from '../../src/loaders/prisma.js'
import {
  divRoundHalfEven,
  microsTo4Decimals,
  microsToDecimalString,
  microsToDollars,
  mulMicros,
  toMicros
} from '../../src/domain/money.js'
import { calculateFifoAccounting } from '../../src/services/botAccountingService.js'
import {
  backfillPortfolioLedgerFromExecutions,
  CASH_ENTRY_TYPES,
  computeOwnedPortfolioLots,
  getNetExternalCashFlowsSince,
  recordPortfolioCashFlow,
  recordPortfolioDailySnapshot,
  syncExternalUnmanagedPositions
} from '../../src/services/portfolioAccountingService.js'
import { valueHistory, valuePortfolio } from '../../src/services/portfolioValuationService.js'

describe('P3 — Fixed-Point Monetary Precision, Owned Lots, Cash Flows & Snapshots', () => {
  const createdUserIds = []

  afterAll(async () => {
    for (const uid of createdUserIds) {
      await prisma.portfolioDailySnapshot.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.positionLot.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.portfolioCashEntry.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.equityPeak.deleteMany({ where: { portfolio: { userId: uid } } }).catch(() => {})
      await prisma.execution.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.bot.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.portfolio.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.user.deleteMany({ where: { id: uid } }).catch(() => {})
    }
  })

  it('eliminates IEEE-754 floating-point drift and enforces exact HALF_EVEN rounding', () => {
    // Classic IEEE-754 failure: 0.1 + 0.2 !== 0.3 in binary float
    expect(toMicros('0.1') + toMicros('0.2')).toBe(toMicros('0.3'))
    expect(microsToDecimalString(toMicros(0.1) + toMicros(0.2), 2)).toBe('0.30')

    // Banker's rounding (HALF_EVEN) tie-breaking at 0.5 cents (5_000 micros)
    expect(divRoundHalfEven(25_000n, 10_000n)).toBe(2n) // 2.5 -> 2 (even)
    expect(divRoundHalfEven(35_000n, 10_000n)).toBe(4n) // 3.5 -> 4 (even)

    // 1,000 fractional fills of 0.1 shares @ $33.33 must sum with 0-cent drift
    const fills = []
    for (let i = 0; i < 1000; i++) {
      fills.push({
        id: `f_buy_${i}`,
        ticker: 'SPY',
        direction: 'buy',
        filledQuantity: 0.1,
        filledPrice: 33.33,
        fees: 0.01,
        commission: 0,
        status: 'filled',
        filledAt: new Date(1_700_000_000_000 + i * 1000)
      })
    }
    fills.push({
      id: 'f_sell_all',
      ticker: 'SPY',
      direction: 'sell',
      filledQuantity: 100,
      filledPrice: 34.33,
      fees: 0,
      commission: 0,
      status: 'filled',
      filledAt: new Date(1_700_002_000_000)
    })

    const acc = calculateFifoAccounting(fills)
    expect(acc.openPositions.SPY).toBeUndefined()
    // 100 shares * ($34.33 - $33.33) = exact $100.00 gross realized P&L; 1000 * $0.01 = exact $10.00 fees
    expect(acc.performance.realizedPnl).toBe(100)
    expect(acc.performance.fees).toBe(10)
    expect(acc.realizedPnlNetOfFees).toBe(90)
    expect(microsTo4Decimals(mulMicros(toMicros('3'), toMicros('33.333333')))).toBe(100)
    expect(microsToDollars(toMicros('19.995'))).toBe(20)
  })

  it('separates external_unmanaged holdings from bot-sellable lots while valuing full portfolio equity', async () => {
    const user = await prisma.user.create({
      data: {
        email: `p3_lots_${randomUUID()}@example.test`,
        passwordHash: '$test$',
        fullName: 'P3 Accounting User'
      }
    })
    createdUserIds.push(user.id)

    const portfolio = await prisma.portfolio.create({
      data: {
        id: `prt_p3_${randomUUID().slice(0, 12)}`,
        userId: user.id,
        name: 'Brokerage Paper Portfolio',
        accountKind: 'brokerage',
        environment: 'alpaca_paper',
        status: 'active',
        cashBalance: 0,
        totalValue: 0
      }
    })

    const botId = `bot_p3_${randomUUID().slice(0, 10)}`
    await prisma.bot.create({
      data: {
        id: botId,
        userId: user.id,
        portfolioId: portfolio.id,
        name: 'P3 Alpha Bot',
        enabled: true,
        config: { tickers: ['AAPL'], direction: 'buy', quantity: 4 }
      }
    })

    // Bot bought 4 shares of AAPL @ $200; user also holds 10 pre-existing AAPL + 5 VOO at broker (14 AAPL total at broker)
    await prisma.execution.create({
      data: {
        id: `exe_p3_bot_${randomUUID().slice(0, 10)}`,
        userId: user.id,
        portfolioId: portfolio.id,
        botId,
        ticker: 'AAPL',
        direction: 'buy',
        quantity: 4,
        price: 200,
        filledQuantity: 4,
        filledPrice: 200,
        commission: 0,
        fees: 0,
        origin: 'bot',
        status: 'filled',
        filledAt: new Date('2026-11-24T15:00:00Z'),
        brokerOrderId: `alp_${randomUUID().slice(0, 10)}`
      }
    })

    const localExecutions = await prisma.execution.findMany({ where: { portfolioId: portfolio.id } })
    const syncedUnmanaged = await syncExternalUnmanagedPositions({
      portfolioId: portfolio.id,
      userId: user.id,
      brokerPositions: [
        { symbol: 'AAPL', qty: '14', avg_entry_price: '190.00' }, // 10 unmanaged + 4 bot
        { symbol: 'VOO', qty: '5', avg_entry_price: '500.00' }    // 5 unmanaged
      ],
      localExecutions,
      prismaClient: prisma
    })
    expect(syncedUnmanaged).toHaveLength(2)

    const ownership = computeOwnedPortfolioLots({
      executions: localExecutions,
      externalUnmanagedLots: syncedUnmanaged
    })
    // Bot can ONLY sell the 4 AAPL shares it bought — NEVER the 10 external AAPL or 5 VOO!
    expect(ownership.getBotSellableQuantity(botId, 'AAPL')).toBe(4)
    expect(ownership.getBotSellableQuantity(botId, 'VOO')).toBe(0)

    // Portfolio valuation includes ALL 14 AAPL + 5 VOO while attributing only 4 AAPL to botId
    const val = await valuePortfolio(user.id, {
      prismaClient: prisma,
      config: { enabled: false },
      engine: {
        getSessionClose: async (sym) => ({
          close: sym === 'AAPL' ? 210 : 510,
          session: '2026-11-25'
        })
      },
      fetchBrokerAccount: async () => ({ cash: '5000.00', equity: '10490.00' })
    })
    const aaplPos = val.positions.find((p) => p.symbol === 'AAPL')
    const vooPos = val.positions.find((p) => p.symbol === 'VOO')
    expect(aaplPos.quantity).toBe(14)
    expect(aaplPos.bots).toEqual([{ botId, quantity: 4 }])
    expect(vooPos.quantity).toBe(5)
    expect(vooPos.bots).toEqual([])
  })

  it('tracks external deposits/withdrawals without distorting drawdown peaks and serves PortfolioDailySnapshot history', async () => {
    const user = await prisma.user.create({
      data: {
        email: `p3_cf_${randomUUID()}@example.test`,
        passwordHash: '$test$',
        fullName: 'P3 CashFlow User'
      }
    })
    createdUserIds.push(user.id)

    const simPort = await prisma.portfolio.create({
      data: {
        id: `prt_p3_sim_${randomUUID().slice(0, 10)}`,
        userId: user.id,
        name: 'Sim Backfill Portfolio',
        accountKind: 'simulated_custom',
        environment: 'internal_sim',
        status: 'active',
        cashBalance: 20_000,
        totalValue: 20_000
      }
    })

    await prisma.execution.create({
      data: {
        id: `exe_p3_bf_${randomUUID().slice(0, 10)}`,
        userId: user.id,
        portfolioId: simPort.id,
        ticker: 'MSFT',
        direction: 'buy',
        quantity: 10,
        price: 400,
        filledQuantity: 10,
        filledPrice: 400,
        commission: 0,
        fees: 1.5,
        status: 'filled',
        filledAt: new Date('2026-11-24T16:00:00Z'),
        brokerOrderId: `simdaily_2026-11-24_${randomUUID().slice(0, 8)}`
      }
    })

    // Idempotent backfill twice creates exact 1 initial_funding + 1 fill_debit and 1 PositionLot
    const bf1 = await backfillPortfolioLedgerFromExecutions(simPort.id, { prismaClient: prisma })
    const bf2 = await backfillPortfolioLedgerFromExecutions(simPort.id, { prismaClient: prisma })
    expect(bf1).toEqual({ cashEntriesCreated: 2, lotsCreated: 1 })
    expect(bf2).toEqual({ cashEntriesCreated: 0, lotsCreated: 0 })

    // Record a $5,000 external withdrawal after peakDate -> netExternalCashFlow = -$5,000
    const peakDate = new Date('2026-11-25T12:00:00Z')
    await recordPortfolioCashFlow({
      portfolioId: simPort.id,
      userId: user.id,
      entryType: CASH_ENTRY_TYPES.EXTERNAL_WITHDRAWAL,
      amount: 5000,
      externalActivityId: `ach_w_${simPort.id}`,
      effectiveAt: new Date('2026-11-26T12:00:00Z'),
      prismaClient: prisma
    })
    const netCf = await getNetExternalCashFlowsSince(simPort.id, peakDate, { prismaClient: prisma })
    expect(netCf).toBe(-5000)

    // Record two authoritative daily snapshots and verify valueHistory serves them
    await recordPortfolioDailySnapshot({
      portfolioId: simPort.id,
      userId: user.id,
      sessionDate: '2026-11-25',
      cash: 15998.5,
      marketValue: 4050,
      equity: 20048.5,
      netExternalCashFlow: 0,
      prismaClient: prisma
    })
    await recordPortfolioDailySnapshot({
      portfolioId: simPort.id,
      userId: user.id,
      sessionDate: '2026-11-26',
      cash: 10998.5,
      marketValue: 4100,
      equity: 15098.5,
      netExternalCashFlow: -5000,
      prismaClient: prisma
    })

    const hist = await valueHistory(user.id, {
      prismaClient: prisma,
      config: { enabled: false },
      portfolioId: simPort.id
    })
    expect(hist.source).toBe('portfolio_snapshots')
    expect(hist.points).toHaveLength(2)
    expect(hist.points[1]).toMatchObject({
      date: '2026-11-26',
      value: 15098.5,
      netCashFlow: -5000
    })
  })
})
