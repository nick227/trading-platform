import { describe, expect, it, vi } from 'vitest'
import { runStockTraderDailyJob } from '../../src/jobs/aiStockTraderDailyJob.js'
import { getExpectedCompletedExchangeSession } from '../../src/utils/marketCalendar.js'
import { createAiStockTraderConfig, AI_STOCK_TRADER_STRATEGY_ID } from '../../src/services/ai/strategies/aiStockTraderStrategy.js'

const now = new Date('2026-11-25T23:00:00Z')
const session = getExpectedCompletedExchangeSession(now)
const makeBars = () => Array.from({ length: 75 }, (_, i) => {
  const date = new Date(Date.parse(session + 'T00:00:00Z') - (74 - i) * 86400000).toISOString().slice(0,10)
  const price = 100 + i * 0.4
  return [date, price, price + 1, price - 1, price, 1_000_000]
})

function fixtures() {
  const config = createAiStockTraderConfig({ universe: { type: 'curated', symbols: ['AAPL'] } })
  const bot = { id: 'bot-flagship-test', userId: 'platform-user', portfolioId: 'portfolio-flagship', templateId: AI_STOCK_TRADER_STRATEGY_ID, enabled: true, config }
  const portfolio = { id: bot.portfolioId, userId: bot.userId }
  const orders = []
  let event
  const prismaClient = {
    botEvent: {
      findUnique: vi.fn(async () => event || null),
      create: vi.fn(async ({ data }) => { event = data; return data }),
      updateMany: vi.fn(async ({ data }) => { event = { ...event, ...data }; return { count: 1 } })
    },
    user: { findUnique: vi.fn(async () => ({ riskSettings: null })) },
    execution: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }) => { orders.push(data); return data })
    },
    executionAudit: { create: vi.fn(async () => ({})) }
  }
  prismaClient.$transaction = fn => fn(prismaClient)
  const provider = { completeStructured: vi.fn(async () => ({
    model: 'mock', usage: { prompt_tokens: 100, completion_tokens: 100 },
    structured: { marketSummary: 'Technically constructive', decisions: [{
      symbol: 'AAPL', action: 'BUY', confidence: 0.75,
      targetAllocationPct: 0.10, thesis: 'Positive momentum', evidence: ['20-day price trend'],
      risks: ['Regime uncertainty'], exitRule: { takeProfitPct: 8, stopLossPct: 4 }
    }] }
  })) }
  const usageGovernor = {
    reserve: vi.fn(async () => ({ id: 'reservation', botId: bot.id, period: '2026-11', reservedCents: 5 })),
    settle: vi.fn(async () => ({ settled: true }))
  }
  const engine = { getDailyBars: vi.fn(async () => ({ bars: makeBars() })) }
  return { bot, portfolio, prismaClient, provider, usageGovernor, engine, orders }
}

describe('flagship daily orchestration', () => {
  it('has no cost or execution effects unless the beta flags are enabled', async () => {
    const f = fixtures()
    const result = await runStockTraderDailyJob({ env: {}, provider: f.provider, prismaClient: f.prismaClient, engine: f.engine })
    expect(result.skipped).toBe(true)
    expect(f.provider.completeStructured).not.toHaveBeenCalled()
  })

  it('screens, reserves, researches and queues one audited paper trade', async () => {
    const f = fixtures()
    const result = await runStockTraderDailyJob({
      now, session,
      env: { ENABLE_FLAGSHIP_STOCK_TRADER: 'true', ENABLE_AI_PAID_CALLS: 'true' },
      prismaClient: f.prismaClient, engine: f.engine, provider: f.provider,
      botLoader: async () => ({ bot: f.bot, portfolio: f.portfolio }),
      fillLoader: async () => [],
      accountant: () => ({ hasFills: false, openPositions: {} }),
      pendingProcessor: async () => ({ filledExecutions: [], failedExecutions: [] }),
      riskEvaluator: async () => ({ allowed: true }),
      usageGovernor: f.usageGovernor
    })
    expect(result.ok).toBe(true)
    expect(result.orders.queued).toHaveLength(1)
    expect(f.orders[0].sourceType).toBe('AI_FORWARD')
    expect(f.provider.completeStructured).toHaveBeenCalledTimes(1)
    expect(f.usageGovernor.reserve).toHaveBeenCalledTimes(1)
    expect(f.usageGovernor.settle).toHaveBeenCalledTimes(1)
  })
})
