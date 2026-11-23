import prisma from './prisma.js'
import { log } from '../logger.js'

/**
 * Deploy-order safety: the API's pre-deploy step applies schema changes, but Railway can start
 * the worker first. Probe every model the worker reads (the generated client selects every
 * column) and wait — instead of crashing — until the database matches this build's schema.
 */
export async function waitForSchema({ client = prisma, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = 10 * 60_000, intervalMs = 5_000, now = Date.now } = {}) {
  const started = now()
  for (;;) {
    try {
      for (const model of ['execution', 'bot', 'botRule', 'botEvent', 'portfolio']) await client[model].findFirst({})
      return true
    } catch (err) {
      const schemaMismatch = err?.code === 'P2022' || err?.code === 'P2021'
      if (!schemaMismatch) throw err
      if (now() - started > timeoutMs) throw err
      log.warn({ code: err.code, err: String(err.message).split('\n').filter(Boolean).pop() }, 'waiting_for_schema')
      await sleep(intervalMs)
    }
  }
}
