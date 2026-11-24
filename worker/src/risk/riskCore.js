/**
 * Normal risk policy as pure functions over explicit inputs.
 *
 * The live services (RiskDecisionMatrix, RiskGateService and the four score services) load
 * their inputs from the database/broker and call these functions; the historical backtest
 * builds the same inputs from its simulated portfolio as of each session and calls the same
 * functions. One implementation of the thresholds, weights and checks.
 *
 * RISK_POLICY_VERSION identifies this policy in backtest runs; change it whenever a threshold,
 * weight, default setting or formula here changes.
 */
import { createHash } from 'node:crypto'

export const RISK_THRESHOLDS = Object.freeze({
  operational: Object.freeze({ critical: 40, warning: 60 }),
  exposure: Object.freeze({ critical: 35, warning: 50 }),
  stress: Object.freeze({ critical: 40, warning: 60 }),
  execution: Object.freeze({ critical: 50, warning: 75 }),
})

export const EXECUTION_WEIGHTS = Object.freeze({
  signalConfidence: 0.35,
  liquidity: 0.25,
  spreadQuality: 0.20,
  regimeFit: 0.15,
  botWinRate: 0.05,
})

export const DEFAULT_RISK_SETTINGS = Object.freeze({
  maxDailyLoss: 1000,
  maxPositionSize: 0.1,
  maxOpenPositions: 10,
  maxLeverage: 2.0,
  maxDrawdown: 0.15,
  minAccountBalance: 1000,
  maxConcurrentTrades: 5,
  maxRiskPerTrade: 0.02,
})

const EXPOSURE_LIMITS = Object.freeze({ singleTickerMax: 0.20, sectorMax: 0.40, leverageMax: 1.5 })
const STRESS_LIMITS = Object.freeze({ drawdownWarning: 0.05, drawdownCritical: 0.10, dailyLossWarning: 0.01, dailyLossCritical: 0.02, losingStreakLimit: 5, volatilitySpike: 2.0 })

const SECTOR_MAP = Object.freeze({
  AAPL: 'technology', MSFT: 'technology', GOOGL: 'technology', NVDA: 'technology',
  JPM: 'financials', BAC: 'financials', WFC: 'financials',
  XOM: 'energy', CVX: 'energy',
  JNJ: 'healthcare', PFE: 'healthcare',
  AMZN: 'consumer', TSLA: 'consumer',
})
const CORRELATED_PAIRS = Object.freeze([['AAPL', 'MSFT'], ['GOOGL', 'META'], ['JPM', 'BAC'], ['XOM', 'CVX'], ['JNJ', 'PFE']])

export const RISK_POLICY_VERSION = `normal-${createHash('sha256').update(JSON.stringify({
  RISK_THRESHOLDS, EXECUTION_WEIGHTS, DEFAULT_RISK_SETTINGS, EXPOSURE_LIMITS, STRESS_LIMITS, SECTOR_MAP, CORRELATED_PAIRS, formulas: 1,
})).digest('hex').slice(0, 12)}`

// ── Decision matrix ──────────────────────────────────────────────────────────

export function applyDecisionMatrix(scores, thresholds = RISK_THRESHOLDS) {
  const { operational, exposure, stress, execution } = scores
  if (operational < thresholds.operational.critical) {
    return { action: 'reject', reason: 'operational_critical', positionMultiplier: 0, details: `Operational score ${operational} below critical threshold ${thresholds.operational.critical}` }
  }
  if (operational < thresholds.operational.warning) {
    return { action: 'reject', reason: 'operational_degraded', positionMultiplier: 0, details: `Operational score ${operational} in warning zone` }
  }
  if (exposure < thresholds.exposure.critical) {
    return { action: 'restrict', reason: 'exposure_critical', positionMultiplier: 0, details: `Exposure score ${exposure} below critical - only hedging/diversifying trades allowed`, allowedTradeTypes: ['hedge', 'diversify'] }
  }
  if (exposure < thresholds.exposure.warning) {
    return { action: 'restrict', reason: 'exposure_warning', positionMultiplier: 0.5, details: `Exposure score ${exposure} in warning zone - reduced size only if diversifying` }
  }
  if (stress < thresholds.stress.critical) {
    return { action: 'restrict', reason: 'stress_critical', positionMultiplier: 0.25, details: `Stress score ${stress} below critical - recovery mode, minimal trading` }
  }
  if (stress < thresholds.stress.warning) {
    return { action: 'restrict', reason: 'stress_warning', positionMultiplier: 0.5, details: `Stress score ${stress} in warning zone - half size max` }
  }
  if (execution < thresholds.execution.critical) {
    return { action: 'reject', reason: 'execution_weak', positionMultiplier: 0, details: `Execution confidence ${execution} below critical - signal not trustworthy` }
  }
  if (execution < thresholds.execution.warning) {
    return { action: 'restrict', reason: 'execution_moderate', positionMultiplier: 0.7, details: `Execution confidence ${execution} in warning zone - reduced size` }
  }
  return { action: 'approve', reason: 'all_scores_healthy', positionMultiplier: 1.0, details: 'All risk scores within healthy ranges' }
}

