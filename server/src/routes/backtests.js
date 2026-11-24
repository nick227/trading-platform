import { BacktestError, createBacktest, getBacktest, listBacktests, publicRun } from '../services/backtestService.js'
import { EXECUTION_MODELS } from '../../../worker/src/backtest/historicalRunner.js'

/** /api/backtests — hypothetical historical runs (authenticated; owner-only). */
export default async function backtestRoutes(app) {
  const fail = (reply, err) => {
    if (err instanceof BacktestError) return reply.code(err.status).send({ error: { code: err.code, message: err.message, ...err.details } })
    throw err
  }

  // POST /api/backtests { botId } | { config, rules }, symbols?, range? (1Y|3Y|5Y) | start/end, executionModel?
  app.post('/', async (request, reply) => {
    try {
      const run = await createBacktest(request.user.id, request.body ?? {})
      return reply.code(202).send({ data: publicRun(run) })
    } catch (err) { return fail(reply, err) }
  })

  app.get('/', async (request) => {
    return { data: await listBacktests(request.user.id, { botId: request.query?.botId ?? null, limit: Number(request.query?.limit) || 10 }) }
  })

  app.get('/models', async () => ({ data: EXECUTION_MODELS }))

  app.get('/:id', async (request, reply) => {
    const run = await getBacktest(request.params.id, request.user.id)
    if (!run) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Backtest not found' } })
    return { data: publicRun(run) }
  })
}
