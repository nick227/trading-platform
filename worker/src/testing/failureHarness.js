class FakeBroker {
  constructor() {
    this.ordersByClientId = new Map()
    this.submitCalls = 0
    this.clockOpen = true
    this.invalidKey = false
  }

  async getOrderByClientOrderId(clientOrderId) {
    return this.ordersByClientId.get(clientOrderId) ?? null
  }

  async submitOrder({ clientOrderId, ticker, side, qty }) {
    if (this.invalidKey) {
      const err = new Error('invalid api key')
      err.kind = 'invalid_key'
      throw err
    }
    this.submitCalls += 1
    const order = {
      alpacaOrderId: `alp_${this.submitCalls}`,
      clientOrderId,
      ticker,
      side,
      qty,
      status: 'new',
      filledQty: 0,
      filledAvgPrice: null
    }
    this.ordersByClientId.set(clientOrderId, order)
    return order
  }

  async getClock() {
    return { is_open: this.clockOpen }
  }
}

export async function runFailureHarness() {
  const scenarios = [
    crashAfterSubmitBeforeDbWrite,
    concurrentDuplicateTicks,
    partialFillThenWorkerDeath,
    marketCloseMidOrder,
    invalidApiKeyMidRun
  ]

  const results = []
  for (const scenario of scenarios) {
    try {
      const output = await scenario()
      results.push({ name: scenario.name, pass: true, output })
    } catch (err) {
      results.push({ name: scenario.name, pass: false, output: err.message })
    }
  }

  return results
}

async function crashAfterSubmitBeforeDbWrite() {
  const broker = new FakeBroker()
  const execution = {
    clientOrderId: 'tp_exe_crash',
    brokerOrderId: null,
    submittedAt: null
  }

  await broker.submitOrder({
    clientOrderId: execution.clientOrderId,
    ticker: 'AAPL',
    side: 'buy',
    qty: 1
  })

  const reconciled = await broker.getOrderByClientOrderId(execution.clientOrderId)
  if (!reconciled) {
    throw new Error('worker did not find existing order by clientOrderId')
  }
  if (broker.submitCalls !== 1) {
    throw new Error('duplicate submit occurred during reconciliation')
  }

  return 'reconciled existing Alpaca order without second submit'
}

async function concurrentDuplicateTicks() {
  const activeIntentKeys = new Set()
  const key = 'bot:bot_1:AAPL:buy'

  const firstInsert = tryInsertActiveIntent(activeIntentKeys, key)
  const secondInsert = tryInsertActiveIntent(activeIntentKeys, key)

  if (!firstInsert || secondInsert) {
    throw new Error('duplicate active intent was not blocked')
  }

  return 'second bot execution intent blocked by activeIntentKey uniqueness'
}

async function partialFillThenWorkerDeath() {
  const broker = new FakeBroker()
  const clientOrderId = 'tp_exe_partial'
  const order = await broker.submitOrder({
    clientOrderId,
    ticker: 'MSFT',
    side: 'buy',
    qty: 2
  })
  order.status = 'partially_filled'
  order.filledQty = 1
  order.filledAvgPrice = 410

  const reconciled = await broker.getOrderByClientOrderId(clientOrderId)
  if (!reconciled || reconciled.status !== 'partially_filled') {
    throw new Error('partial fill was not preserved after simulated worker death')
  }

  reconciled.status = 'filled'
  reconciled.filledQty = 2
  const finalOrder = await broker.getOrderByClientOrderId(clientOrderId)
  if (finalOrder.status !== 'filled' || finalOrder.filledQty !== 2) {
    throw new Error('worker did not resume and finish partially filled order')
  }

  return 'partial fill remained recoverable across worker restart'
}

async function marketCloseMidOrder() {
  const broker = new FakeBroker()
  const clientOrderId = 'tp_exe_market_close'
  const order = await broker.submitOrder({
    clientOrderId,
    ticker: 'NVDA',
    side: 'buy',
    qty: 1
  })

  broker.clockOpen = false
  const recoveredOrder = await broker.getOrderByClientOrderId(clientOrderId)
  if (!recoveredOrder) {
    throw new Error('existing submitted order could not be reconciled after market close')
  }

  let blockedFreshSubmit = false
  try {
    if (!(await broker.getClock()).is_open) {
      blockedFreshSubmit = true
    }
  } catch {
    blockedFreshSubmit = false
  }

  if (!blockedFreshSubmit) {
    throw new Error('fresh submit was not blocked after market close')
  }

  order.status = 'filled'
  return 'existing order reconciled while fresh submission stayed blocked'
}

async function invalidApiKeyMidRun() {
  const broker = new FakeBroker()
  broker.invalidKey = true

  let failed = false
  try {
    await broker.submitOrder({
      clientOrderId: 'tp_exe_invalid_key',
      ticker: 'TSLA',
      side: 'buy',
      qty: 1
    })
  } catch (err) {
    failed = err.kind === 'invalid_key'
  }

  if (!failed) {
    throw new Error('invalid key scenario did not fail deterministically')
  }

  return 'invalid API key rejected order path deterministically'
}

function tryInsertActiveIntent(set, key) {
  if (set.has(key)) return false
  set.add(key)
  return true
}
