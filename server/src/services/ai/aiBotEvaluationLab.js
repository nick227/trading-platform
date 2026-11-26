/**
 * Deterministic, offline research-arm evaluation. No LLM or broker calls.
 * Decisions are frozen as-of a completed session and execute no earlier
 * than the next supplied session's OPEN. This is not a profitability claim.
 */
import { createHash } from 'node:crypto'

export const AI_EVALUATION_VERSION = '1.0.0'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_SESSIONS = 1500
const MAX_ARMS = 8
const MAX_ACTIONS_PER_SESSION = 2

export class EvaluationError extends Error {
  constructor(message) { super(message); this.name = 'EvaluationError' }
}

const round = n => Math.round((n + Number.EPSILON) * 100) / 100
const pct = n => Math.round((n + Number.EPSILON) * 10000) / 100
const finitePositive = n => typeof n === 'number' && Number.isFinite(n) && n > 0
const isDate = d => typeof d === 'string' && DATE_RE.test(d) &&
  !Number.isNaN(Date.parse(d + 'T00:00:00Z'))

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  }
  return value
}

export function validateAiEvaluationDataset({ sessions, arms, initialCapital, feePerOrder = 0, slippageBps = 0 }) {
  if (!Array.isArray(sessions) || sessions.length < 2 || sessions.length > MAX_SESSIONS ||
      !Array.isArray(arms) || !arms.length || arms.length > MAX_ARMS ||
      !finitePositive(initialCapital) || !Number.isFinite(feePerOrder) || feePerOrder < 0 ||
      !Number.isFinite(slippageBps) || slippageBps < 0 || slippageBps > 200) {
    throw new EvaluationError('Invalid research evaluation dataset or simulation assumptions')
  }
  let prior = ''
  const dates = new Set()
  for (const row of sessions) {
    if (!isDate(row?.date) || row.date <= prior || !row.prices ||
        typeof row.prices !== 'object' || Array.isArray(row.prices)) {
      throw new EvaluationError('Sessions must be unique, chronological and have observed prices')
    }
    dates.add(row.date)
    prior = row.date
    for (const [symbol, prices] of Object.entries(row.prices)) {
      if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol) ||
          !finitePositive(prices?.open) || !finitePositive(prices?.close)) {
        throw new EvaluationError('Invalid observed open or close quote')
      }
    }
  }
  const armIds = new Set()
  for (const arm of arms) {
    if (!arm || typeof arm.id !== 'string' || !/^[a-z][a-z0-9_-]{1,63}$/.test(arm.id) ||
        armIds.has(arm.id) || !['passive', 'deterministic', 'ai'].includes(arm.type) ||
        !Array.isArray(arm.signals)) {
      throw new EvaluationError('Invalid research arm or duplicate arm identity')
    }
    armIds.add(arm.id)
    const counts = new Map()
    const intents = new Set()
    for (const signal of arm.signals) {
      if (!signal || !dates.has(signal.session) || !isDate(signal.evidenceAsOf) ||
          signal.evidenceAsOf > signal.session ||
          !/^[A-Z][A-Z0-9.]{0,9}$/.test(signal.symbol || '') ||
          !['BUY', 'SELL'].includes(signal.action) ||
          (signal.action === 'BUY' && (!finitePositive(signal.targetAllocationPct) ||
            signal.targetAllocationPct > (arm.type === 'passive' ? 1 : 0.2)))) {
        throw new EvaluationError('Invalid or future-informed research signal')
      }
      if (arm.type === 'ai' && (typeof signal.researchEventId !== 'string' ||
          !signal.researchEventId.trim() || typeof signal.snapshotFingerprint !== 'string' ||
          !signal.snapshotFingerprint.trim())) {
        throw new EvaluationError('AI replay requires immutable research event provenance')
      }
      counts.set(signal.session, (counts.get(signal.session) || 0) + 1)
      const key = signal.session + '|' + signal.symbol
      if (intents.has(key)) throw new EvaluationError('Duplicate or contradictory same-symbol intent')
      intents.add(key)
      if (counts.get(signal.session) > (arm.type === 'passive' ? 1 : MAX_ACTIONS_PER_SESSION)) {
        throw new EvaluationError('Research arm exceeds per-session action cap')
      }
    }
  }
  return true
}

