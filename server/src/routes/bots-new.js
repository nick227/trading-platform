import fastify from 'fastify'
import botsService from '../services/botsService-new.js'
import rulesService from '../services/rulesService.js'
import eventsService from '../services/eventsService.js'
import { validateEventMetadata } from '../utils/validation.js'

export default async function botsRoutes(app) {
  // GET /api/bots - List bots with filtering
  app.get('/bots', async (request, reply) => {
    try {
      const { 
        enabled, 
        portfolioId, 
        type, 
        status,
        limit = 25, 
        offset = 0 
      } = request.query

      const filters = {}
      if (enabled !== undefined) filters.enabled = enabled === 'true'
      if (portfolioId) filters.portfolioId = portfolioId
      if (type) filters.type = type
      if (status) filters.status = status

      const result = await botsService.getBots({
        ...filters,
        limit: parseInt(limit),
        offset: parseInt(offset)
      })

      return reply.send(result)
    } catch (error) {
      request.log.error('Failed to get bots:', error)
      return reply.status(500).send({ error: 'Failed to get bots' })
    }
  })

  // GET /api/bots/:id - Get specific bot
  app.get('/bots/:id', async (request, reply) => {
    try {
      const { id } = request.params
      const bot = await botsService.getBot(id)
      
      if (!bot) {
        return reply.status(404).send({ error: 'Bot not found' })
      }

      return reply.send(bot)
    } catch (error) {
      request.log.error('Failed to get bot:', error)
      return reply.status(500).send({ error: 'Failed to get bot' })
    }
  })

  // POST /api/bots/from-template - Create bot from template
  app.post('/bots/from-template', async (request, reply) => {
    try {
      const data = request.body
      
      // Validate required fields
      if (!data.templateId || !data.portfolioId || !data.name) {
        return reply.status(400).send({ 
          error: 'templateId, portfolioId, and name are required' 
        })
      }

      if (!data.config || !data.config.tickers || !data.config.tickers.length) {
        return reply.status(400).send({ 
          error: 'config.tickers is required and must be non-empty' 
        })
      }

      if (data.config.quantity < 1) {
        return reply.status(400).send({ 
          error: 'config.quantity must be at least 1' 
        })
      }

      const bot = await botsService.createBotFromTemplate(data)
      return reply.status(201).send(bot)
    } catch (error) {
      request.log.error('Failed to create bot from template:', error)
      return reply.status(500).send({ error: 'Failed to create bot' })
    }
  })

  // POST /api/bots - Direct bot creation (advanced)
  app.post('/bots', async (request, reply) => {
    try {
      const data = request.body
      
      // Validate required fields
      if (!data.type || !data.portfolioId || !data.name) {
        return reply.status(400).send({ 
          error: 'type, portfolioId, and name are required' 
        })
      }

      if (data.type === 'RULE_BASED' && !data.templateId) {
        return reply.status(400).send({ 
          error: 'RULE_BASED bots require templateId' 
        })
      }

      if (data.type === 'STRATEGY_BASED' && !data.strategyId) {
        return reply.status(400).send({ 
          error: 'STRATEGY_BASED bots require strategyId' 
        })
      }

      if (!data.config || !data.config.tickers || !data.config.tickers.length) {
        return reply.status(400).send({ 
          error: 'config.tickers is required and must be non-empty' 
        })
      }

      if (data.config.quantity < 1) {
        return reply.status(400).send({ 
          error: 'config.quantity must be at least 1' 
        })
      }

      if (data.type === 'STRATEGY_BASED' && 
          (data.config.minConfidence < 0 || data.config.minConfidence > 1)) {
        return reply.status(400).send({ 
          error: 'config.minConfidence must be between 0 and 1' 
        })
      }

      const bot = await botsService.createBot(data)
      return reply.status(201).send(bot)
    } catch (error) {
      request.log.error('Failed to create bot:', error)
      return reply.status(500).send({ error: 'Failed to create bot' })
    }
  })

  // PATCH /api/bots/:id - Update bot (enable/disable, config, status)
  app.patch('/bots/:id', async (request, reply) => {
    try {
      const { id } = request.params
      const data = request.body
      
      // Validate bot exists
      const existingBot = await botsService.getBot(id)
      if (!existingBot) {
        return reply.status(404).send({ error: 'Bot not found' })
      }

      // Validate status transitions
      if (data.status) {
        const validTransitions = {
          'draft': ['running', 'offline'],
          'running': ['paused', 'offline', 'error'],
          'paused': ['running', 'offline'],
          'error': ['draft', 'running', 'offline'],
          'offline': ['draft', 'running']
        }
        
        if (!validTransitions[existingBot.status]?.includes(data.status)) {
          return reply.status(400).send({ 
            error: `Invalid status transition from ${existingBot.status} to ${data.status}` 
          })
        }
      }

      const bot = await botsService.updateBot(id, data)
      return reply.send(bot)
    } catch (error) {
      request.log.error('Failed to update bot:', error)
      return reply.status(500).send({ error: 'Failed to update bot' })
    }
  })

  // DELETE /api/bots/:id - Soft delete bot
  app.delete('/bots/:id', async (request, reply) => {
    try {
      const { id } = request.params
      
      // Validate bot exists
      const existingBot = await botsService.getBot(id)
      if (!existingBot) {
        return reply.status(404).send({ error: 'Bot not found' })
      }

      const bot = await botsService.deleteBot(id)
      return reply.send({ success: true })
    } catch (error) {
      request.log.error('Failed to delete bot:', error)
      return reply.status(500).send({ error: 'Failed to delete bot' })
    }
  })

  // GET /api/bots/catalog - Get bot templates
  app.get('/bots/catalog', async (request, reply) => {
    try {
      const catalog = await botsService.getBotCatalog()
      return reply.send(catalog)
    } catch (error) {
      request.log.error('Failed to get bot catalog:', error)
      return reply.status(500).send({ error: 'Failed to get bot catalog' })
    }
  })

  // GET /api/bots/:id/events - Get bot events with filtering
  app.get('/bots/:id/events', async (request, reply) => {
    try {
      const { id } = request.params
      const { 
        type, 
        limit = 50, 
        after 
      } = request.query

      const filters = {}
      if (type) filters.type = type
      if (after) filters.after = after

      const events = await eventsService.getBotEvents(id, {
        ...filters,
        limit: parseInt(limit)
      })

      return reply.send(events)
    } catch (error) {
      request.log.error('Failed to get bot events:', error)
      return reply.status(500).send({ error: 'Failed to get bot events' })
    }
  })

  // GET /api/bots/:id/rules - Get bot rules
  app.get('/bots/:id/rules', async (request, reply) => {
    try {
      const { id } = request.params
      const rules = await rulesService.getBotRules(id)
      return reply.send(rules)
    } catch (error) {
      request.log.error('Failed to get bot rules:', error)
      return reply.status(500).send({ error: 'Failed to get bot rules' })
    }
  })

  // POST /api/bots/:id/rules - Create single rule
  app.post('/bots/:id/rules', async (request, reply) => {
    try {
      const { id } = request.params
      const data = request.body
      
      // Validate required fields
      if (!data.type || !data.order) {
        return reply.status(400).send({ 
          error: 'type and order are required' 
        })
      }

      const rule = await rulesService.createRule(id, data)
      return reply.status(201).send(rule)
    } catch (error) {
      request.log.error('Failed to create rule:', error)
      return reply.status(500).send({ error: 'Failed to create rule' })
    }
  })

  // PUT /api/bots/:id/rules - Bulk replace rules (drag/drop UI)
  app.put('/bots/:id/rules', async (request, reply) => {
    try {
      const { id } = request.params
      const rules = request.body
      
      if (!Array.isArray(rules)) {
        return reply.status(400).send({ 
          error: 'Rules must be an array' 
        })
      }

      // Validate each rule
      for (const rule of rules) {
        if (!rule.type || rule.order === undefined) {
          return reply.status(400).send({ 
            error: 'Each rule must have type and order' 
          })
        }
      }

      const createdRules = await rulesService.replaceBotRules(id, rules)
      return reply.send({ 
        success: true, 
        count: createdRules.length 
      })
    } catch (error) {
      request.log.error('Failed to replace bot rules:', error)
      return reply.status(500).send({ error: 'Failed to replace bot rules' })
    }
  })

  // PATCH /api/bots/:id/rules/:ruleId - Update single rule
  app.patch('/bots/:id/rules/:ruleId', async (request, reply) => {
    try {
      const { id, ruleId } = request.params
      const data = request.body
      
      const rule = await rulesService.updateRule(ruleId, data)
      return reply.send(rule)
    } catch (error) {
      request.log.error('Failed to update rule:', error)
      return reply.status(500).send({ error: 'Failed to update rule' })
    }
  })

  // DELETE /api/bots/:id/rules/:ruleId - Delete rule
  app.delete('/bots/:id/rules/:ruleId', async (request, reply) => {
    try {
      const { ruleId } = request.params
      
      await rulesService.deleteRule(ruleId)
      return reply.send({ success: true })
    } catch (error) {
      request.log.error('Failed to delete rule:', error)
      return reply.status(500).send({ error: 'Failed to delete rule' })
    }
  })
}
