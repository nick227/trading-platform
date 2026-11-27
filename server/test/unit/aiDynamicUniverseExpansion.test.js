import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createAiStockTraderAgentConfig,
  AI_STOCK_TRADER_PLATFORM_BOT_ID,
  AI_STOCK_TRADER_PLATFORM_PORTFOLIO_ID,
  AI_STOCK_TRADER_PLATFORM_USER_ID,
  AI_STOCK_TRADER_STRATEGY_ID
} from '../../src/services/ai/strategies/aiStockTraderStrategy.js'
import { setPlatformStockTraderDynamicDiscovery } from '../../src/services/ai/aiStockTraderBotService.js'
import { resolveTradableDiscoveryPromotions, resetStockDiscoveryCache } from '../../src/services/ai/stockDiscoveryService.js'
import { runStockTraderDailyJob, resolveDynamicDiscoveryConfig } from '../../src/jobs/aiStockTraderDailyJob.js'
import { getExpectedCompletedExchangeSession } from '../../src/utils/marketCalendar.js'

const now = new Date('2026-11-25T23:00:00Z')
const session = getExpectedCompletedExchangeSession(now)

function makeBars(base = 120, step = 0.6) {
  const dates = []
  let curr = new Date(session + 'T00:00:00Z')
  while (dates.length < 65) {
    const day = curr.getUTCDay()
    if (day !== 0 && day !== 6) dates.push(curr.toISOString().slice(0, 10))
    curr = new Date(curr.getTime() - 86_400_000)
  }
  dates.reverse()
  return dates.map((d, idx) => {
    const close = Number((base + idx * step).toFixed(2))
    const open = Number((close - 0.25).toFixed(2))
    return [d, open, Number((close + 1).toFixed(2)), Number((open - 0.8).toFixed(2)), close, 2_000_000]
  })
}

