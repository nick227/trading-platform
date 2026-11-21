import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

// Unmock client so integration tests use real client through MSW
vi.unmock('../../api/client')

import { 
  getBots, 
  getBotById, 
  updateBot, 
  deleteBot,
  createBotFromTemplate,
  createStrategyBot 
} from '../../api/services/botCatalogService'
import { mockBots, mockTemplates } from '../fixtures/botFixtures'

// MSW server setup
const server = setupServer(
  // GET /api/bots
  http.get('*/api/bots', () => {
    return HttpResponse.json(mockBots)
  }),
  
  // GET /api/bots/:id
  http.get('*/api/bots/:id', ({ params }) => {
    const { id } = params
    const bot = mockBots.find(b => b.id === id)
    if (!bot) {
      return HttpResponse.json({ error: 'Bot not found' }, { status: 404 })
    }
    return HttpResponse.json(bot)
  }),
  
  // PUT /api/bots/:id
  http.put('*/api/bots/:id', async ({ params, request }) => {
    const { id } = params
    const updateData = await request.json() as any
    const bot = mockBots.find(b => b.id === id)
    if (!bot) {
      return HttpResponse.json({ error: 'Bot not found' }, { status: 404 })
    }
    const updatedBot = { ...bot, ...updateData, updatedAt: new Date().toISOString() }
    return HttpResponse.json(updatedBot)
  }),
  
  // DELETE /api/bots/:id
  http.delete('*/api/bots/:id', ({ params }) => {
    const { id } = params
    const bot = mockBots.find(b => b.id === id)
    if (!bot) {
      return HttpResponse.json({ error: 'Bot not found' }, { status: 404 })
    }
    return HttpResponse.json({ success: true, deletedBot: bot })
  }),
  
  // POST /api/bots/catalog/from-template
  http.post('*/api/bots/catalog/from-template', async ({ request }) => {
    const body = await request.json() as any
    const newBot = {
      id: `bot-${Date.now()}`,
      ...body,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null
    }
    return HttpResponse.json(newBot, { status: 201 })
  }),
  
  // POST /api/bots/strategy-based
  http.post('*/api/bots/strategy-based', async ({ request }) => {
    const body = await request.json() as any
    const newBot = {
      id: `bot-${Date.now()}`,
      ...body,
      botType: 'strategy_based',
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null
    }
    return HttpResponse.json(newBot, { status: 201 })
  })
)

