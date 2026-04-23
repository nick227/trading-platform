import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import createApp from '../../loaders/fastify.js'
import botRoutes from './index.js'
import { authenticate } from '../../middleware/authenticate.js'

// ─── Hoisted fixtures ────────────────────────────────────────────────────────

const mockBot = vi.hoisted(() => ({
  id: 'bot_test123',
  userId: 'usr_test123',
  name: 'Test Bot',
  portfolioId: 'por_test123',
  strategyId: null,
  templateId: null,
  botType: 'rule_based',
  enabled: true,
  config: {},
  deletedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
}))

const mockRule = vi.hoisted(() => ({
  id: 'rul_test123',
  botId: 'bot_test123',
  name: 'Test Rule',
  type: 'price_threshold',
  config: { threshold: 150 },
  enabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
}))

const mockTemplate = vi.hoisted(() => ({
  id: 'tpl_test123',
  name: 'Momentum Bot',
  botType: 'rule_based',
  config: { tickers: ['AAPL'] },
  rules: [{ name: 'Price Rule', type: 'price_threshold', config: {} }]
}))

const mockEvent = vi.hoisted(() => ({
  id: 'evt_test123',
  botId: 'bot_test123',
  portfolioId: 'por_test123',
  type: 'rule_triggered',
  detail: 'Rule fired',
  metadata: {}
}))

const mockPortfolio = vi.hoisted(() => ({
  id: 'por_test123',
  userId: 'usr_test123',
  name: 'Main Portfolio'
}))

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../middleware/authenticate.js', () => ({
  authenticate: vi.fn(async (request) => {
    request.user = { id: 'usr_test123' }
  })
}))

vi.mock('../../services/botsService.js', () => ({
  default: {
    getBots: vi.fn().mockResolvedValue({
      data: [mockBot],
      pagination: { total: 1, hasMore: false, nextOffset: null }
    }),
    getBot: vi.fn().mockResolvedValue(mockBot),
    createBot: vi.fn().mockResolvedValue(mockBot),
    updateBot: vi.fn().mockResolvedValue({ ...mockBot, name: 'Updated Bot' }),
    deleteBot: vi.fn().mockResolvedValue(mockBot),
    getCatalog: vi.fn().mockResolvedValue([mockTemplate]),
    getCatalogTemplate: vi.fn().mockResolvedValue(mockTemplate),
    createBotFromTemplate: vi.fn().mockResolvedValue({ ...mockBot, rules: [mockRule] }),
    getBotEvents: vi.fn().mockResolvedValue({
      data: [mockEvent],
      pagination: { total: 1, hasMore: false, nextOffset: null }
    }),
    createBotEvent: vi.fn().mockResolvedValue(mockEvent)
  }
}))

vi.mock('../../loaders/prisma.js', () => ({
  default: {
    portfolio: {
      findUnique: vi.fn().mockResolvedValue(mockPortfolio)
    },
    bot: {
      findFirst: vi.fn().mockResolvedValue(mockBot)
    },
    botRule: {
      findMany: vi.fn().mockResolvedValue([{ ...mockRule, bot: { id: 'bot_test123', name: 'Test Bot' } }]),
      count: vi.fn().mockResolvedValue(1),
      findUnique: vi.fn().mockResolvedValue({ ...mockRule, bot: mockBot }),
      create: vi.fn().mockResolvedValue(mockRule),
      update: vi.fn().mockResolvedValue({ ...mockRule, name: 'Updated Rule' }),
      delete: vi.fn().mockResolvedValue(mockRule)
    }
  }
}))

// ─── App setup ───────────────────────────────────────────────────────────────

let app

beforeAll(async () => {
  app = await createApp()
  await app.register(async (secured) => {
    secured.addHook('preHandler', authenticate)
    await secured.register(botRoutes, { prefix: '/api/bots' })
  })
  await app.ready()
})

afterAll(() => app.close())

// ─── /api/bots (bots.js) ─────────────────────────────────────────────────────

describe('GET /api/bots', () => {
  it('returns paginated bots list', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bots' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe('bot_test123')
    expect(body.pagination.total).toBe(1)
  })
})