function simulateArm(arm, dataset) {
  const { sessions, initialCapital, feePerOrder, slippageBps } = dataset
  const isPassive = arm.type === 'passive'
  const maxPositionPct = isPassive ? 1 : 0.2
  let cash = initialCapital
  const lots = new Map()
  let previousCloseEquity = initialCapital
  let peak = initialCapital
  let maxDrawdownPct = 0
  let notionalTraded = 0
  let totalFees = 0
  let realizedPnl = 0
  let winningLots = 0
  let closedLots = 0
  let activePending = []
  let rejectedOrders = 0
  const fills = []
  const curve = []
  const signalsBySession = new Map()
  for (const signal of arm.signals) {
    if (!signalsBySession.has(signal.session)) signalsBySession.set(signal.session, [])
    signalsBySession.get(signal.session).push(signal)
  }

  function heldQuantity(symbol) {
    return (lots.get(symbol) || []).reduce((sum, lot) => sum + lot.quantity, 0)
  }
  function valueAt(symbol, prices) {
    const p = prices[symbol]
    if (!p || !finitePositive(p.close)) throw new EvaluationError(`Missing position mark for ${symbol}`)
    return heldQuantity(symbol) * p.close
  }
  for (const row of sessions) {
    // Previous completed session's signals are filled at THIS session's OPEN.
    for (const intent of activePending) {
      const quotes = row.prices[intent.symbol]
      if (!quotes || !finitePositive(quotes.open)) {
        throw new EvaluationError(`Missing next-open fill price: ${intent.symbol} ${row.date}`)
      }
      const px = quotes.open * (intent.action === 'BUY' ?
        1 + slippageBps/10000 : 1 - slippageBps/10000)
      if (!(px > 0)) throw new EvaluationError('Invalid slippage-adjusted price')
      let quantity = 0
      if (intent.action === 'BUY') {
        const existingNotional = heldQuantity(intent.symbol) * quotes.open
        const allowedNotional = Math.max(0, Math.min(
          initialCapital * intent.targetAllocationPct - existingNotional,
          initialCapital * maxPositionPct - existingNotional,
          cash - feePerOrder
        ))
        quantity = Math.floor(allowedNotional / px)
        if (quantity >= 1) {
          cash -= quantity * px + feePerOrder
          lots.set(intent.symbol, [...(lots.get(intent.symbol) || []),
            { quantity, price: px, entryFees: feePerOrder }])
        }
      } else {
        quantity = heldQuantity(intent.symbol)
        if (quantity >= 1) {
          cash += quantity * px - feePerOrder
          let remaining = quantity
          const inventory = lots.get(intent.symbol) || []
          for (const lot of inventory) {
            if (remaining === 0) break
            const used = Math.min(lot.quantity, remaining)
            const entryFeeShare = lot.entryFees * used / lot.quantity
            const exitFeeShare = feePerOrder * used / quantity
            const pnl = used * (px - lot.price) - entryFeeShare - exitFeeShare
            realizedPnl += pnl
            closedLots++
            if (pnl > 0) winningLots++
            lot.entryFees -= entryFeeShare
            lot.quantity -= used
            remaining -= used
          }
          lots.set(intent.symbol, inventory.filter(lot => lot.quantity > 0))
        }
      }
      if (quantity < 1) {
        rejectedOrders++
        continue
      }
      notionalTraded += quantity * px
      totalFees += feePerOrder
      fills.push({
        decisionSession: intent.session,
        fillSession: row.date,
        symbol: intent.symbol,
        action: intent.action,
        quantity,
        simulatedFillPrice: round(px),
        fee: feePerOrder,
        researchEventId: intent.researchEventId || null
      })
    }
    let marketValue = 0
    for (const symbol of lots.keys()) {
      if (heldQuantity(symbol) > 0) marketValue += valueAt(symbol, row.prices)
    }
    const equity = cash + marketValue
    if (!Number.isFinite(equity) || equity < -0.01) throw new EvaluationError('Simulation capital reconciliation failed')
    peak = Math.max(peak, equity)
    const drawdown = peak > 0 ? (peak - equity) / peak * 100 : 0
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdown)
    curve.push({
      date: row.date,
      equity: round(equity),
      cash: round(cash),
      exposurePct: equity > 0 ? pct(marketValue / equity) : 0,
      dailyReturnPct: pct(equity / previousCloseEquity - 1),
      regime: typeof row.regime === 'string' ? row.regime : null
    })
    previousCloseEquity = equity
    activePending = signalsBySession.get(row.date) || []
  }
  const finalEquity = curve.at(-1).equity
  const returns = curve.slice(1).map(r => r.dailyReturnPct / 100)
  const mean = returns.length ? returns.reduce((sum, r) => sum + r, 0) / returns.length : 0
  const variance = returns.length > 1 ? returns.reduce((sum, r) => sum + (r - mean)**2, 0) / (returns.length - 1) : 0
  const volatility = Math.sqrt(variance) * Math.sqrt(252) * 100
  const avgExposure = curve.reduce((sum, r) => sum + r.exposurePct, 0) / curve.length
  return {
    id: arm.id, type: arm.type,
    result: {
      initialCapital, finalEquity,
      totalReturnPct: pct(finalEquity / initialCapital - 1),
      maxDrawdownPct: round(maxDrawdownPct),
      annualizedVolatilityPct: round(volatility),
      annualizedSharpeZeroRf: returns.length >= 20 && variance > 0
        ? round(mean / Math.sqrt(variance) * Math.sqrt(252)) : null,
      realizedPnl: round(realizedPnl),
      totalFees: round(totalFees),
      turnoverPct: pct(notionalTraded / initialCapital),
      averageExposurePct: round(avgExposure),
      completedFills: fills.length,
      rejectedOrders,
      closedLots, winRatePct: closedLots > 0 ? pct(winningLots / closedLots) : null,
      pendingSignals: activePending.length
    },
    fills, curve
  }
}

