/**
 * Plain-language description of a bot or template, generated from the exact config and
 * rules the bot engine runs — the single source for every "what this bot does" sentence.
 *
 *   describeBot({ config, rules }, { template }) → { sentence, guards: string[], symbols }
 */
import { listJoin, moneyWhole } from './format'

const isPos = (n) => Number.isFinite(Number(n)) && Number(n) > 0

function findRule(rules, type) {
  return (rules ?? []).find((r) => r?.type === type && r.enabled !== false) ?? null
}

function durationText(ms) {
  if (!isPos(ms)) return null
  const h = Number(ms) / 3_600_000
  if (h >= 24) { const d = Math.round(h / 24); return d === 1 ? 'day' : `${d} days` }
  if (h >= 1) { const r = Math.round(h * 10) / 10; return r === 1 ? 'hour' : `${r} hours` }
  const m = Math.round(Number(ms) / 60_000)
  return m === 1 ? 'minute' : `${m} minutes`
}

function cooldownMs(c) {
  if (!c) return null
  return Number(c.windowMs ?? (c.cooldownHours ? c.cooldownHours * 3_600_000 : c.minutes ? c.minutes * 60_000 : NaN))
}

export function isResearchBot(config) {
  return config?.signalSource === 'alpha_research'
}

/** Guards in display order. Each is a short clause. */
export function describeGuards({ config = {}, rules = [] } = {}, { template = false } = {}) {
  const out = []
  // Templates: capital and order size are chosen by the user, so they're not rules yet.
  if (!template && isPos(config.maxOrderNotional)) out.push(`Up to ${moneyWhole(config.maxOrderNotional)} per order`)
  if (!template && isPos(config.allocatedAmount)) out.push(`${moneyWhole(config.allocatedAmount)} simulated capital`)
  const hours = findRule(rules, 'market_hours')
  if (hours) out.push(hours.config?.allowPremarket || hours.config?.allowAfterHours ? 'Trades regular and extended hours' : 'Regular market hours only')
  const win = findRule(rules, 'time_window')
  if (win?.config?.start && win?.config?.end) out.push(`Only between ${win.config.start} and ${win.config.end} ET`)
  const cd = durationText(cooldownMs(findRule(rules, 'cooldown')?.config))
  if (cd) out.push(/^\d/.test(cd) ? `At most one trade per symbol every ${cd}` : `At most one trade per symbol per ${cd}`)
  const rv = findRule(rules, 'relative_volume')
  if (rv && rv.enabled !== false && isPos(rv.config?.minRatio)) out.push(`Only when volume is at least ${rv.config.minRatio}× its 20-day average`)
  const pc = findRule(rules, 'price_change')
  if (pc && pc.enabled !== false && isPos(pc.config?.pct)) out.push(`Only after the price ${pc.config.operator === 'below' ? 'fell' : 'rose'} ${pc.config.pct}% or more over ${pc.config.sessions} sessions`)
  for (const e of Array.isArray(config.exit?.rules) ? config.exit.rules : []) {
    if (e.type === 'stop_loss') out.push(`Sells its shares if the price falls ${e.config?.pct}% below what it paid`)
    if (e.type === 'trend_filter') out.push(`Sells its shares when ${e.config?.symbol ?? 'SPY'}’s trend turns down`)
    if (e.type === 'price_change' && e.config?.operator === 'below') out.push(`Sells its shares after a ${e.config?.pct}% fall over ${e.config?.sessions} sessions`)
  }
  const pos = findRule(rules, 'position_limit')?.config
  if (pos?.maxPositions === 1) out.push('Holds at most one position')
  else if (isPos(pos?.maxShares)) out.push(`Holds at most ${pos.maxShares} shares per symbol`)
  const loss = findRule(rules, 'daily_loss')?.config
  if (isPos(loss?.maxLoss)) out.push(`Stops for the day once the account has realized a ${moneyWhole(loss.maxLoss)} loss`)
  else if (isPos(loss?.maxDailyLossPct)) out.push(`Stops for the day once the account has realized a ${loss.maxDailyLossPct}% loss`)
  if (isResearchBot(config)) {
    const r = config.research ?? {}
    const parts = []
    if (Number.isFinite(Number(r.minConfidence))) parts.push(`score ≥ ${Math.round(Number(r.minConfidence) * 100)}`)
    if (isPos(r.maxPredictionAgeHours)) parts.push(`under ${r.maxPredictionAgeHours}h old`)
    if (Number.isFinite(Number(r.maxEntryDriftPct))) parts.push(`price within ${r.maxEntryDriftPct}% of entry`)
    if (parts.length) out.push(`Research must be ${parts.join(', ')}`)
    out.push('Only research that beat its baseline out of sample')
  }
  return out
}

/** The one-sentence summary of what the bot does. */
export function describeAction({ config = {}, rules = [] } = {}, { template = false } = {}) {
  const tickers = Array.isArray(config.tickers) ? config.tickers.filter(Boolean) : []
  const syms = template
    ? (isResearchBot(config) ? 'the stocks you pick' : 'a stock you choose')
    : tickers.length ? listJoin(tickers) : 'its symbols'

  if (isResearchBot(config)) {
    return `Buys ${syms} when Alpha Engine publishes current, verified BUY research, and sells what it holds on SELL research.`
  }
  const price = findRule(rules, 'price_threshold')?.config
  const change = findRule(rules, 'price_change')?.config
  const trend = findRule(rules, 'trend_filter')?.config
  const loss = findRule(rules, 'daily_loss')?.config
  const cd = durationText(cooldownMs(findRule(rules, 'cooldown')?.config))
  const sell = config.direction === 'sell'

  if (trend) {
    return `Buys ${syms} at the open when the ${trend.symbol ?? 'SPY'} trend is confirmed up, and stays out when it isn’t.`
  }
  if (price) {
    const level = isPos(price.price) ? moneyWhole(price.price) : null
    const op = price.operator ?? price.direction ?? (sell ? 'below' : 'above')
    const verb = sell ? 'Sells' : 'Buys'
    if (!level) return `${verb} ${syms} when the price ${op === 'below' ? 'falls below' : 'rises above'} a trigger price you set.`
    return `${verb} ${syms} when the price ${op === 'below' ? 'falls below' : 'rises above'} ${level}.`
  }
  if (loss && !sell) {
    return `Buys ${syms} steadily, and stops for the day once the account has realized ${isPos(loss.maxLoss) ? `a ${moneyWhole(loss.maxLoss)} loss` : 'its loss limit'}.`
  }
  if (change && isPos(change.pct) && isPos(change.sessions)) {
    const verb = sell ? 'Sells' : 'Buys'
    return `${verb} ${syms} after the price ${change.operator === 'below' ? 'falls' : 'rises'} at least ${change.pct}% over ${change.sessions} trading sessions.`
  }
  if (!sell) {
    return cd ? `Buys ${syms} on a fixed schedule — once every ${cd}, whatever the price.` : `Buys ${syms} at each check.`
  }
  return `Sells ${syms} it holds.`
}

export function describeBot(bot, opts) {
  return {
    sentence: describeAction(bot, opts),
    guards: describeGuards(bot),
    symbols: Array.isArray(bot?.config?.tickers) ? bot.config.tickers : [],
  }
}

/** Templates whose trigger price must be set by the user before the bot can run sensibly. */
export function needsTriggerPrice(rules) {
  const price = findRule(rules, 'price_threshold')
  return Boolean(price) && !isPos(price.config?.price)
}
