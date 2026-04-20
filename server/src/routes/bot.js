import botService from '../services/botService.js'
import alphaEngineService from '../services/alphaEngineService.js'

export default async function operatorBotRoutes(app, opts) {
  // GET /api/bot/status
  app.get('/status', async (request, reply) => {
    try {
      return reply.send({ status: await botService.getBotStatus() })
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })

  // GET /api/bot/current-signal — top Alpha Engine signal
  app.get('/current-signal', async (request, reply) => {
    try {
      const rankings = await alphaEngineService.getRankings({ limit: 1 })
      const top = rankings[0]
      if (!top) return reply.send({ signal: null })

      const explainability = await alphaEngineService.getExplainability(top.symbol)

      return reply.send({
        signal: {
          symbol:     top.symbol,
          direction:  top.direction ?? 'buy',
          confidence: top.confidence ?? 0,
          score:      top.score ?? 0,
          reasoning:  explainability?.reasoning ?? explainability?.reasons?.join('. ') ?? 'No reasoning available',
          target:     explainability?.target ?? top.price ?? 0
        }
      })
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })

  // POST /api/bot/start
  app.post('/start', async (request, reply) => {
    try {
      const botRun = await botService.startBot()
      return reply.code(201).send({ botRun })
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })

  // POST /api/bot/stop
  app.post('/stop', async (request, reply) => {
    try {
      const result = await botService.stopBot()
      return reply.send({ success: true, ...result })
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })

  // POST /api/bot/run-once — execute one trade based on current signal
  app.post('/run-once', async (request, reply) => {
    try {
      const execution = await botService.executeNextSignal()
      if (!execution) {
        return reply.code(400).send({ error: 'No qualifying signal available' })
      }
      return reply.send({ execution })
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })

  // GET /api/bot/runs
  app.get('/runs', async (request, reply) => {
    try {
      return reply.send(await botService.getBotRuns({ limit: 20 }))
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })
}
