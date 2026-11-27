import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '../../src/loaders/prisma.js'
import { queueStockTraderPaperOrders } from '../../src/services/ai/stockTraderExecutionService.js'
import { claimQueuedAiPaperExecution, completeClaimedAiPaperExecution } from '../../src/services/ai/paperExecutionClaims.js'
import { processPendingAiExecutions } from '../../src/services/ai/aiBotService.js'
import { runStockTraderDailyJob } from '../../src/jobs/aiStockTraderDailyJob.js'
import { runStockTraderMarketOpenJob } from '../../src/jobs/aiStockTraderMarketOpenJob.js'
import { AI_STOCK_TRADER_STRATEGY_ID, createAiStockTraderAgentConfig } from '../../src/services/ai/strategies/aiStockTraderStrategy.js'
import { nextStockTraderSession } from '../../src/services/ai/stockTraderTradingSession.js'

describe('MR 19 — Operational Integrity & Protective Exits (Real MySQL)', () => {
  const uid = randomUUID().replace(/-/g, '').slice(0, 12)
  const testUserId = `usr_mr19_${uid}`
  const testPortfolioId = `por_mr19_${uid}`
  const testBotId = `bot_mr19_${uid}`
  let testUser
  let testPortfolio
  let testBot

  beforeAll(async () => {
    // Seed test entities directly in MySQL
    testUser = await prisma.user.create({
      data: {
        id: testUserId,
        email: `mr19_${uid}@example.internal`,
        fullName: 'MR 19 Concurrency Tester',
        passwordHash: '$platform_test_hash$'
      }
    })

    testPortfolio = await prisma.portfolio.create({
      data: {
        id: testPortfolioId,
        userId: testUser.id,
        name: 'MR 19 Test Portfolio',
        cashBalance: 10000,
        totalValue: 10000
      }
    })

    await prisma.botTemplate.upsert({
      where: { id: AI_STOCK_TRADER_STRATEGY_ID },
      update: {},
      create: {
        id: AI_STOCK_TRADER_STRATEGY_ID,
        name: 'AI Stock Trader',
        description: 'AI-powered stock discovery and autonomous simulated portfolio decisions.',
        botType: 'strategy_based',
        config: createAiStockTraderAgentConfig(),
        rules: []
      }
    })

    testBot = await prisma.bot.create({
      data: {
        id: testBotId,
        userId: testUser.id,
        portfolioId: testPortfolio.id,
        templateId: AI_STOCK_TRADER_STRATEGY_ID,
        botType: 'strategy_based',
        name: 'MR 19 Test Bot',
        enabled: true,
        config: createAiStockTraderAgentConfig()
      }
    })
  })

  afterAll(async () => {
    // Clean up created entities in reverse dependency order
    await prisma.executionAudit.deleteMany({ where: { userId: testUserId } })
    await prisma.botEvent.deleteMany({ where: { botId: testBotId } })
    await prisma.execution.deleteMany({ where: { botId: testBotId } })
    await prisma.bot.deleteMany({ where: { id: testBotId } })
    await prisma.portfolio.deleteMany({ where: { id: testPortfolioId } })
    await prisma.user.deleteMany({ where: { id: testUserId } })
  })

  it('1. Verifies MySQL row-locking prevents over-allocation under concurrent order admission', async () => {
    const session = '2026-11-20'
    const screening = {
      asOfSession: session,
      shortlist: [
        { symbol: 'AAPL', eligible: true, inUniverse: true, indicators: { price: 150.00 } }
      ]
    }
    const portfolioSnapshot = {
      asOfSession: session,
      cash: 10000,
      totalEquity: 10000,
      positions: []
    }
    const research = {
      ok: true,
      eventId: `ev_test_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      decision: {
        asOfSession: session,
        actionable: [
          {
            symbol: 'AAPL',
            action: 'BUY',
            confidence: 0.85,
            targetAllocationPct: 0.20,
            thesis: 'High-conviction concurrent test thesis',
            evidence: ['Strong technical setup'],
            exitRule: { stopLossPct: 3.5, takeProfitPct: 7.0 }
          }
        ]
      }
    }

    // Execute 5 concurrent admissions for the exact same intent against MySQL
    const results = await Promise.allSettled([
      queueStockTraderPaperOrders({ bot: testBot, portfolio: testPortfolio, research, screening, portfolioSnapshot, prismaClient: prisma }),
      queueStockTraderPaperOrders({ bot: testBot, portfolio: testPortfolio, research, screening, portfolioSnapshot, prismaClient: prisma }),
      queueStockTraderPaperOrders({ bot: testBot, portfolio: testPortfolio, research, screening, portfolioSnapshot, prismaClient: prisma }),
      queueStockTraderPaperOrders({ bot: testBot, portfolio: testPortfolio, research, screening, portfolioSnapshot, prismaClient: prisma }),
      queueStockTraderPaperOrders({ bot: testBot, portfolio: testPortfolio, research, screening, portfolioSnapshot, prismaClient: prisma })
    ])

    const fulfilled = results.filter(r => r.status === 'fulfilled').map(r => r.value)
    expect(fulfilled.length).toBe(5)

    // Exactly one call should have queued the order; others are rejected or idempotently skipped
    const totalQueued = fulfilled.flatMap(f => f.queued)
    expect(totalQueued.length).toBe(1)
    expect(totalQueued[0].symbol).toBe('AAPL')
    expect(totalQueued[0].direction).toBe('buy')

    // Confirm database has exactly one execution
    const persisted = await prisma.execution.findMany({ where: { botId: testBotId } })
    expect(persisted.length).toBe(1)
    expect(persisted[0].ticker).toBe('AAPL')
    expect(persisted[0].status).toBe('queued')
  })

  it('2. Verifies CAS compare-and-swap claims fence concurrent workers cleanly', async () => {
    const exec = await prisma.execution.findFirst({ where: { botId: testBotId, status: 'queued' } })
    expect(exec).toBeTruthy()

    // 5 concurrent workers race to claim the same queued order
    const tokens = ['worker_alpha', 'worker_beta', 'worker_gamma', 'worker_delta', 'worker_epsilon']
    const claims = await Promise.all(
      tokens.map(token => claimQueuedAiPaperExecution({
        prismaClient: prisma,
        executionId: exec.id,
        workerToken: token
      }))
    )

    // Exactly one worker must win the claim (count === 1)
    const winners = claims.filter(c => c === true)
    const losers = claims.filter(c => c === false)
    expect(winners.length).toBe(1)
    expect(losers.length).toBe(4)

    // Verify DB state is processing
    const updated = await prisma.execution.findUnique({ where: { id: exec.id } })
    expect(updated.status).toBe('processing')
    expect(tokens.includes(updated.lockedBy)).toBe(true)

    // Complete the execution so it is filled
    const completed = await completeClaimedAiPaperExecution({
      prismaClient: prisma,
      execution: updated,
      workerToken: updated.lockedBy,
      fill: {
        brokerOrderId: `sim_ord_${randomUUID().slice(0, 8)}`,
        price: 150.00,
        quantity: updated.quantity,
        filledAt: new Date(),
        pnl: 0,
        priceModel: 'next_open',
        auditId: `aud_fill_${randomUUID()}`,
        session: '2026-11-23'
      }
    })
    expect(completed).toBe(true)

    const filledExec = await prisma.execution.findUnique({ where: { id: exec.id } })
    expect(filledExec.status).toBe('filled')
    expect(filledExec.filledPrice).toBe(150.00)
  })

  it('3. Verifies protective exit threshold attribution from open lots & duplicate prevention', async () => {
    // Current filled buy is AAPL @ $150.00.
    // Fake an engine that returns closing price $144.00 (which is -4.0%, breaching the 3.5% stopLossPct)
    const fakeEngine = {
      getSessionClose: async (ticker, session) => ({
        ticker,
        session,
        close: 144.00,
        open: 145.00
      })
    }

    // Call processPendingAiExecutions
    const result1 = await processPendingAiExecutions(testBotId, {
      currentSession: '2026-11-23',
      prismaClient: prisma,
      engine: fakeEngine
    })

    expect(result1.exitExecutions.length).toBe(1)
    expect(result1.exitExecutions[0].ticker).toBe('AAPL')
    expect(result1.exitExecutions[0].exitType).toBe('stop_loss')
    expect(result1.exitExecutions[0].status).toBe('queued')
    expect(result1.exitExecutions[0].targetSession).toBe(nextStockTraderSession('2026-11-23'))

    // Verify execution audit recorded the exact custom stopLossPct (3.5%) from entry
    const exitAudit = await prisma.executionAudit.findFirst({
      where: { executionId: result1.exitExecutions[0].id, eventType: 'execution_created' }
    })
    expect(exitAudit).toBeTruthy()
    expect(exitAudit.metadata.thresholdPct).toBe(-3.5)
    expect(exitAudit.metadata.exitModel).toBe('close_triggered_next_open')

    // Immediately run processPendingAiExecutions again to simulate second scheduler/worker instance
    const result2 = await processPendingAiExecutions(testBotId, {
      currentSession: '2026-11-23',
      prismaClient: prisma,
      engine: fakeEngine
    })

    // Must NOT create a duplicate exit execution
    expect(result2.exitExecutions.length).toBe(0)

    const allExits = await prisma.execution.findMany({
      where: { botId: testBotId, direction: 'sell' }
    })
    expect(allExits.length).toBe(1)
  })

  it('4. Verifies historical position isolation: open lots bind to their own entry audit, not stale historical buys', async () => {
    // Create an older, closed BUY execution from session 2026-10-01 with stopLossPct: 10%
    const oldBuyId = `exec_old_buy_${randomUUID().slice(0, 8)}`
    await prisma.execution.create({
      data: {
        id: oldBuyId,
        botId: testBotId,
        portfolioId: testPortfolio.id,
        userId: testUser.id,
        ticker: 'MSFT',
        direction: 'buy',
        quantity: 10,
        price: 300.00,
        filledQuantity: 10,
        filledPrice: 300.00,
        status: 'filled',
        simSession: '2026-10-01',
        origin: 'bot',
        sourceType: 'AI_STRATEGY',
        sourceId: AI_STOCK_TRADER_STRATEGY_ID,
        clientOrderId: `co_old_buy_${oldBuyId}`,
        commission: 0, fees: 0, pnl: 0, signalScore: 0.9,
        filledAt: new Date('2026-10-01T14:30:00Z')
      }
    })
    await prisma.executionAudit.create({
      data: {
        id: `aud_old_buy_${randomUUID()}`,
        executionId: oldBuyId,
        userId: testUser.id,
        workerId: 'ai_daily_job',
        eventType: 'execution_created',
        detail: 'Old historical buy',
        metadata: {
          exitRule: { stopLossPct: 10.0, takeProfitPct: 15.0 }
        },
        createdAt: new Date('2026-10-01T14:00:00Z')
      }
    })

    // Now close that old lot with a SELL
    const oldSellId = `exec_old_sell_${randomUUID().slice(0, 8)}`
    await prisma.execution.create({
      data: {
        id: oldSellId,
        botId: testBotId,
        portfolioId: testPortfolio.id,
        userId: testUser.id,
        ticker: 'MSFT',
        direction: 'sell',
        quantity: 10,
        price: 310.00,
        filledQuantity: 10,
        filledPrice: 310.00,
        status: 'filled',
        simSession: '2026-10-15',
        origin: 'bot',
        sourceType: 'AI_STRATEGY',
        sourceId: AI_STOCK_TRADER_STRATEGY_ID,
        clientOrderId: `co_old_sell_${oldSellId}`,
        commission: 0, fees: 0, pnl: 100, signalScore: 1.0,
        filledAt: new Date('2026-10-15T14:30:00Z')
      }
    })

    // Now open a brand new position on MSFT on 2026-11-20 with a tighter stopLossPct: 2.0%
    const newBuyId = `exec_new_buy_${randomUUID().slice(0, 8)}`
    await prisma.execution.create({
      data: {
        id: newBuyId,
        botId: testBotId,
        portfolioId: testPortfolio.id,
        userId: testUser.id,
        ticker: 'MSFT',
        direction: 'buy',
        quantity: 5,
        price: 400.00,
        filledQuantity: 5,
        filledPrice: 400.00,
        status: 'filled',
        simSession: '2026-11-20',
        origin: 'bot',
        sourceType: 'AI_STRATEGY',
        sourceId: AI_STOCK_TRADER_STRATEGY_ID,
        clientOrderId: `co_new_buy_${newBuyId}`,
        commission: 0, fees: 0, pnl: 0, signalScore: 0.88,
        filledAt: new Date('2026-11-20T14:30:00Z')
      }
    })
    await prisma.executionAudit.create({
      data: {
        id: `aud_new_buy_${randomUUID()}`,
        executionId: newBuyId,
        userId: testUser.id,
        workerId: 'ai_daily_job',
        eventType: 'execution_created',
        detail: 'New buy with tight 2.0% stop',
        metadata: {
          exitRule: { stopLossPct: 2.0, takeProfitPct: 6.0 }
        },
        createdAt: new Date('2026-11-20T14:00:00Z')
      }
    })

    // Current price drops by 2.5% to $390.00.
    // If it incorrectly read the old historical buy's 10% stop loss, NO exit would trigger.
    // Because it correctly reads the current open lot's 2.0% stop loss, it MUST trigger!
    const msftEngine = {
      getSessionClose: async (ticker, session) => ({
        ticker,
        session,
        close: 390.00,
        open: 395.00
      })
    }

    const res = await processPendingAiExecutions(testBotId, {
      currentSession: '2026-11-23',
      prismaClient: prisma,
      engine: msftEngine
    })

    const msftExit = res.exitExecutions.find(e => e.ticker === 'MSFT')
    expect(msftExit).toBeTruthy()
    expect(msftExit.exitType).toBe('stop_loss')

    const msftAudit = await prisma.executionAudit.findFirst({
      where: { executionId: msftExit.id, eventType: 'execution_created' }
    })
    expect(msftAudit).toBeTruthy()
    expect(msftAudit.metadata.thresholdPct).toBe(-2.0) // Specifically the new lot's threshold!
    expect(msftAudit.metadata.entryExecutionIds).toContain(newBuyId)
    expect(msftAudit.metadata.entryExecutionIds).not.toContain(oldBuyId)
  })

  it('5. Verifies daily job skips gracefully when flagship is not enabled', async () => {
    const res = await runStockTraderDailyJob({
      env: { ENABLE_FLAGSHIP_STOCK_TRADER: 'false' },
      prismaClient: prisma
    })
    expect(res.ok).toBe(true)
    expect(res.skipped).toBe(true)
    expect(res.reason).toBe('flagship_not_enabled')
  })

  it('5. Verifies market open job skips gracefully on weekends or non-trading days', async () => {
    // Saturday
    const saturday = new Date('2026-11-21T10:00:00Z')
    const res = await runStockTraderMarketOpenJob({
      env: { ENABLE_FLAGSHIP_STOCK_TRADER: 'true' },
      now: saturday,
      prismaClient: prisma
    })
    expect(res.ok).toBe(true)
    expect(res.skipped).toBe(true)
    expect(res.reason).toBe('market_closed')
  })
})
