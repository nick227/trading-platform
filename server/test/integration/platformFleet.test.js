import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createMemoryPrisma } from '../support/memoryPrisma.js'
import {
  ensurePlatformFleet, getPlatformFleetHealth, platformFleetIds, isPlatformUserId, PLATFORM_FLEET_TEMPLATE_IDS
} from '../../src/services/platformFleetService.js'
import { isSimulatedOnlyAiExecution } from '../../../worker/src/queues/orderWorker.js'

const seed = JSON.parse(readFileSync(new URL('../../prisma/seeds/bot-templates.json', import.meta.url), 'utf8'))
const templates = Array.isArray(seed) ? seed : seed.templates

describe('platform paper fleet', () => {
  let db
  beforeEach(async () => {
    db = createMemoryPrisma()
    for (const t of templates) await db.botTemplate.create({ data: t })
  })

  it('creates one independent owner, portfolio and enabled bot per rule-based strategy', async () => {
    const res = await ensurePlatformFleet({ prismaClient: db, log: { error: vi.fn() } })
    expect(res.map(r => r.status)).toEqual(PLATFORM_FLEET_TEMPLATE_IDS.map(() => 'created'))

    const bots = await db.bot.findMany({ where: { userId: { startsWith: 'usr_platform_' } } })
    expect(bots).toHaveLength(6)
    expect(new Set(bots.map(b => b.userId)).size).toBe(6)
    expect(new Set(bots.map(b => b.portfolioId)).size).toBe(6)
    expect(bots.every(b => b.enabled && b.botType === 'rule_based')).toBe(true)

    const t = templates.find(x => x.id === 'tmpl_loss_guard')
    const ids = platformFleetIds('tmpl_loss_guard')
    const bot = await db.bot.findUnique({ where: { id: ids.botId } })
    expect(bot.config).toEqual(t.config)
    const rules = await db.botRule.findMany({ where: { botId: ids.botId } })
    expect(rules.map(r => [r.type, r.config])).toEqual(t.rules.map(r => [r.type, r.config]))
    const portfolio = await db.portfolio.findUnique({ where: { id: ids.portfolioId } })
    expect(portfolio).toMatchObject({ userId: ids.userId, environment: 'internal_sim', cashBalance: t.config.allocatedAmount })
    const user = await db.user.findUnique({ where: { id: ids.userId } })
    expect(user.passwordHash).toBe('$platform_system_locked_account$')
  })

  it('is idempotent and never re-enables or resets an existing bot', async () => {
    await ensurePlatformFleet({ prismaClient: db })
    const { botId, portfolioId } = platformFleetIds('tmpl_momentum_buy')
    await db.bot.update({ where: { id: botId }, data: { enabled: false } })
    await db.portfolio.update({ where: { id: portfolioId }, data: { cashBalance: 1234 } })

    const res = await ensurePlatformFleet({ prismaClient: db })
    expect(res.every(r => r.status === 'exists')).toBe(true)
    expect((await db.bot.findUnique({ where: { id: botId } })).enabled).toBe(false)
    expect((await db.portfolio.findUnique({ where: { id: portfolioId } })).cashBalance).toBe(1234)
    expect(await db.bot.count({ where: { userId: { startsWith: 'usr_platform_' } } })).toBe(6)
  })

  it('reports health per bot, attributing fills only to their own bot', async () => {
    await ensurePlatformFleet({ prismaClient: db })
    const a = platformFleetIds('tmpl_momentum_buy')
    const b = platformFleetIds('tmpl_dca_accumulator')
    const fill = { userId: a.userId, portfolioId: a.portfolioId, botId: a.botId, ticker: 'SPY', direction: 'buy', quantity: 2, price: 500,
      origin: 'bot', status: 'filled', filledQuantity: 2, filledPrice: 500, filledAt: new Date('2026-11-24T21:00:00Z'), simSession: '2026-11-24',
      brokerOrderId: 'sim_1', commission: 0, fees: 0, pnl: 0, sourceType: 'BOT' }
    await db.execution.create({ data: { id: 'e1', ...fill } })
    await db.execution.create({ data: { id: 'e2', ...fill, status: 'queued', filledQuantity: null, filledPrice: null, filledAt: null, brokerOrderId: null, simSession: '2026-11-25' } })

    const health = await getPlatformFleetHealth({ prismaClient: db })
    const ha = health.find(h => h.botId === a.botId)
    const hb = health.find(h => h.botId === b.botId)
    expect(ha).toMatchObject({ enabled: true, pendingOrders: 1, sessionsWithFills: 1, lastMarketSession: '2026-11-24', executionsByStatus: { filled: 1, queued: 1 } })
    expect(ha.openPositions.SPY.quantity).toBe(2)
    expect(hb).toMatchObject({ fillCount: 0, pendingOrders: 0, lastFill: null, openPositions: {} })
    expect(hb.lastEvaluation).toBeNull() // the start event is not an evaluation
  })

  it('identifies platform-owned accounts', () => {
    expect(isPlatformUserId('usr_platform_canonical')).toBe(true)
    expect(isPlatformUserId(platformFleetIds('tmpl_loss_guard').userId)).toBe(true)
    expect(isPlatformUserId('usr_123')).toBe(false)
    expect(isPlatformUserId(null)).toBe(false)
  })
})

describe('order worker leaves AI Momentum next-session orders to the AI daily job', () => {
  it('treats AI Momentum entries and exits as simulator-only', () => {
    expect(isSimulatedOnlyAiExecution({ id: 'exec_ai_7fde3cd4000c452b', botId: 'bot_canonical_ai_catalyst_momentum' })).toBe(true)
    expect(isSimulatedOnlyAiExecution({ id: 'exec_ai_exit_abc', botId: 'bot_canonical_ai_catalyst_momentum' })).toBe(true)
    expect(isSimulatedOnlyAiExecution({ id: 'exec_123', botId: 'bot_platform_momentum_buy' })).toBe(false)
  })
})
