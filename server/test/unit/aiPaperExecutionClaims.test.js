import { describe, expect, it, vi } from 'vitest'
import {
  claimQueuedAiPaperExecution,
  completeClaimedAiPaperExecution,
  quarantineClaimedAiPaperExecution
} from '../../src/services/ai/paperExecutionClaims.js'
import { processPendingAiExecutions } from '../../src/services/ai/aiBotService.js'
import { SimulatedBroker } from '../../../worker/src/broker/simulatedBroker.js'

const session = '2026-11-27'
const execution = () => ({
  id: 'paper-exec-1', userId: 'paper-user', botId: 'paper-bot', portfolioId: 'paper-portfolio',
  clientOrderId: 'paper-client-1', ticker: 'AAPL', direction: 'buy',
  quantity: 2, price: 100, status: 'queued', attempts: 0,
  simSession: session, sourceType: 'AI_FORWARD'
})

function mockDb() {
  let row = execution()
  const audits = [{ eventType: 'execution_created', executionId: row.id, metadata: { entryType: 'next_open' } }]
  const db = {
    execution: {
      findMany: vi.fn(async ({ where }) => {
        if (where.status === 'queued') return row.status === 'queued' ? [{ ...row }] : []
        return []
      }),
      findFirst: vi.fn(async () => ({ ...row })),
      updateMany: vi.fn(async ({ where, data }) => {
        if (where.id !== row.id || (where.status && where.status !== row.status) ||
          (where.lockedBy && where.lockedBy !== row.lockedBy)) return { count: 0 }
        const increment = data.attempts?.increment || 0
        row = { ...row, ...data, attempts: row.attempts + increment }
        return { count: 1 }
      })
    },
    executionAudit: {
      findFirst: vi.fn(async () => audits[0]),
      create: vi.fn(async ({ data }) => { audits.push(data); return data })
    },
    bot: { findUnique: vi.fn(async () => null) }
  }
  db.$transaction = async fn => fn(db)
  return { db, getRow: () => row, audits }
}

const engine = open => ({
  getSessionClose: vi.fn(async () => ({
    session, open, close: 110, source: 'fixture'
  }))
})

describe('MR 9 paper execution integrity', () => {
  it('atomically grants only one owner and fences later workers', async () => {
    const { db, getRow } = mockDb()
    const [a, b, c] = await Promise.all(['A', 'B', 'C'].map(workerToken =>
      claimQueuedAiPaperExecution({ prismaClient: db, executionId: 'paper-exec-1', workerToken })
    ))
    expect([a, b, c].filter(Boolean)).toHaveLength(1)
    expect(getRow().status).toBe('processing')
    expect(getRow().attempts).toBe(1)
    expect(await quarantineClaimedAiPaperExecution({
      prismaClient: db, executionId: 'paper-exec-1', workerToken: 'other'
    })).toBe(false)
  })

  it('rejects a next-open fill if the precise opening price is missing', async () => {
    const { db, getRow } = mockDb()
    const result = await processPendingAiExecutions('paper-bot', {
      currentSession: session, prismaClient: db, engine: engine(null)
    })
    expect(result.filledExecutions).toHaveLength(0)
    expect(result.failedExecutions[0].error).toBe('required_session_price_unavailable')
    expect(getRow().status).toBe('queued')
  })

  it('under parallel processors creates one simulated fill and one audit', async () => {
    const { db, getRow, audits } = mockDb()
    const args = { currentSession: session, prismaClient: db, engine: engine(105) }
    const [first, second] = await Promise.all([
      processPendingAiExecutions('paper-bot', args),
      processPendingAiExecutions('paper-bot', args)
    ])
    expect(first.filledExecutions.length + second.filledExecutions.length).toBe(1)
    expect(getRow().status).toBe('filled')
    expect(getRow().filledPrice).toBe(105)
    expect(getRow().attempts).toBe(1)
    expect(audits.filter(a => a.eventType === 'filled')).toHaveLength(1)
  })

  it('quarantines an aborted audit transaction rather than requeueing the order', async () => {
    const { db, getRow } = mockDb()
    db.$transaction = async () => { throw new Error('db commit uncertain') }
    const result = await processPendingAiExecutions('paper-bot', {
      currentSession: session, prismaClient: db, engine: engine(105)
    })
    expect(result.failedExecutions[0].needsReconciliation).toBe(true)
    expect(getRow().status).toBe('needs_reconciliation')
  })

  it('simulator never replaces requested opening prices with closing prices', async () => {
    const { db } = mockDb()
    const simulated = new SimulatedBroker('paper-user', {
      config: { enabled: true, mode: 'paper_daily', executionModel: 'next_open' },
      prismaClient: db,
      sessionClose: async () => ({ session, close: 110 }),
      resolveSession: async () => session
    })
    await expect(simulated.submitOrder({
      ticker: 'AAPL', side: 'buy', qty: 2, clientOrderId: 'paper-client-1'
    })).rejects.toThrow()
  })

  it('requires a matching claim before completing the fill and audit', async () => {
    const { db, getRow } = mockDb()
    await claimQueuedAiPaperExecution({ prismaClient: db, executionId: 'paper-exec-1', workerToken: 'A' })
    await expect(completeClaimedAiPaperExecution({
      prismaClient: db, execution: execution(), workerToken: 'B',
      fill: { auditId: 'a', brokerOrderId: 'paper-broker', price: 102, quantity: 2, pnl: 0, session, priceModel: 'next_open', filledAt: new Date() }
    })).rejects.toThrow(/ownership lost/)
    expect(getRow().status).toBe('processing')
  })
})
