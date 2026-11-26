import { describe, expect, it, vi } from 'vitest'
import { runStockTraderDailyJob } from '../../src/jobs/aiStockTraderDailyJob.js'
import { processPendingAiExecutions } from '../../src/services/ai/aiBotService.js'
import { readPublicStockTraderDashboard } from '../../src/services/ai/stockTraderDashboardService.js'
import { createAiStockTraderAgentConfig, AI_STOCK_TRADER_STRATEGY_ID, AI_STOCK_TRADER_PLATFORM_BOT_ID } from '../../src/services/ai/strategies/aiStockTraderStrategy.js'

const decisionDay = '2026-11-25'
const fillDay = '2026-11-27'
const now = new Date('2026-11-25T23:00:00.000Z')

function harness() {
  const bot = {
    id: AI_STOCK_TRADER_PLATFORM_BOT_ID, userId: 'platform-user', portfolioId: 'paper-portfolio',
    templateId: AI_STOCK_TRADER_STRATEGY_ID, enabled: true,
    config: createAiStockTraderAgentConfig({ universe: { type: 'curated', symbols: ['AAPL'] } })
  }
  const portfolio = { id: bot.portfolioId, userId: bot.userId }
  const orders = []
  const audits = []
  const events = []
  const prismaClient = {
    bot: { findUnique: vi.fn(async () => bot) },
    portfolio: { update: vi.fn(async () => portfolio) },
    user: { findUnique: vi.fn(async () => ({ riskSettings: null })) },
    botEvent: {
      findUnique: vi.fn(async ({ where }) => events.find(e => e.id === where.id) || null),
      findMany: vi.fn(async ({ where }) => events.filter(e =>
        e.botId === where.botId && (!where.type || e.type === where.type))),
      create: vi.fn(async ({ data }) => {
        const item = { ...data, createdAt: new Date() }
        events.push(item)
        return item
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        const item = events.find(e => e.id === where.id && e.ruleId === where.ruleId)
        if (!item) return { count: 0 }
        Object.assign(item, data)
        return { count: 1 }
      })
    },
    execution: {
      findMany: vi.fn(async ({ where }) => orders.filter(e => {
        if (where.botId && e.botId !== where.botId) return false
        if (typeof where.status === 'string' && e.status !== where.status) return false
        if (where.status?.in && !where.status.in.includes(e.status)) return false
        if (where.filledQuantity?.gt != null && !(Number(e.filledQuantity) > where.filledQuantity.gt)) return false
        if (where.filledPrice?.gt != null && !(Number(e.filledPrice) > where.filledPrice.gt)) return false
        if (where.simSession?.lte && e.simSession > where.simSession.lte) return false
        return true
      }).map(e => ({ ...e }))),
      findFirst: vi.fn(async ({ where }) => {
        if (where.OR) return orders.find(e => where.OR.some(test =>
          (test.clientOrderId && test.clientOrderId === e.clientOrderId) ||
          (test.activeIntentKey && test.activeIntentKey === e.activeIntentKey))) || null
        if (where.clientOrderId) return orders.find(e =>
          e.clientOrderId === where.clientOrderId && e.userId === where.userId) || null
        return null
      }),
      create: vi.fn(async ({ data }) => {
        const e = { ...data, createdAt: new Date(), attempts: 0, brokerOrderId: null }
        orders.push(e)
        return e
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        const e = orders.find(row => row.id === where.id &&
          (!where.status || row.status === where.status) &&
          (!where.lockedBy || row.lockedBy === where.lockedBy))
        if (!e) return { count: 0 }
        const attempts = Number(e.attempts) + Number(data.attempts?.increment || 0)
        Object.assign(e, data, { attempts })
        return { count: 1 }
      })
    },
    executionAudit: {
      findFirst: vi.fn(async ({ where }) => audits.find(a =>
        a.executionId === where.executionId && a.eventType === where.eventType) || null),
      create: vi.fn(async ({ data }) => { audits.push(data); return data })
    }
  }
  prismaClient.$transaction = async fn => fn(prismaClient)

  const bars = Array.from({ length: 75 }, (_, i) => {
    const date = new Date(Date.parse(decisionDay + 'T00:00:00Z') -
      (74-i)*86400000).toISOString().slice(0,10)
    const price = 100 + i * 0.4
    return [date, price, price+1, price-1, price, 1000000]
  })
  const engine = {
    getDailyBars: vi.fn(async () => ({ bars })),
    getSessionClose: vi.fn(async (ticker, session = fillDay) => ({
      session, open: 105, close: session === fillDay ? 106 : bars.at(-1)[4],
      source: 'fixture'
    }))
  }
  const provider = { completeStructured: vi.fn(async ({ systemPrompt }) => {
    if (systemPrompt.includes('Choose at most')) return {
      model: 'mock', usage: { prompt_tokens: 90, completion_tokens: 30 },
      structured: {
        focus: 'Investigate AAPL metrics', requests: [
          { toolId: 'get_stock_metrics', args: { symbol: 'AAPL' } }
        ]
      }
    }
    return { model: 'mock', usage: { prompt_tokens: 250, completion_tokens: 90 },
      structured: { marketSummary: 'Research indicates a cautiously positive case', decisions: [
        { symbol: 'AAPL', action: 'BUY', confidence: 0.78,
          targetAllocationPct: 0.1, thesis: 'Evidence supports small exposure',
          evidence: ['Price and trend metrics from approved data'], risks: ['Reversal risk'],
          exitRule: { takeProfitPct: 8, stopLossPct: 4 }
        }
      ] }
    }
  }) }
  let reservationSequence = 0
  const usageGovernor = {
    reserve: vi.fn(async () => ({
      id: 'reservation-' + (++reservationSequence), botId: bot.id,
      period: '2026-11', reservedCents: 5
    })),
    settle: vi.fn(async () => ({ settled: true }))
  }
  return { bot, portfolio, orders, audits, events, prismaClient, engine, provider, usageGovernor }
}