// ── Execution confidence ─────────────────────────────────────────────────────

export function scoreSignalConfidence(signal) {
  if (!signal || signal.confidence === undefined) return 50
  const c = signal.confidence
  if (c >= 0.8) return 95
  if (c >= 0.7) return 80
  if (c >= 0.6) return 65
  if (c >= 0.5) return 50
  if (c >= 0.4) return 35
  return 20
}

export function scoreLiquidity(marketData) {
  if (!marketData || !marketData.volume) return 50
  const volume = marketData.volume
  const avgVolume = marketData.avgVolume || volume
  const ratio = volume / avgVolume
  if (ratio >= 2.0) return 95
  if (ratio >= 1.5) return 85
  if (ratio >= 1.0) return 75
  if (ratio >= 0.5) return 60
  if (ratio >= 0.25) return 40
  return 20
}

export function scoreSpreadQuality(marketData) {
  if (!marketData || !marketData.spread) return 50
  const spreadPct = (marketData.spread / (marketData.price || 100)) * 100
  if (spreadPct <= 0.01) return 95
  if (spreadPct <= 0.05) return 85
  if (spreadPct <= 0.1) return 70
  if (spreadPct <= 0.25) return 50
  if (spreadPct <= 0.5) return 30
  return 15
}

export function scoreRegimeFit(signal) {
  if (!signal || !signal.regime) return 50
  return { bull: 85, bear: 75, sideways: 60, volatile: 45, crash: 20 }[signal.regime] || 50
}

/** Win rate (0..1) of closed trades → score; null stays null (unknown). */
export function scoreWinRate(winRate) {
  if (winRate === null || winRate === undefined) return null
  if (winRate >= 0.6) return 90
  if (winRate >= 0.55) return 75
  if (winRate >= 0.5) return 60
  if (winRate >= 0.45) return 45
  return 30
}

/**
 * Win rate over closed trades (sells with FIFO realized P&L) filled within 30 days of `now`;
 * null when there is none. `perExecutionPnl` is calculateFifoAccounting's map.
 */
export function closedTradeWinRate(fills, perExecutionPnl, now) {
  const since = now - 30 * 24 * 60 * 60 * 1000
  const closed = fills.filter((f) => String(f.direction).toLowerCase() === 'sell' &&
    new Date(f.filledAt ?? f.createdAt).getTime() >= since && perExecutionPnl.has(f.id))
  if (closed.length === 0) return null
  return closed.filter((f) => perExecutionPnl.get(f.id) > 0).length / closed.length
}

/** `winRateScore`: scoreWinRate(...) or null when unknown. */
export function executionConfidence({ signal, marketData = {}, winRateScore = null, unknownAsNotApplicable }) {
  const scores = {
    signalConfidence: scoreSignalConfidence(signal),
    liquidity: scoreLiquidity(marketData),
    spreadQuality: scoreSpreadQuality(marketData),
    regimeFit: scoreRegimeFit(signal),
    botWinRate: winRateScore ?? 50,
  }
  const known = {
    signalConfidence: signal?.confidence !== undefined && signal?.confidence !== null,
    liquidity: Boolean(marketData?.volume),
    spreadQuality: Boolean(marketData?.spread),
    regimeFit: Boolean(signal?.regime),
    botWinRate: winRateScore !== null,
  }
  let weightedScore
  let notApplicable = []
  if (unknownAsNotApplicable) {
    const keys = Object.keys(EXECUTION_WEIGHTS).filter((k) => known[k])
    notApplicable = Object.keys(EXECUTION_WEIGHTS).filter((k) => !known[k])
    const totalWeight = keys.reduce((sum, k) => sum + EXECUTION_WEIGHTS[k], 0)
    weightedScore = totalWeight > 0 ? keys.reduce((sum, k) => sum + scores[k] * EXECUTION_WEIGHTS[k], 0) / totalWeight : 50
    for (const k of notApplicable) scores[k] = null
  } else {
    weightedScore =
      (scores.signalConfidence * EXECUTION_WEIGHTS.signalConfidence) +
      (scores.liquidity * EXECUTION_WEIGHTS.liquidity) +
      (scores.spreadQuality * EXECUTION_WEIGHTS.spreadQuality) +
      (scores.regimeFit * EXECUTION_WEIGHTS.regimeFit) +
      (scores.botWinRate * EXECUTION_WEIGHTS.botWinRate)
  }
  return { score: Math.round(weightedScore), weightedScore, breakdown: scores, basis: unknownAsNotApplicable ? 'known_inputs' : 'all_inputs', notApplicable }
}

