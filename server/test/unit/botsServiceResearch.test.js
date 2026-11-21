/** Research-driven bot settings are validated with the bot engine's own policy resolver. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createMemoryPrisma } from '../support/memoryPrisma.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../src/loaders/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))

const { default: botsService } = await import('../../src/services/botsService.js')
const seeded = JSON.parse(readFileSync(new URL('../../prisma/seeds/bot-templates.json', import.meta.url), 'utf8'))
const researchTemplate = seeded.find((t) => t.id === 'tmpl_alpha_research')

beforeEach(async () => {
  h.db = createMemoryPrisma()
  await h.db.botTemplate.create({ data: { ...researchTemplate, isActive: true } })
})

const create = (extra = {}) => botsService.createBotFromTemplate({
  templateId: 'tmpl_alpha_research', userId: 'usr_a', portfolioId: 'por_a', name: 'R', tickers: ['SPY'],
  allocatedAmount: 1000, maxOrderNotional: 500, enabled: false, ...extra,
})

describe('research bot settings', () => {
  it('creates a research bot from the template, merging wizard settings over template keys', async () => {
    const bot = await create({ config: { research: { ...researchTemplate.config.research, minConfidence: 0.75 } } })
    const stored = await h.db.bot.findUnique({ where: { id: bot.id } })
    expect(stored.config).toMatchObject({ signalSource: 'alpha_research', tickers: ['SPY'], research: { minConfidence: 0.75, maxPredictionAgeHours: 96, maxEntryDriftPct: 5 } })
  })

  it('rejects research settings the bot engine would refuse, creating nothing', async () => {
    await expect(create({ config: { research: { minConfidence: 1.5 } } })).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('invalid_minConfidence') })
    await expect(create({ config: { research: { maxPredictionAgeHours: 0 } } })).rejects.toMatchObject({ statusCode: 400 })
    expect(await h.db.bot.count()).toBe(0)
  })

  it('validates research settings on update, and leaves rule bots alone', async () => {
    const bot = await create()
    await expect(botsService.updateBot(bot.id, { config: { signalSource: 'alpha_research', research: { maxEntryDriftPct: 99 } } })).rejects.toMatchObject({ statusCode: 400 })
    expect((await h.db.bot.findUnique({ where: { id: bot.id } })).config.research.maxEntryDriftPct).toBe(5)
    await expect(botsService.createBot({ userId: 'usr_a', portfolioId: 'por_a', name: 'plain', config: { direction: 'buy', research: { minConfidence: 9 } } })).resolves.toBeTruthy()
  })
})
