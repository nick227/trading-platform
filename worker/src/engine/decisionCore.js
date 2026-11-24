/**
 * Shared decision core: what a bot decides from explicit inputs.
 *
 * The live bot engine (botEngine.js) loads its inputs from the price cache, the database and
 * the broker; the historical backtest (backtest/historicalRunner.js) builds the same inputs
 * from its simulated portfolio as of each session. Both call these functions, so rules,
 * direction, sizing and sell attribution behave identically in either.
 */
import { evaluatePositionLimit } from './rules/positionLimit.js'
import { priceThresholdDecision } from './rules/priceThreshold.js'
import { marketHoursDecision } from './rules/marketHours.js'
import { evaluateTimeWindow } from './rules/timeWindow.js'
import { cooldownDecision, windowMsFromConfig } from './rules/cooldown.js'
import { dailyLossDecision } from './rules/dailyLoss.js'
import { trendFilterDecision } from './rules/trendFilter.js'
import { priceChangeDecision, relativeVolumeDecision } from './rules/marketConditions.js'

/** Trade direction from bot config: 'buy' | 'sell' | null (never defaulted). */
export function deriveDirection(bot) {
  const dir = bot.config?.direction
  if (dir === 'buy' || dir === 'sell') return dir
  return null
}

/** Shares a buy may take at `price` under the bot's capital settings. */
export function computeBuyQuantity({ bot, price: rawPrice }) {
  const price = Number(rawPrice ?? 0)
  if (!Number.isFinite(price) || price <= 0) return 0

  const allocated = bot.config?.allocatedAmount ?? bot.config?.capital
  const capitalMode = bot.config?.capitalMode
  if (capitalMode === 'allocated' || allocated != null) {
    const allocatedAmount = Number(allocated ?? 0)
    const riskOnExposure = Number(bot.config?.riskOnExposure ?? 1)
    const maxOrderNotional = bot.config?.maxOrderNotional != null
      ? Number(bot.config.maxOrderNotional)
      : (bot.config?.maxPerOrder != null ? Number(bot.config.maxPerOrder) : null)
    if (!Number.isFinite(allocatedAmount) || allocatedAmount <= 0) return 0
    if (!Number.isFinite(riskOnExposure) || riskOnExposure <= 0) return 0
    let notional = allocatedAmount * riskOnExposure
    if (Number.isFinite(maxOrderNotional) && maxOrderNotional > 0) notional = Math.min(notional, maxOrderNotional)
    const shares = Math.floor(notional / price)
    return shares > 0 ? shares : 0
  }

  const qty = Number(bot.config?.quantity ?? 1)
  return Number.isFinite(qty) && qty > 0 ? qty : 0
}

/** A sell takes only the bot's own FIFO shares, never more than the account holds. */
export function sellableFrom(heldByBot, accountQty) {
  return Math.max(0, Math.min(Number(heldByBot) || 0, Number(accountQty) || 0))
}

/**
 * Runs the configured rules in order; the first failure short-circuits.
 * `evaluateOne(rule)` returns { pass, reason?, detail? } (live: loads its inputs; historical:
 * ruleDecision over point-in-time inputs). Returns { pass: true } or { pass: false, rule, result }.
 */
export async function runRulePipeline(rules, evaluateOne) {
  for (const rule of rules ?? []) {
    const result = await evaluateOne(rule)
    if (!result.pass) return { pass: false, rule, result }
  }
  return { pass: true }
}

/**
 * A rule decision from explicit inputs (historical runs; the live wrappers call the same
 * pure functions after loading):
 *   price, now (Date), market { isOpen, marketOpen, marketClose }, positions [{ symbol, qty }],
 *   lastAttemptAt (ms, 0 = none), realizedLossToday (>= 0), regime (snapshot | null), side,
 *   volume / avgVolume (the session's and its prior 20-session average), closes (completed
 *   daily closes up to this session, ascending).
 */
export function ruleDecision(rule, inputs) {
  const config = rule.config ?? {}
  switch (rule.type) {
    case 'market_hours': return marketHoursDecision(config, { ...inputs.market, now: inputs.now })
    case 'price_threshold': return priceThresholdDecision(config, inputs.price)
    case 'cooldown': {
      const windowMs = windowMsFromConfig(config)
      if (!windowMs) return { pass: false, reason: 'cooldown_invalid_config' }
      return cooldownDecision(windowMs, inputs.lastAttemptAt ?? 0, inputs.now.getTime())
    }
    case 'position_limit': return evaluatePositionLimit(config, inputs.ticker, inputs.positions ?? [])
    case 'daily_loss': return dailyLossDecision(Number(config.maxLoss ?? config.maxDailyLoss ?? Infinity), inputs.realizedLossToday ?? 0)
    case 'trend_filter': {
      const side = typeof inputs.side === 'string' ? inputs.side.toLowerCase() : null
      return trendFilterDecision({
        confirmationBars: Math.max(1, Number(config.confirmationBars ?? 2)),
        maxSnapshotAgeHours: Number(config.maxSnapshotAgeHours ?? 90),
        requiredRegime: config.requiredRegime ?? (side === 'sell' ? 'risk_off' : 'risk_on'),
      }, inputs.regime ?? null, inputs.now.getTime())
    }
    case 'time_window': return evaluateTimeWindow(config, inputs.now)
    case 'relative_volume': return relativeVolumeDecision(config, { volume: inputs.volume, avgVolume: inputs.avgVolume })
    case 'price_change': return priceChangeDecision(config, { closes: inputs.closes })
    default: return { pass: true }
  }
}