describe('GET /api/bots/:id', () => {
  it('returns bot details', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bots/bot_test123' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.id).toBe('bot_test123')
  })

  it('returns 404 when bot not found', async () => {
    const botsService = (await import('../../services/botsService.js')).default
    vi.mocked(botsService.getBot).mockResolvedValueOnce(null)

    const res = await app.inject({ method: 'GET', url: '/api/bots/bot_missing' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })

  it('returns 404 when bot belongs to another user', async () => {
    const botsService = (await import('../../services/botsService.js')).default
    vi.mocked(botsService.getBot).mockResolvedValueOnce({ ...mockBot, userId: 'usr_other' })

    const res = await app.inject({ method: 'GET', url: '/api/bots/bot_test123' })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/bots', () => {
  it('creates a bot and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bots',
      payload: { name: 'New Bot', portfolioId: 'por_test123' }
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.id).toBe('bot_test123')
  })

  it('returns 400 when portfolioId is invalid', async () => {
    const prisma = (await import('../../loaders/prisma.js')).default
    vi.mocked(prisma.portfolio.findUnique).mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'POST',
      url: '/api/bots',
      payload: { name: 'New Bot', portfolioId: 'por_wrong' }
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('INVALID_PORTFOLIO')
  })

  it('returns 400 when portfolio belongs to another user', async () => {
    const prisma = (await import('../../loaders/prisma.js')).default
    vi.mocked(prisma.portfolio.findUnique).mockResolvedValueOnce({ ...mockPortfolio, userId: 'usr_other' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/bots',
      payload: { name: 'New Bot', portfolioId: 'por_test123' }
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bots',
      payload: { name: 'No Portfolio' }
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('PUT /api/bots/:id', () => {
  it('updates a bot and returns updated data', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/bots/bot_test123',
      payload: { name: 'Updated Bot' }
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.name).toBe('Updated Bot')
  })

  it('returns 404 when bot not found', async () => {
    const botsService = (await import('../../services/botsService.js')).default
    vi.mocked(botsService.getBot).mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'PUT',
      url: '/api/bots/bot_missing',
      payload: { name: 'Updated Bot' }
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /api/bots/:id', () => {
  it('soft-deletes a bot and returns 204', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/bots/bot_test123' })
    expect(res.statusCode).toBe(204)
  })

  it('returns 404 when bot not found', async () => {
    const botsService = (await import('../../services/botsService.js')).default
    vi.mocked(botsService.getBot).mockResolvedValueOnce(null)

    const res = await app.inject({ method: 'DELETE', url: '/api/bots/bot_missing' })
    expect(res.statusCode).toBe(404)
  })
})

// ─── /api/bots/catalog (catalog.js) ──────────────────────────────────────────

describe('GET /api/bots/catalog', () => {
  it('returns all templates', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bots/catalog' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
    expect(res.json().data[0].id).toBe('tpl_test123')
  })
})

describe('GET /api/bots/catalog/:id', () => {
  it('returns a single template', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bots/catalog/tpl_test123' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.name).toBe('Momentum Bot')
  })

  it('returns 404 when template not found', async () => {
    const botsService = (await import('../../services/botsService.js')).default
    vi.mocked(botsService.getCatalogTemplate).mockResolvedValueOnce(null)

    const res = await app.inject({ method: 'GET', url: '/api/bots/catalog/tpl_missing' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })
})

describe('POST /api/bots/catalog/from-template', () => {
  it('creates a bot from a template and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bots/catalog/from-template',
      payload: { templateId: 'tpl_test123', portfolioId: 'por_test123' }
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.id).toBe('bot_test123')
  })

  it('returns 400 when portfolio is invalid', async () => {
    const prisma = (await import('../../loaders/prisma.js')).default
    vi.mocked(prisma.portfolio.findUnique).mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'POST',
      url: '/api/bots/catalog/from-template',
      payload: { templateId: 'tpl_test123', portfolioId: 'por_wrong' }
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('INVALID_PORTFOLIO')
  })

  it('returns 404 when template does not exist', async () => {
    const botsService = (await import('../../services/botsService.js')).default
    vi.mocked(botsService.createBotFromTemplate).mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'POST',
      url: '/api/bots/catalog/from-template',
      payload: { templateId: 'tpl_missing', portfolioId: 'por_test123' }
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bots/catalog/from-template',
      payload: { templateId: 'tpl_test123' }
    })
    expect(res.statusCode).toBe(400)
  })
})

// ─── /api/bots/:id/events (events.js) ────────────────────────────────────────

describe('GET /api/bots/:id/events', () => {
  it('returns events for a bot', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bots/bot_test123/events' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe('evt_test123')
  })

  it('returns 404 when bot not found', async () => {
    const prisma = (await import('../../loaders/prisma.js')).default
    vi.mocked(prisma.bot.findFirst).mockResolvedValueOnce(null)

    const res = await app.inject({ method: 'GET', url: '/api/bots/bot_missing/events' })
    expect(res.statusCode).toBe(404)
  })

  it('returns 404 when bot belongs to another user', async () => {
    const prisma = (await import('../../loaders/prisma.js')).default
    vi.mocked(prisma.bot.findFirst).mockResolvedValueOnce({ ...mockBot, userId: 'usr_other' })

    const res = await app.inject({ method: 'GET', url: '/api/bots/bot_test123/events' })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/bots/:id/events', () => {
  it('creates an event and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bots/bot_test123/events',
      payload: {
        botId: 'bot_test123',
        portfolioId: 'por_test123',
        type: 'rule_triggered',
        detail: 'Rule fired'
      }
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.id).toBe('evt_test123')
  })

  it('returns 404 when bot not found', async () => {
    const prisma = (await import('../../loaders/prisma.js')).default
    vi.mocked(prisma.bot.findFirst).mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'POST',
      url: '/api/bots/bot_missing/events',
      payload: {
        botId: 'bot_missing',
        portfolioId: 'por_test123',
        type: 'rule_triggered',
        detail: 'Rule fired'
      }
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bots/bot_test123/events',
      payload: { botId: 'bot_test123' }
    })
    expect(res.statusCode).toBe(400)
  })
})