describe('Bot CRUD Integration Tests', () => {
  beforeAll(() => server.listen())
  afterEach(() => server.resetHandlers())
  afterAll(() => server.close())

  describe('Bot Retrieval', () => {
    it('should fetch all bots', async () => {
      const result = await getBots()
      
      expect(result).toEqual(mockBots)
      expect(result).toHaveLength(3)
      expect(result[0].name).toBe('SPY Trend Bot')
    })

    it('should fetch specific bot by ID', async () => {
      const result = await getBotById('bot-1')
      
      expect(result).toEqual(mockBots[0])
      expect(result?.name).toBe('SPY Trend Bot')
      expect(result?.enabled).toBe(true)
    })

    it('should return null for non-existent bot', async () => {
      await expect(getBotById('non-existent')).rejects.toThrow()
    })
  })

  describe('Bot Updates', () => {
    it('should update bot status', async () => {
      const updateData = { enabled: false }
      const result = await updateBot('bot-1', updateData)
      
      expect(result?.enabled).toBe(false)
      expect(result?.name).toBe('SPY Trend Bot')
      expect(result?.updatedAt).toBeDefined()
    })

    it('should update bot configuration', async () => {
      const updateData = {
        config: {
          tickers: ['AAPL', 'MSFT'],
          quantity: 25,
          direction: 'sell'
        }
      }
      const result = await updateBot('bot-1', updateData)
      
      expect(result?.config).toEqual(updateData.config)
      expect(result?.config?.tickers).toEqual(['AAPL', 'MSFT'])
    })

    it('should handle update for non-existent bot', async () => {
      const updateData = { enabled: false }
      
      await expect(updateBot('non-existent', updateData)).rejects.toThrow()
    })
  })

  describe('Bot Deletion', () => {
    it('should soft delete bot successfully', async () => {
      const result = await deleteBot('bot-1')
      
      expect(result?.success).toBe(true)
      expect(result?.deletedBot?.name).toBe('SPY Trend Bot')
    })

    it('should handle deletion for non-existent bot', async () => {
      await expect(deleteBot('non-existent')).rejects.toThrow()
    })
  })

  describe('Bot Creation', () => {
    it('should create bot from template', async () => {
      const botData = {
        templateId: 'trend-template',
        portfolioId: 'prt_stub_demo',
        name: 'New Trend Bot',
        botConfig: {
          tickers: ['SPY'],
          quantity: 50,
          direction: 'buy'
        }
      }
      
      const result = await createBotFromTemplate(botData.templateId, botData)
      
      expect(result?.name).toBe('New Trend Bot')
      expect(result?.templateId).toBe('trend-template')
      expect(result?.enabled).toBe(true)
      expect(result?.config).toEqual(botData.botConfig)
    })

    it('should create strategy-based bot', async () => {
      const botData = {
        strategyId: 'strategy-1',
        portfolioId: 'prt_stub_demo',
        name: 'New Strategy Bot',
        botConfig: {
          tickers: ['AAPL'],
          quantity: 25,
          direction: 'sell'
        }
      }
      
      const result = await createStrategyBot(botData.strategyId, botData)
      
      expect(result?.name).toBe('New Strategy Bot')
      expect(result?.strategyId).toBe('strategy-1')
      expect(result?.botType).toBe('strategy_based')
      expect(result?.enabled).toBe(true)
      expect(result?.config).toEqual(botData.botConfig)
    })
  })

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      // Override the handler to simulate network error
      server.use(
        http.get('*/api/bots', () => {
          return HttpResponse.error()
        })
      )
      
      await expect(getBots()).rejects.toThrow()
    })

    it('should handle server errors gracefully', async () => {
      server.use(
        http.get('*/api/bots', () => {
          return HttpResponse.json({ error: 'Internal server error' }, { status: 500 })
        })
      )
      
      await expect(getBots()).rejects.toThrow()
    })

    it('should handle malformed responses', async () => {
      server.use(
        http.get('*/api/bots', () => {
          return new HttpResponse('Invalid JSON response', {
            headers: { 'Content-Type': 'application/json' }
          })
        })
      )
      
      await expect(getBots()).rejects.toThrow()
    })
  })

  describe('Data Validation', () => {
    it('should validate bot configuration structure', async () => {
      const invalidBotData = {
        templateId: 'trend-template',
        portfolioId: 'prt_stub_demo',
        name: 'Invalid Bot',
        botConfig: {
          // Missing required fields
          tickers: []
        }
      }
      
      // This should still work as validation happens on the server side
      const result = await createBotFromTemplate(invalidBotData.templateId, invalidBotData)
      expect(result?.name).toBe('Invalid Bot')
    })

    it('should handle large bot datasets', async () => {
      // Mock large dataset
      const largeBots = Array.from({ length: 100 }, (_, i) => ({
        id: `bot-${i}`,
        name: `Bot ${i}`,
        botType: 'rule_based',
        enabled: i % 2 === 0,
        config: {
          tickers: ['SPY'],
          quantity: 10,
          direction: 'buy'
        },
        portfolioId: 'prt_stub_demo',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null
      }))
      
      server.use(
        http.get('*/api/bots', () => {
          return HttpResponse.json(largeBots)
        })
      )
      
      const result = await getBots()
      expect(result).toHaveLength(100)
      expect(result[99].name).toBe('Bot 99')
    })
  })

  describe('Concurrent Operations', () => {
    it('should handle multiple concurrent requests', async () => {
      const promises = [
        getBots(),
        getBotById('bot-1'),
        getBotById('bot-2'),
        updateBot('bot-1', { enabled: false })
      ]
      
      const results = await Promise.all(promises)
      
      expect(results[0]).toEqual(mockBots)
      expect(results[1]).toEqual(mockBots[0])
      expect(results[2]).toEqual(mockBots[1])
      expect(results[3]?.enabled).toBe(false)
    })
  })
})
