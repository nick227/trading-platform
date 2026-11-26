import { describe, expect, it, vi } from 'vitest'
import { loadAiDecisionMemory } from '../../src/services/ai/decisionMemory.js'
import { createDefaultStockTraderContextRegistry } from '../../src/services/ai/stockTraderContext.js'
import { createAiStockTraderAgentConfig } from '../../src/services/ai/strategies/aiStockTraderStrategy.js'
import { buildStockTraderPrompts } from '../../src/services/ai/strategies/stockTraderDecision.js'

const bot = { id: 'memory-bot' }
const date = '2026-11-25'
const event = (id, session, status = 'completed', action = 'BUY') => ({
  id, botId: bot.id, type: 'decision_made', createdAt: new Date(session + 'T23:00:00Z'),
  metadata: {
    status,
    decision: {
      asOfSession: session, marketSummary: 'Market evidence was mixed',
      decisions: [{
        symbol: 'AAPL', action, thesis: 'Original reason for this decision',
        evidence: ['Historical technical evidence'], risks: ['Concentration']
      }]
    }
  }
})
const fill = (id, session) => ({
  id, botId: bot.id, simSession: session, ticker: 'AAPL',
  direction: 'buy', filledPrice: 110, filledQuantity: 1
})
function fixtures() {
  const events = [
    event('past-1', '2026-11-24'),
    event('past-2', '2026-11-21'),
    event('same-session', date),
    event('future', '2026-11-26'),
    event('failed', '2026-11-23', 'failed')
  ]
  events.push({ ...event('other', '2026-11-22'), botId: 'another-bot' })
  const executions = [fill('filled-1', '2026-11-24'),
    fill('future-fill', '2026-11-26'),
    { ...fill('other-fill', '2026-11-24'), botId: 'another-bot' }]
  const db = {
    botEvent: { findMany: vi.fn(async () => events) },
    execution: { findMany: vi.fn(async () => executions) }
  }
  const engine = { getSessionClose: vi.fn(async (_, session) => ({
    session, close: session === date ? 110 : 100
  })) }
  return { events, executions, db, engine }
}

describe('MR 15 AI decision memory', () => {
  it('preserves only prior completed decisions with deterministic observed price changes', async () => {
    const f = fixtures()
    const before = JSON.stringify(f.events)
    const result = await loadAiDecisionMemory({
      bot, asOfSession: date, prismaClient: f.db, engine: f.engine
    })
    expect(result.history.map(h => h.researchEventId)).toEqual(['past-1','past-2'])
    expect(result.history[0].decisions[0].observedPriceChangePct).toBe(10)
    expect(result.history[0].decisions[0].observationType).toMatch(/not_trading_pnl/)
    expect(result.observedPaperFills).toHaveLength(1)
    expect(result.observedPaperFills[0].id).toBe('filled-1')
    expect(result.disclaimer).toMatch(/not evidence of predictive skill/)
    expect(JSON.stringify(f.events)).toBe(before)
  })

  it('marks missing point-in-time prices unavailable and never fabricates performance', async () => {
    const f = fixtures()
    f.engine.getSessionClose = vi.fn(async () => null)
    const result = await loadAiDecisionMemory({
      bot, asOfSession: date, prismaClient: f.db, engine: f.engine
    })
    expect(result.history[0].decisions[0].observationStatus).toBe('unavailable')
    expect(result.history[0].decisions[0].observedPriceChangePct).toBeNull()
  })

  it('is reproducible, bounded and fails closed if historical records are too large', async () => {
    const f = fixtures()
    const a = await loadAiDecisionMemory({ bot, asOfSession: date, prismaClient: f.db, engine: f.engine })
    const b = await loadAiDecisionMemory({ bot, asOfSession: date, prismaClient: f.db, engine: f.engine })
    expect(a.fingerprint).toBe(b.fingerprint)
    const many = Array.from({ length: 30 }, (_, i) =>
      event('evt-' + i, '2026-11-21'))
    many.forEach(e => {
      e.metadata.decision.decisions[0].thesis = 'Long thesis '.repeat(200)
    })
    f.db.botEvent.findMany = async () => many
    await expect(loadAiDecisionMemory({
      bot, asOfSession: date, prismaClient: f.db, engine: f.engine,
      maxCycles: 20, maxBytes: 1024
    })).rejects.toThrow(/byte budget/)
  })

  it('binds prior decisions to the versioned research fingerprint and final model prompt', async () => {
    const f = fixtures()
    const memory = await loadAiDecisionMemory({
      bot, asOfSession: date, prismaClient: f.db, engine: f.engine
    })
    const config = createAiStockTraderAgentConfig()
    const input = {
      screening: { asOfSession: date, shortlist: [], ranking: [], excluded: [] },
      portfolio: { asOfSession: date, cash: 10000, positions: [] },
      config
    }
    const registry = createDefaultStockTraderContextRegistry()
    const baseline = await registry.assemble({ session: date, input })
    const extended = await registry.assemble({ session: date, input, decisionMemory: memory })
    expect(extended.fingerprint).not.toBe(baseline.fingerprint)
    expect(buildStockTraderPrompts(extended).userPrompt).toContain('prior')
    await expect(registry.assemble({
      session: date, input,
      decisionMemory: { ...memory, asOfSession: '2026-11-26' }
    })).rejects.toThrow(/memory/)
  })
})