// ── Portfolio exposure (holdings: [{ ticker, value }], marketValue, equity) ──

export function scoreSingleTickerConcentration(holdings) {
  if (holdings.length === 0) return 100
  const total = holdings.reduce((s, h) => s + Math.abs(h.value), 0)
  if (total === 0) return 100
  const maxPct = Math.max(...holdings.map((h) => Math.abs(h.value))) / total
  if (maxPct <= 0.10) return 100
  if (maxPct <= 0.15) return 85
  if (maxPct <= EXPOSURE_LIMITS.singleTickerMax) return 70
  if (maxPct <= 0.30) return 45
  if (maxPct <= 0.50) return 25
  return 10
}

export function scoreSectorConcentration(holdings) {
  if (holdings.length === 0) return 100
  const bySector = {}
  let total = 0
  for (const h of holdings) {
    const v = Math.abs(h.value)
    const sector = SECTOR_MAP[h.ticker] || 'other'
    bySector[sector] = (bySector[sector] || 0) + v
    total += v
  }
  if (total === 0) return 100
  const maxPct = Math.max(...Object.values(bySector)) / total
  if (maxPct <= 0.25) return 100
  if (maxPct <= 0.35) return 80
  if (maxPct <= EXPOSURE_LIMITS.sectorMax) return 65
  if (maxPct <= 0.50) return 40
  if (maxPct <= 0.70) return 20
  return 5
}

export function scoreLeverage(marketValue, equity) {
  const leverage = marketValue / equity
  if (leverage <= 1.0) return 100
  if (leverage <= 1.2) return 90
  if (leverage <= EXPOSURE_LIMITS.leverageMax) return 75
  if (leverage <= 2.0) return 50
  if (leverage <= 3.0) return 25
  return 10
}

export function scoreCorrelation(holdings) {
  if (holdings.length < 2) return 100
  const tickers = holdings.map((h) => h.ticker)
  const n = CORRELATED_PAIRS.filter(([a, b]) => tickers.includes(a) && tickers.includes(b)).length
  if (n === 0) return 100
  if (n === 1) return 80
  if (n === 2) return 60
  if (n === 3) return 40
  return 20
}

export function portfolioExposure({ holdings, marketValue, equity }) {
  const breakdown = {
    singleTicker: scoreSingleTickerConcentration(holdings),
    sector: scoreSectorConcentration(holdings),
    leverage: scoreLeverage(marketValue, equity),
    correlation: scoreCorrelation(holdings),
  }
  const avg = (breakdown.singleTicker + breakdown.sector + breakdown.leverage + breakdown.correlation) / 4
  return { score: Math.round(avg), avg, breakdown }
}

// ── Drawdown stress ──────────────────────────────────────────────────────────
// Live inputs come from EquityPeak and Execution.pnl (see DrawdownStressService). Callers
// pass the same quantities: peakEquity (null when none recorded), today's per-fill P&L,
// the 20 most recent fills' P&L newest first, and the last 7 days' P&L.

export function scoreDrawdown(peakEquity, equity) {
  if (!(peakEquity > 0)) return 100
  const dd = (peakEquity - equity) / peakEquity
  if (dd <= 0.02) return 100
  if (dd <= STRESS_LIMITS.drawdownWarning) return 85
  if (dd <= 0.075) return 65
  if (dd <= STRESS_LIMITS.drawdownCritical) return 40
  if (dd <= 0.15) return 20
  return 5
}

export function scoreDailyLoss(todaysPnls, equity) {
  const dailyLoss = todaysPnls.reduce((sum, p) => sum + Math.min(0, p), 0)
  if (dailyLoss === 0) return 100
  const pct = Math.abs(dailyLoss) / equity
  if (pct <= 0.005) return 100
  if (pct <= STRESS_LIMITS.dailyLossWarning) return 85
  if (pct <= 0.015) return 65
  if (pct <= STRESS_LIMITS.dailyLossCritical) return 40
  if (pct <= 0.03) return 20
  return 5
}

export function scoreLosingStreak(recentPnlsNewestFirst) {
  if (recentPnlsNewestFirst.length === 0) return 100
  let streak = 0
  for (const p of recentPnlsNewestFirst) { if (p < 0) streak++; else break }
  if (streak === 0) return 100
  if (streak <= 2) return 90
  if (streak <= STRESS_LIMITS.losingStreakLimit) return 60
  if (streak <= 7) return 35
  if (streak <= 10) return 15
  return 5
}

