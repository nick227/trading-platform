import { describe, it, expect, vi, beforeEach } from 'vitest'
import { 
  getBotCatalog, 
  getBots, 
  getBotById, 
  updateBot, 
  deleteBot, 
  getBotEvents, 
  getBotRules,
  createBotFromTemplate,
  createStrategyBot 
} from '../../api/services/botCatalogService'
import { mockBots, mockTemplates, mockBotEvents, mockBotRules } from '../fixtures/botFixtures'

// Mock the API client
const mockGet = vi.fn()
const mockPost = vi.fn()
const mockPut = vi.fn()
const mockDel = vi.fn()

vi.mock('../../api/client', () => ({
  get: mockGet,
  post: mockPost,
  put: mockPut,
  del: mockDel
}))

describe('Bot Catalog Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getBotCatalog', () => {
    it('should fetch bot catalog successfully', async () => {
      const expectedCatalog = { ruleBased: mockTemplates, strategyBased: [] }
      mockGet.mockResolvedValue(expectedCatalog)

      const result = await getBotCatalog()

      expect(mockGet).toHaveBeenCalledWith('/bots/catalog')
      expect(result).toEqual(expectedCatalog)
    })

    it('should handle API errors gracefully', async () => {
      mockGet.mockRejectedValue(new Error('Network error'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = await getBotCatalog()

      expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch bot catalog:', expect.any(Error))
      expect(result).toEqual({ ruleBased: [], strategyBased: [] })

      consoleSpy.mockRestore()
    })
  })

  describe('getBots', () => {
    it('should fetch all bots successfully', async () => {
      mockGet.mockResolvedValue(mockBots)

      const result = await getBots()

      expect(mockGet).toHaveBeenCalledWith('/api/bots')
      expect(result).toEqual(mockBots)
    })

    it('should throw error on API failure', async () => {
      const error = new Error('API Error')
      mockGet.mockRejectedValue(error)

      await expect(getBots()).rejects.toThrow('API Error')
      expect(mockGet).toHaveBeenCalledWith('/api/bots')
    })
  })

  describe('getBotById', () => {
    it('should fetch specific bot by ID', async () => {
      const botId = 'bot-1'
      const expectedBot = mockBots[0]
      mockGet.mockResolvedValue(expectedBot)

      const result = await getBotById(botId)

      expect(mockGet).toHaveBeenCalledWith(`/api/bots/${botId}`)
      expect(result).toEqual(expectedBot)
    })

    it('should throw error when bot not found', async () => {
      const botId = 'non-existent'
      mockGet.mockRejectedValue(new Error('Bot not found'))

      await expect(getBotById(botId)).rejects.toThrow('Bot not found')
      expect(mockGet).toHaveBeenCalledWith(`/api/bots/${botId}`)
    })
  })

  describe('updateBot', () => {
    it('should update bot successfully', async () => {
      const botId = 'bot-1'
      const updateData = { enabled: false, config: { tickers: ['AAPL'] } }
      const updatedBot = { ...mockBots[0], ...updateData }
      mockPut.mockResolvedValue(updatedBot)

      const result = await updateBot(botId, updateData)

      expect(mockPut).toHaveBeenCalledWith(`/api/bots/${botId}`, updateData)
      expect(result).toEqual(updatedBot)
    })

    it('should throw error on update failure', async () => {
      const botId = 'bot-1'
      const updateData = { enabled: false }
      mockPut.mockRejectedValue(new Error('Update failed'))

      await expect(updateBot(botId, updateData)).rejects.toThrow('Update failed')
      expect(mockPut).toHaveBeenCalledWith(`/api/bots/${botId}`, updateData)
    })
  })

  describe('deleteBot', () => {
    it('should delete bot successfully', async () => {
      const botId = 'bot-1'
      mockDel.mockResolvedValue({ success: true })

      const result = await deleteBot(botId)

      expect(mockDel).toHaveBeenCalledWith(`/api/bots/${botId}`)
      expect(result).toEqual({ success: true })
    })

    it('should throw error on delete failure', async () => {
      const botId = 'bot-1'
      mockDel.mockRejectedValue(new Error('Delete failed'))

      await expect(deleteBot(botId)).rejects.toThrow('Delete failed')
      expect(mockDel).toHaveBeenCalledWith(`/api/bots/${botId}`)
    })
  })

  describe('getBotEvents', () => {
    it('should fetch bot events successfully', async () => {
      const botId = 'bot-1'
      mockGet.mockResolvedValue(mockBotEvents)

      const result = await getBotEvents(botId)

      expect(mockGet).toHaveBeenCalledWith(`/api/bots/${botId}/events`)
      expect(result).toEqual(mockBotEvents)
    })

    it('should return empty array on error', async () => {
      const botId = 'bot-1'
      mockGet.mockRejectedValue(new Error('Events not found'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = await getBotEvents(botId)

      expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch bot events:', expect.any(Error))
      expect(result).toEqual([])

      consoleSpy.mockRestore()
    })
  })

  describe('getBotRules', () => {
    it('should fetch bot rules successfully', async () => {
      const botId = 'bot-1'
      mockGet.mockResolvedValue(mockBotRules)

      const result = await getBotRules(botId)

      expect(mockGet).toHaveBeenCalledWith(`/api/bots/${botId}/rules`)
      expect(result).toEqual(mockBotRules)
    })

    it('should return empty array on error', async () => {
      const botId = 'bot-1'
      mockGet.mockRejectedValue(new Error('Rules not found'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = await getBotRules(botId)

      expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch bot rules:', expect.any(Error))
      expect(result).toEqual([])

      consoleSpy.mockRestore()
    })
  })

  describe('createBotFromTemplate', () => {
    it('should create bot from template successfully', async () => {
      const templateId = 'trend-template'
      const config = {
        portfolioId: 'prt_stub_demo',
        name: 'Test Bot',
        botConfig: { tickers: ['SPY'], quantity: 100, direction: 'buy' }
      }
      const createdBot = mockBots[0]
      mockPost.mockResolvedValue(createdBot)

      const result = await createBotFromTemplate(templateId, config)

      expect(mockPost).toHaveBeenCalledWith('/api/bots/catalog/from-template', {
        templateId,
        portfolioId: config.portfolioId,
        name: config.name,
        config: config.botConfig
      })
      expect(result).toEqual(createdBot)
    })

    it('should throw error on creation failure', async () => {
      const templateId = 'trend-template'
      const config = { portfolioId: 'prt_stub_demo', name: 'Test Bot', botConfig: {} }
      mockPost.mockRejectedValue(new Error('Creation failed'))

      await expect(createBotFromTemplate(templateId, config)).rejects.toThrow('Creation failed')
    })
  })

  describe('createStrategyBot', () => {
    it('should create strategy bot successfully', async () => {
      const strategyId = 'strategy-1'
      const config = {
        portfolioId: 'prt_stub_demo',
        name: 'Strategy Bot',
        botConfig: { tickers: ['AAPL'], quantity: 50, direction: 'buy' }
      }
      const createdBot = mockBots[1]
      mockPost.mockResolvedValue(createdBot)

      const result = await createStrategyBot(strategyId, config)

      expect(mockPost).toHaveBeenCalledWith('/api/bots/strategy-based', {
        strategyId,
        portfolioId: config.portfolioId,
        name: config.name,
        config: config.botConfig
      })
      expect(result).toEqual(createdBot)
    })

    it('should throw error on strategy bot creation failure', async () => {
      const strategyId = 'strategy-1'
      const config = { portfolioId: 'prt_stub_demo', name: 'Strategy Bot', botConfig: {} }
      mockPost.mockRejectedValue(new Error('Strategy creation failed'))

      await expect(createStrategyBot(strategyId, config)).rejects.toThrow('Strategy creation failed')
    })
  })
})