// ─── /api/bots/:id/rules (rules.js) ──────────────────────────────────────────

describe('GET /api/bots/:id/rules', () => {
  it('returns paginated rules for a bot', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bots/bot_test123/rules' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe('rul_test123')
    expect(body.pagination.total).toBe(1)
  })

  it('returns 404 when bot not found', async () => {
    const prisma = (await import('../../loaders/prisma.js')).default
    vi.mocked(prisma.bot.findFirst).mockResolvedValueOnce(null)

    const res = await app.inject({ method: 'GET', url: '/api/bots/bot_missing/rules' })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /api/bots/:id/rules/:ruleId', () => {
  it('returns a single rule', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bots/bot_test123/rules/rul_test123' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.id).toBe('rul_test123')
  })

  it('returns 404 when rule not found', async () => {
    const prisma = (await import('../../loaders/prisma.js')).default
    vi.mocked(prisma.botRule.findUnique).mockResolvedValueOnce(null)

    const res = await app.inject({ method: 'GET', url: '/api/bots/bot_test123/rules/rul_missing' })
    expect(res.statusCode).toBe(404)
  })

  it('returns 404 when rule belongs to a different bot', async () => {
    const prisma = (await import('../../loaders/prisma.js')).default
    vi.mocked(prisma.botRule.findUnique).mockResolvedValueOnce({ ...mockRule, botId: 'bot_other' })

    const res = await app.inject({ method: 'GET', url: '/api/bots/bot_test123/rules/rul_test123' })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/bots/:id/rules', () => {
  it('creates a rule and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bots/bot_test123/rules',
      payload: { name: 'Price Rule', type: 'price_threshold', config: { threshold: 150 } }
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.id).toBe('rul_test123')
    expect(res.json().data.type).toBe('price_threshold')
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bots/bot_test123/rules',
      payload: { name: 'Missing Type' }
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when bot not found', async () => {
    const prisma = (await import('../../loaders/prisma.js')).default
    vi.mocked(prisma.bot.findFirst).mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'POST',
      url: '/api/bots/bot_missing/rules',
      payload: { name: 'Price Rule', type: 'price_threshold' }
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('PUT /api/bots/:id/rules/:ruleId', () => {
  it('updates a rule and returns updated data', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/bots/bot_test123/rules/rul_test123',
      payload: { name: 'Updated Rule' }
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.name).toBe('Updated Rule')
  })

  it('returns 404 when rule belongs to a different bot', async () => {
    const prisma = (await import('../../loaders/prisma.js')).default
    vi.mocked(prisma.botRule.findUnique).mockResolvedValueOnce({ ...mockRule, botId: 'bot_other' })

    const res = await app.inject({
      method: 'PUT',
      url: '/api/bots/bot_test123/rules/rul_test123',
      payload: { name: 'Updated Rule' }
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 404 when rule not found', async () => {
    const prisma = (await import('../../loaders/prisma.js')).default
    vi.mocked(prisma.botRule.findUnique).mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'PUT',
      url: '/api/bots/bot_test123/rules/rul_missing',
      payload: { name: 'Updated Rule' }
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /api/bots/:id/rules/:ruleId', () => {
  it('deletes a rule and returns 204', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/bots/bot_test123/rules/rul_test123' })
    expect(res.statusCode).toBe(204)
  })

  it('returns 404 when rule belongs to a different bot', async () => {
    const prisma = (await import('../../loaders/prisma.js')).default
    vi.mocked(prisma.botRule.findUnique).mockResolvedValueOnce({ ...mockRule, botId: 'bot_other' })

    const res = await app.inject({ method: 'DELETE', url: '/api/bots/bot_test123/rules/rul_test123' })
    expect(res.statusCode).toBe(404)
  })

  it('returns 404 when rule not found', async () => {
    const prisma = (await import('../../loaders/prisma.js')).default
    vi.mocked(prisma.botRule.findUnique).mockResolvedValueOnce(null)

    const res = await app.inject({ method: 'DELETE', url: '/api/bots/bot_test123/rules/rul_missing' })
    expect(res.statusCode).toBe(404)
  })
})