describe('MR 18 full mock flagship paper lifecycle', () => {
  it('moves from verified market data to two model calls, audited queue and unique next-open paper fill', async () => {
    const f = harness()
    const research = await runStockTraderDailyJob({
      now, session: decisionDay, prismaClient: f.prismaClient,
      env: { ENABLE_FLAGSHIP_STOCK_TRADER: 'true', ENABLE_AI_PAID_CALLS: 'true' },
      engine: f.engine, provider: f.provider,
      usageGovernor: f.usageGovernor,
      botLoader: async () => ({ bot: f.bot, portfolio: f.portfolio }),
      pendingProcessor: async () => ({ filledExecutions: [], failedExecutions: [] }),
      fillLoader: async () => [],
      accountant: () => ({ hasFills: false, openPositions: {} }),
      riskEvaluator: async () => ({ allowed: true })
    })
    expect(research.ok).toBe(true)
    expect(research.orders.queued).toHaveLength(1)
    expect(f.provider.completeStructured).toHaveBeenCalledTimes(2)
    expect(f.usageGovernor.reserve).toHaveBeenCalledTimes(2)
    expect(f.usageGovernor.settle).toHaveBeenCalledTimes(2)
    expect(f.orders[0].simSession).toBe(fillDay)
    expect(f.orders[0].status).toBe('queued')
    expect(f.audits.filter(x => x.eventType === 'execution_created')).toHaveLength(1)
    const completed = f.events.find(x => x.type === 'decision_made')
    expect(completed?.metadata.investigation.toolTrace).toHaveLength(1)

    const first = await processPendingAiExecutions(f.bot.id, {
      currentSession: fillDay, prismaClient: f.prismaClient, engine: f.engine
    })
    const second = await processPendingAiExecutions(f.bot.id, {
      currentSession: fillDay, prismaClient: f.prismaClient, engine: f.engine
    })
    expect(first.filledExecutions).toHaveLength(1)
    expect(first.filledExecutions[0]).toMatchObject({
      session: fillDay, ticker: 'AAPL', fillPrice: 105
    })
    expect(second.filledExecutions).toHaveLength(0)
    expect(f.orders).toHaveLength(1)
    expect(f.orders[0].status).toBe('filled')
    expect(f.orders[0].filledPrice).toBe(105)
    expect(f.audits.filter(x => x.eventType === 'filled')).toHaveLength(1)
    expect(f.orders[0].attempts).toBe(1)

    const publicView = await readPublicStockTraderDashboard({
      prismaClient: f.prismaClient, engine: f.engine,
      fillLoader: async () => f.orders.filter(e => e.status === 'filled')
    })
    expect(publicView.simulated).toBe(true)
    expect(publicView.research[0].investigation.toolsUsed).toContain('get_stock_metrics')
    expect(publicView.research[0].investigation.modelCalls).toBe(2)
    expect(publicView.orders[0].status).toBe('filled')
    expect(publicView.research[0].investigation.rawToolResults).toBeUndefined()
  })

  it('does not create research claims, paid calls or orders while disabled', async () => {
    const f = harness()
    const result = await runStockTraderDailyJob({
      now, session: decisionDay, prismaClient: f.prismaClient,
      env: { ENABLE_FLAGSHIP_STOCK_TRADER: 'true', ENABLE_AI_PAID_CALLS: 'false' },
      engine: f.engine, provider: f.provider
    })
    expect(result.skipped).toBe(true)
    expect(f.provider.completeStructured).not.toHaveBeenCalled()
    expect(f.orders).toHaveLength(0)
    expect(f.events).toHaveLength(0)
  })
})
