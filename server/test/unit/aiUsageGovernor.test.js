import { describe, expect, it, vi } from 'vitest'
import { createAiUsageGovernor } from '../../src/services/ai/aiUsageGovernor.js'

const env = {
  ENABLE_FLAGSHIP_STOCK_TRADER: 'true',
  ENABLE_AI_PAID_CALLS: 'true',
  AI_STOCK_TRADER_MONTHLY_BUDGET_CENTS: '100',
  AI_STOCK_TRADER_BOT_BUDGET_CENTS: '25',
  AI_STOCK_TRADER_RESERVE_CENTS_PER_CALL: '5'
}

function makeDb({ permitted = true } = {}) {
  const calls = []
  const buckets = []
  const tx = {
    aiUsageCall: {
      create: vi.fn(async ({ data }) => { calls.push(data); return data }),
      updateMany: vi.fn(async () => ({ count: 1 }))
    },
    aiUsageBucket: {
      upsert: vi.fn(async () => ({})),
      update: vi.fn(async ({ where, data }) => { buckets.push({ where, data }) })
    },
    $executeRaw: vi.fn(async () => permitted ? 1 : 0)
  }
  return { tx, calls, buckets, $transaction: async fn => fn(tx) }
}

describe('flagship AI usage governor', () => {
  it('requires two explicit enable flags and positive budgets', async () => {
    const governor = createAiUsageGovernor({ prismaClient: makeDb(), env: { ...env, ENABLE_AI_PAID_CALLS: 'false' } })
    await expect(governor.reserve({ botId: 'bot-x', jobKey: 'job-x', model: 'gpt-4o-mini' })).rejects.toThrow(/not enabled/)
  })

  it('atomically reserves both platform and bot scope and settles actual usage', async () => {
    const db = makeDb()
    const governor = createAiUsageGovernor({ prismaClient: db, env, now: () => new Date('2026-11-26T12:00:00Z') })
    const res = await governor.reserve({ botId: 'bot-x', jobKey: 'job-x', model: 'gpt-4o-mini' })
    expect(db.tx.$executeRaw).toHaveBeenCalledTimes(2)
    expect(db.calls[0].period).toBe('2026-11')
    const settled = await governor.settle(res, { usage: { prompt_tokens: 150, completion_tokens: 50 } })
    expect(settled.settled).toBe(true)
    expect(settled.actualCents).toBe(1)
    expect(db.buckets).toHaveLength(2)
    expect(db.buckets[0].data.reservedCents.decrement).toBe(5)
  })

  it('rejects when either atomic budget update cannot reserve', async () => {
    const db = makeDb({ permitted: false })
    const governor = createAiUsageGovernor({ prismaClient: db, env })
    await expect(governor.reserve({ botId: 'bot-x', jobKey: 'too-expensive', model: 'gpt-4o-mini' })).rejects.toThrow(/exhausted/)
  })

  it('charges full reservation when provider outcome is uncertain', async () => {
    const db = makeDb()
    const governor = createAiUsageGovernor({ prismaClient: db, env })
    const res = await governor.reserve({ botId: 'bot-x', jobKey: 'uncertain', model: 'gpt-4o-mini' })
    const settled = await governor.settle(res, { uncertain: true })
    expect(settled.status).toBe('uncertain')
    expect(settled.actualCents).toBe(res.reservedCents)
  })
})