export function runAiBotEvaluation({
  sessions, arms, initialCapital = 10000,
  feePerOrder = 0, slippageBps = 0,
  datasetLabel = 'unverified_fixture'
}) {
  const dataset = { sessions, arms, initialCapital, feePerOrder, slippageBps }
  validateAiEvaluationDataset(dataset)
  const evaluatedArms = arms.map(arm => simulateArm(arm, dataset))
  const baseline = evaluatedArms.find(a => a.type === 'deterministic') || null
  const comparisons = evaluatedArms.filter(a => a.type === 'ai').map(arm => ({
    armId: arm.id,
    baselineId: baseline?.id || null,
    returnDifferencePctPoints: baseline
      ? round(arm.result.totalReturnPct - baseline.result.totalReturnPct) : null,
    drawdownDifferencePctPoints: baseline
      ? round(arm.result.maxDrawdownPct - baseline.result.maxDrawdownPct) : null,
    interpretation: 'historical_simulated_comparison_not_predictive_validation'
  }))
  return {
    evaluationVersion: AI_EVALUATION_VERSION,
    datasetLabel,
    mode: 'research_only',
    assumptions: { initialCapital, feePerOrder, slippageBps,
      executionModel: 'next_session_open',
      maxPositionPct: 0.2,
      passiveBenchmarkMaxPositionPct: 1
    },
    datasetFingerprint: createHash('sha256').update(JSON.stringify(canonical(dataset))).digest('hex'),
    sessionsCount: sessions.length,
    evaluatedArms,
    comparisons,
    limitations: [
      'Only frozen, genuinely point-in-time inputs permit credible replay.',
      'Fixture results do not demonstrate a real-world investment advantage.',
      'No spread, market impact, tax or borrow costs are modeled beyond stated slippage and fees.',
      'Out-of-sample and untouched forward paper results are required before performance claims.'
    ]
  }
}

/** Passive benchmark executes a one-time BUY after the first completed session. */
export function makePassiveBenchmark(sessions, symbol = 'SPY') {
  if (!Array.isArray(sessions) || !sessions.length) throw new EvaluationError('Benchmark sessions required')
  return {
    id: 'passive_benchmark',
    type: 'passive',
    signals: [{
      session: sessions[0].date,
      evidenceAsOf: sessions[0].date,
      symbol,
      action: 'BUY',
      targetAllocationPct: 1
    }]
  }
}
