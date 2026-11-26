import { describe, expect, it, vi } from 'vitest'
import { nextStockTraderSession } from '../../src/services/ai/stockTraderTradingSession.js'
import { createAiStockTraderConfig } from '../../src/services/ai/strategies/aiStockTraderStrategy.js'
import { runStockTraderResearch } from '../../src/services/ai/stockTraderResearchService.js'
import { loadStockTraderPaperPortfolio } from '../../src/services/ai/stockTraderPortfolio.js'
import { calculateFifoAccounting } from '../../src/services/botAccountingService.js'

describe('AI flagship beta release safety', () => {
  it('skips Thanksgiving, Christmas and weekends for next-session paper fills', () => {
    expect(nextStockTraderSession('2026-11-25')).toBe('2026-11-27')
    expect(nextStockTraderSession('2026-11-27')).toBe('2026-11-30')
    expect(nextStockTraderSession('2026-12-24')).toBe('2026-12-28')
    expect(() => nextStockTraderSession('2026-11-26')).toThrow(/exchange session/)
  })

  it('uses actual FIFO realized P&L when rebuilding post-sale cash', async () => {
    const trades = [
      { id: 'buy', ticker: 'AAPL', direction: 'buy', filledQuantity: 2, filledPrice: 100, createdAt: '2026-11-20T10:00:00Z' },
      { id: 'sell', ticker: 'AAPL', direction: 'sell', filledQuantity: 1, filledPrice: 125, createdAt: '2026-11-24T10:00:00Z' }
    ]
    const result = await loadStockTraderPaperPortfolio({
      bot: { id: 'bot', config: createAiStockTraderConfig() },
      screening: { asOfSession: '2026-11-25', shortlist: [{ symbol: 'AAPL', indicators: { price: 130 } }] },
      fillLoader: async () => trades,
      accountant: calculateFifoAccounting
    })
    expect(result.realizedPnl).toBe(25)
    expect(result.cash).toBe(9925)
    expect(result.positions[0].quantity).toBe(1)
    expect(result.totalEquity).toBe(10055)
  })

  it('blocks a second paid call if the same session receives a different snapshot', async () => {
    const bot = { id: 'flagship-bot', enabled: true, portfolioId: 'p', config: createAiStockTraderConfig() }
    const portfolio = { id: 'p' }
    const screening = { asOfSession: '2026-11-25', shortlist: [{ symbol: 'AAPL', eligible: true, inUniverse: true }], ranking: [], excluded: [] }
    const portfolioSnapshot = { asOfSession: '2026-11-25', cash: 10000, positions: [] }
    const client = { completeStructured: vi.fn(async () => ({ model: 'mock', usage: { prompt_tokens: 10, completion_tokens: 10 },
      structured: { marketSummary: 'Wait', decisions: [{ symbol: 'AAPL', action: 'HOLD', confidence: 0.5, thesis: 'No setup', evidence: [], risks: [] }] } })) }
    let event
    const db = { botEvent: {
      findUnique: vi.fn(async () => event || null),
      create: vi.fn(async ({ data }) => { event = data; return data }),
      updateMany: vi.fn(async ({ data }) => { event = { ...event, ...data }; return { count: 1 } })
    }}
    const governor = { reserve: vi.fn(async () => ({ id: 'res', botId: bot.id, period: '2026-11', reservedCents: 5 })),
      settle: vi.fn(async () => ({ settled: true })) }
    const opts = { bot, portfolio, screening, portfolioSnapshot, prismaClient: db, provider: client, usageGovernor: governor }
    const first = await runStockTraderResearch(opts)
    const changed = await runStockTraderResearch({ ...opts, portfolioSnapshot: { ...portfolioSnapshot, cash: 8000 } })
    expect(first.ok).toBe(true)
    expect(changed.reason).toBe('session_already_researched')
    expect(client.completeStructured).toHaveBeenCalledTimes(1)
    expect(governor.reserve).toHaveBeenCalledTimes(1)
  })

  it('cannot call a provider without a spending governor', async () => {
    const bot = { id: 'flagship-bot', enabled: true, portfolioId: 'p', config: createAiStockTraderConfig() }
    const provider = { completeStructured: vi.fn() }
    const db = { botEvent: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 }))
    } }
    await expect(runStockTraderResearch({
      bot, portfolio: { id: 'p' }, screening: { asOfSession: '2026-11-25', shortlist: [], ranking: [], excluded: [] },
      portfolioSnapshot: { asOfSession: '2026-11-25', cash: 10000, positions: [] },
      provider, prismaClient: db
    })).rejects.toThrow(/governor/)
    expect(provider.completeStructured).not.toHaveBeenCalled()
  })
})
