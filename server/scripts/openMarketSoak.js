import 'dotenv/config'

const BASE_URL = process.env.SOAK_BASE_URL ?? 'http://127.0.0.1:3001'
const USER_ID = process.env.SOAK_USER_ID ?? 'usr_stub_demo'
const TICKER = process.env.SOAK_TICKER ?? 'AAPL'
const DIRECTION = process.env.SOAK_DIRECTION ?? 'buy'
const QUANTITY = Number(process.env.SOAK_QUANTITY ?? 1)
const PRICE = Number(process.env.SOAK_PRICE ?? 180)
const DURATION_MS = Number(process.env.SOAK_DURATION_MS ?? 10 * 60 * 1000)
const SAMPLE_INTERVAL_MS = Number(process.env.SOAK_SAMPLE_INTERVAL_MS ?? 10_000)

async function main() {
  const startedAt = new Date()
  const portfolio = await api('/api/portfolios', {
    method: 'POST',
    body: { name: `Open Market Soak ${startedAt.toISOString()}`, userId: USER_ID }
  })
  const strategy = await api('/api/strategies', {
    method: 'POST',
    body: {
      name: `Open Market Soak ${startedAt.toISOString()}`,
      description: 'Automated soak strategy',
      type: 'ops_soak'
    }
  })
  const execution = await api('/api/executions', {
    method: 'POST',
    body: {
      userId: USER_ID,
      portfolioId: portfolio.data.id,
      strategyId: strategy.data.id,
      ticker: TICKER,
      direction: DIRECTION,
      quantity: QUANTITY,
      price: PRICE,
      commission: 0,
      fees: 0
    }
  })

  const samples = []
  const deadline = Date.now() + DURATION_MS
  while (Date.now() < deadline) {
    const [ops, exec] = await Promise.all([
      api('/api/ops/overview'),
      api(`/api/executions/${execution.data.id}`)
    ])
    samples.push({
      at: new Date().toISOString(),
      executionStatus: exec.data.status,
      cancelReason: exec.data.cancelReason,
      queueLagMs: ops.data.summary.queueLagMs,
      workerCount: ops.data.summary.workerCount,
      staleWorkerCount: ops.data.summary.staleWorkerCount,
      activeExecutions: ops.data.summary.activeExecutions,
      rejectedToday: ops.data.summary.rejectedToday
    })

    if (['filled', 'cancelled', 'failed'].includes(exec.data.status)) {
      break
    }

    await sleep(SAMPLE_INTERVAL_MS)
  }

  const audits = await api(`/api/ops/audits?executionId=${execution.data.id}`)
  const finalExecution = await api(`/api/executions/${execution.data.id}`)

  console.log(JSON.stringify({
    baseUrl: BASE_URL,
    startedAt: startedAt.toISOString(),
    durationMs: DURATION_MS,
    executionId: execution.data.id,
    finalStatus: finalExecution.data.status,
    finalCancelReason: finalExecution.data.cancelReason,
    samples,
    auditTrail: audits.data.map((audit) => ({
      eventType: audit.eventType,
      detail: audit.detail,
      createdAt: audit.createdAt
    }))
  }, null, 2))
}

async function api(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json'
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${path} failed: ${response.status} ${response.statusText} ${body}`)
  }

  return response.json()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((err) => {
  console.error('[openMarketSoak] error:', err)
  process.exit(1)
})