describe('Flagship Dynamic Universe Expansion Toggle', () => {
  beforeEach(() => {
    resetStockDiscoveryCache()
  })

  it('defaults dynamicDiscovery to disabled and validates maxPromotions bounds', () => {
    const defCfg = createAiStockTraderAgentConfig()
    expect(defCfg.universe.dynamicDiscovery).toEqual({ enabled: false, maxPromotions: 5 })

    const enabledCfg = createAiStockTraderAgentConfig({
      universe: { type: 'curated', symbols: ['AAPL', 'NVDA'], dynamicDiscovery: { enabled: true, maxPromotions: 4 } }
    })
    expect(enabledCfg.universe.dynamicDiscovery).toEqual({ enabled: true, maxPromotions: 4 })

    expect(() => createAiStockTraderAgentConfig({
      universe: { type: 'curated', symbols: ['AAPL'], dynamicDiscovery: { enabled: true, maxPromotions: 99 } }
    })).toThrow(/maxPromotions/)
  })

  it('toggles dynamicDiscovery on the v2 platform bot without altering risk limits', async () => {
    const bot = {
      id: AI_STOCK_TRADER_PLATFORM_BOT_ID,
      userId: AI_STOCK_TRADER_PLATFORM_USER_ID,
      portfolioId: AI_STOCK_TRADER_PLATFORM_PORTFOLIO_ID,
      templateId: AI_STOCK_TRADER_STRATEGY_ID,
      deletedAt: null,
      config: createAiStockTraderAgentConfig()
    }
    let savedConfig = null
    const prismaClient = {
      bot: {
        findUnique: vi.fn(async () => bot),
        update: vi.fn(async ({ data }) => { savedConfig = data.config; return { ...bot, config: data.config } })
      }
    }

    const res = await setPlatformStockTraderDynamicDiscovery({
      enabled: true,
      maxPromotions: 3,
      prismaClient
    })
    expect(res.dynamicDiscovery).toEqual({ enabled: true, maxPromotions: 3 })
    expect(savedConfig.execution.maxPositionPct).toBe(0.20)
    expect(savedConfig.execution.maxOrderNotional).toBe(2000)
  })

  it('defers beyond-watchlist discoveries that 404 on paper_daily execution feed and promotes verified symbols', async () => {
    const engine = {
      getTickers: vi.fn(async () => ({ tickers: ['SPY', 'AAPL', 'LLY', 'REGN'] })),
      getDailyBars: vi.fn(async (sym) => {
        if (sym === 'SPY' || sym === 'AAPL') return { bars: makeBars(200, 0.3) }
        if (sym === 'LLY') return { bars: makeBars(150, 1.4) }
        throw new Error('Alpha Engine 404: ticker not in live universe')
      }),
      getCandles: vi.fn(async (sym) => {
        if (sym === 'REGN') {
          return {
            candles: makeBars(150, 1.6).map(b => ({ t: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] }))
          }
        }
        return { candles: [] }
      }),
      getSessionClose: vi.fn(async (sym) => {
        if (sym === 'LLY' || sym === 'SPY' || sym === 'AAPL') return { session, open: 235, close: 240 }
        throw new Error('404')
      })
    }

    const res = await resolveTradableDiscoveryPromotions({
      engine,
      prismaClient: { botEvent: { findMany: async () => [] } },
      evidenceRegistry: { assemble: async () => ({ records: [] }) },
      session,
      baseSymbols: ['SPY', 'AAPL'],
      maxPromotions: 5
    })

    expect(res.promoted.map(p => p.symbol)).toEqual(['LLY'])
    expect(res.deferred.some(d => d.symbol === 'REGN' && d.reason === 'not_in_paper_execution_feed')).toBe(true)
  })

  it('promotes execution-verified discoveries directly into aiStockTraderDailyJob shortlist and queues paper BUY', async () => {
    const config = createAiStockTraderAgentConfig({
      universe: { type: 'curated', symbols: ['AAPL'], dynamicDiscovery: { enabled: true, maxPromotions: 3 } }
    })
    const bot = {
      id: AI_STOCK_TRADER_PLATFORM_BOT_ID,
      userId: AI_STOCK_TRADER_PLATFORM_USER_ID,
      portfolioId: AI_STOCK_TRADER_PLATFORM_PORTFOLIO_ID,
      templateId: AI_STOCK_TRADER_STRATEGY_ID,
      enabled: true,
      config
    }
    const portfolio = { id: bot.portfolioId, userId: bot.userId }
    const orders = []
    let savedEvent = null

    const prismaClient = {
      botEvent: {
        findUnique: vi.fn(async () => savedEvent),
        findMany: vi.fn(async () => []),
        create: vi.fn(async ({ data }) => { savedEvent = data; return data }),
        updateMany: vi.fn(async ({ data }) => { savedEvent = { ...savedEvent, ...data }; return { count: 1 } })
      },
      user: { findUnique: vi.fn(async () => ({ riskSettings: null })) },
      portfolio: { update: vi.fn(async () => portfolio) },
      execution: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }) => { orders.push(data); return data })
      },
      executionAudit: { create: vi.fn(async () => ({})) }
    }
    prismaClient.$transaction = fn => fn(prismaClient)

    const engine = {
      getTickers: vi.fn(async () => ({ tickers: ['SPY', 'AAPL', 'LLY'] })),
      getDailyBars: vi.fn(async (sym) => {
        if (sym === 'LLY') return { bars: makeBars(150, 1.5) }
        if (sym === 'SPY' || sym === 'AAPL') return { bars: makeBars(200, 0.3) }
        return { bars: [] }
      }),
      getSessionClose: vi.fn(async (sym) => ({ ticker: sym, session, open: 245, close: 248 }))
    }

    const provider = {
      completeStructured: vi.fn(async ({ systemPrompt }) => {
        if (String(systemPrompt).includes('investment researcher')) {
          return {
            model: 'gpt-4o-mini',
            usage: { prompt_tokens: 100, completion_tokens: 30 },
            structured: { focus: 'Inspect promoted discovery LLY', requests: [{ toolId: 'get_stock_metrics', args: { symbol: 'LLY' } }] }
          }
        }
        return {
          model: 'gpt-4o-mini',
          usage: { prompt_tokens: 200, completion_tokens: 80 },
          structured: {
            marketSummary: 'Healthcare leader LLY promoted into shortlist.',
            decisions: [{
              symbol: 'LLY',
              action: 'BUY',
              confidence: 0.84,
              targetAllocationPct: 0.16,
              thesis: 'Beyond-watchlist Healthcare leader with strong relative strength.',
              evidence: ['Outperforming SPY over 20 sessions'],
              risks: ['Clinical trial volatility'],
              exitRule: { takeProfitPct: 8, stopLossPct: 4 }
            }]
          }
        }
      })
    }

    const usageGovernor = {
      reserve: vi.fn(async () => ({ id: 'res_1', botId: bot.id, period: '2026-11', reservedCents: 5 })),
      settle: vi.fn(async () => ({ settled: true }))
    }

    expect(resolveDynamicDiscoveryConfig(bot, {}).enabled).toBe(true)

    const result = await runStockTraderDailyJob({
      now,
      session,
      env: { ENABLE_FLAGSHIP_STOCK_TRADER: 'true', ENABLE_AI_PAID_CALLS: 'true' },
      prismaClient,
      engine,
      provider,
      botLoader: async () => ({ bot, portfolio }),
      fillLoader: async () => [],
      accountant: () => ({ hasFills: false, openPositions: {} }),
      pendingProcessor: async () => ({ filledExecutions: [], failedExecutions: [] }),
      riskEvaluator: async () => ({ allowed: true }),
      usageGovernor,
      externalEvidenceRegistry: { assemble: async () => ({ records: [], unavailable: [], totalBytes: 0, asOfSession: session, evidenceVersion: '1.0.0', fingerprint: 'a'.repeat(64) }) }
    })

    expect(result.ok).toBe(true)
    expect(result.screening.discoveryExpansion.enabled).toBe(true)
    expect(result.screening.discoveryExpansion.promotedSymbols).toEqual(['LLY'])
    expect(result.screening.shortlist).toContain('LLY')
    expect(result.orders.queued).toHaveLength(1)
    expect(result.orders.queued[0].symbol).toBe('LLY')
  })
})
