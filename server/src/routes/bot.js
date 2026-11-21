import botService from '../services/botService.js'
import { engineClient } from '../clients/engine.js'
import { authenticate } from '../middleware/authenticate.js'

export default async function operatorBotRoutes(app, opts) {
  // Enforce authentication on all bot operations
  app.addHook('preHandler', authenticate)

  // GET /api/bot/status
  app.get('/status', async (request, reply) => {
    try {
      const status = await botService.getBotStatus(request.user.id)
      return reply.send({ status })
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })

  // GET /api/bot/current-signal — top actionable recommendation (never raw rankings)
  app.get('/current-signal', async (request, reply) => {
    try {
      let recsPayload
      try {
        recsPayload = await engineClient.getRecommendationsLatest(1)
      } catch (err) {
        return reply.send({ signal: null, degraded: true, reason: 'ENGINE_UNAVAILABLE' })
      }

      const isDegraded = recsPayload?.intelligenceConfidenceTier === 'degraded' ||
        recsPayload?.pipelineSignals?.rankingsSuppressed === true

      if (isDegraded) {
        return reply.send({
          signal: null,
          degraded: true,
          reason: 'INTELLIGENCE_DEGRADED',
          diagnostics: recsPayload?.pipelineSignals?.suppressionReasons ?? []
        })
      }

      const top = recsPayload?.recommendations?.[0]
      if (!top) {
        return reply.send({ signal: null, reason: 'NO_RECOMMENDATIONS' })
      }

      const rawAction = String(top.action ?? '').toUpperCase().trim()
      if (rawAction !== 'BUY' && rawAction !== 'SELL') {
        return reply.send({ signal: null, reason: 'INVALID_TRADING_DIRECTION' })
      }

      const direction = rawAction === 'BUY' ? 'buy' : 'sell'
      const targetPrice = Number(top.entryZone?.[0] ?? top.price ?? 0)

      return reply.send({
        signal: {
          symbol:     top.ticker,
          direction,
          confidence: Number(top.confidence) || 0,
          score:      Number(top.score) || 0,
          reasoning:  Array.isArray(top.thesis) ? top.thesis.join('. ') : (top.reasoning ?? 'Alpha Engine house recommendation'),
          target:     targetPrice,
          source:     'house_recommendation'
        }
      })
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })

  // POST /api/bot/start
  app.post('/start', async (request, reply) => {
    try {
      const { portfolioId, runIntervalMinutes } = request.body ?? {}
      const botRun = await botService.startBot({
        userId: request.user.id,
        portfolioId,
        runIntervalMinutes
      })
      return reply.code(201).send({ botRun })
    } catch (error) {
      const status = error.code === 'BROKER_NOT_CONFIGURED' ? 403 : error.code === 'INVALID_PORTFOLIO' ? 400 : 500
      return reply.code(status).send({ error: error.message, code: error.code })
    }
  })

  // POST /api/bot/stop
  app.post('/stop', async (request, reply) => {
    try {
      const result = await botService.stopBot({ userId: request.user.id })
      return reply.send({ success: true, ...result })
    } catch (error) {
      const status = error.code === 'UNAUTHORIZED' ? 403 : 500
      return reply.code(status).send({ error: error.message })
    }
  })

  // POST /api/bot/run-once — execute one trade based on current actionable recommendation
  app.post('/run-once', async (request, reply) => {
    try {
      const { portfolioId, minConfidence } = request.body ?? {}
      const result = await botService.executeNextSignal({
        userId: request.user.id,
        portfolioId,
        minConfidence
      })

      if (!result.executed) {
        return reply.code(400).send({
          error: 'No qualifying signal available',
          reason: result.rejectedReason,
          diagnostics: result.diagnostics
        })
      }

      return reply.send({ execution: result.execution, signal: result.signal })
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })

  // GET /api/bot/runs
  app.get('/runs', async (request, reply) => {
    try {
      const limit = Math.max(1, Math.min(100, Number(request.query?.limit) || 20))
      const runs = await botService.getBotRuns({ userId: request.user.id, limit })
      return reply.send(runs)
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })
}