export function scoreVolatility(weekPnls) {
  if (weekPnls.length < 5) return 100
  const mean = weekPnls.reduce((s, r) => s + r, 0) / weekPnls.length
  const variance = weekPnls.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / weekPnls.length
  const stdDev = Math.sqrt(variance)
  const avgTradeSize = weekPnls.reduce((s, r) => s + Math.abs(r), 0) / weekPnls.length
  const nv = avgTradeSize > 0 ? stdDev / avgTradeSize : 0
  if (nv <= 0.5) return 100
  if (nv <= 1.0) return 85
  if (nv <= STRESS_LIMITS.volatilitySpike) return 70
  if (nv <= 3.0) return 45
  if (nv <= 5.0) return 25
  return 10
}

export function drawdownStress({ peakEquity, equity, todaysPnls, recentPnls, weekPnls }) {
  const breakdown = {
    drawdown: scoreDrawdown(peakEquity, equity),
    dailyLoss: scoreDailyLoss(todaysPnls, equity),
    losingStreak: scoreLosingStreak(recentPnls),
    volatility: scoreVolatility(weekPnls),
  }
  const avg = (breakdown.drawdown + breakdown.dailyLoss + breakdown.losingStreak + breakdown.volatility) / 4
  return { score: Math.round(avg), avg, breakdown }
}

// ── Legacy gate checks ───────────────────────────────────────────────────────

/** portfolioState: { cashBalance, totalValue, totalExposure, dailyLoss, drawdown } */
export function legacyRiskChecks({ positionValue, portfolioState: ps, settings, activeReservations }) {
  const leverageRatio = (ps.totalExposure + positionValue) / ps.totalValue
  const maxPositionValue = ps.totalValue * settings.maxPositionSize
  const riskPerTrade = positionValue / ps.totalValue
  const dailyLoss = ps.dailyLoss || 0
  const balance = ps.cashBalance || 0
  const drawdown = ps.drawdown || 0
  return [
    { type: 'daily_loss', passed: dailyLoss <= settings.maxDailyLoss, current: dailyLoss, limit: settings.maxDailyLoss, severity: dailyLoss > settings.maxDailyLoss * 0.8 ? 'high' : 'medium' },
    { type: 'position_size', passed: positionValue <= maxPositionValue, current: positionValue, limit: maxPositionValue, severity: positionValue > maxPositionValue * 0.9 ? 'high' : 'medium' },
    { type: 'account_balance', passed: balance >= settings.minAccountBalance, current: balance, limit: settings.minAccountBalance, severity: balance < settings.minAccountBalance * 0.5 ? 'critical' : 'high' },
    { type: 'leverage_ratio', passed: leverageRatio <= settings.maxLeverage, current: leverageRatio, limit: settings.maxLeverage, severity: leverageRatio > settings.maxLeverage * 0.9 ? 'high' : 'medium' },
    { type: 'drawdown', passed: drawdown <= settings.maxDrawdown, current: drawdown, limit: settings.maxDrawdown, severity: drawdown > settings.maxDrawdown * 0.9 ? 'critical' : 'high' },
    { type: 'concurrent_trades', passed: activeReservations < settings.maxConcurrentTrades, current: activeReservations, limit: settings.maxConcurrentTrades, severity: activeReservations >= settings.maxConcurrentTrades ? 'high' : 'low' },
    { type: 'risk_per_trade', passed: riskPerTrade <= settings.maxRiskPerTrade, current: riskPerTrade, limit: settings.maxRiskPerTrade, severity: riskPerTrade > settings.maxRiskPerTrade * 0.9 ? 'high' : 'medium' },
  ]
}

export function riskScoreFromChecks(checks) {
  let score = 100
  for (const c of checks) {
    if (c.passed) continue
    score -= { critical: 25, high: 15, medium: 10, low: 5 }[c.severity] ?? 0
  }
  return Math.max(0, score)
}

/**
 * The gate's verdict from the four scores and the legacy checks (RiskGateService).
 * Returns the fields resolveRiskOutcome reads.
 */
export function gateVerdict({ scores, quantity, checks }) {
  const decision = applyDecisionMatrix(scores)
  const adjustedQuantity = decision.action === 'approve' || decision.action === 'restrict'
    ? Math.floor(quantity * (decision.positionMultiplier || 1.0))
    : 0
  const failedChecks = checks.filter((c) => !c.passed)
  return {
    approved: decision.action === 'approve' && failedChecks.length === 0,
    decision: decision.action,
    reason: decision.reason,
    positionMultiplier: decision.positionMultiplier,
    adjustedQuantity,
    scores,
    checks,
    failedChecks,
    riskScore: riskScoreFromChecks(checks),
  }
}
